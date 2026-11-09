// =====================================================
// JUSTBRAND — ADMIN scheme section: endpoint-missing fallback
// =====================================================
// Simulates a STALE backend (scheme admin routes -> 404, everything
// else -> real local backend) and verifies the Admin Panel shows the
// clearly-labelled "Scheme API not available" notice instead of
// faking an approval UI.
//
// Run (Playwright available, e.g. from /tmp/pw):
//   node jb-admin-unavailable.verify.mjs

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  "/home/daytona/codebase",
].find((candidate) => existsSync(path.join(candidate, "backend", "server.js")));
const PREVIEW =
  process.env.ADMIN_URL ||
  "https://8007-0b7228e1-2c82-43c9-adf0-a376dbc7f0fc.daytonaproxy01.net";
const LOCAL = "http://127.0.0.1:4611";
const DB = "/tmp/pw/jb-admin-404-db";

// Pre-spawn stale-listener probe: a leftover backend on this port
// answers health instantly and would let this run seed into (and read
// from) a stale DB. Refuse instead of "verifying" against it.
{
  let held = false;
  try {
    await fetch(`${LOCAL}/api/health`, { signal: AbortSignal.timeout(2000) });
    held = true;
  } catch (e) {
    held = !!(e && e.name === "TimeoutError");
  }
  if (held) {
    console.log(`STALE LISTENER on ${LOCAL} — a leftover test backend owns this port. Kill it and re-run.`);
    process.exit(3);
  }
}
rmSync(DB, { recursive: true, force: true });
mkdirSync(DB, { recursive: true });
const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB,
  env: { ...process.env, PORT: "4611", JWT_SECRET: "jb-schemes-test-secret-local-only" },
  stdio: ["ignore", "pipe", "pipe"],
});
// Never leave this listener behind: an orphan here silently serves a
// stale DB to every later verify run on this port.
const killBe = () => {
  try { be.kill("SIGKILL"); } catch { /* already dead */ }
};
process.on("uncaughtException", (e) => {
  console.error(e && e.stack ? e.stack : e);
  killBe();
  process.exit(1);
});
process.on("exit", killBe);

let up = false;
for (let i = 0; i < 75 && !up; i++) {
  try {
    up = (await fetch(`${LOCAL}/api/health`)).ok;
  } catch {
    /* not up yet */
  }
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up) {
  console.log("BACKEND DOWN");
  process.exit(3);
}

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext();
const errs = [];

// All API (same-origin preview proxy OR legacy production URL) ->
// local backend, EXCEPT scheme admin routes -> simulated 404 (a
// backend older than this repository's source).
await ctx.route(/\/api\//, async (route) => {
  const u = new URL(route.request().url());
  if (u.pathname.startsWith("/api/admin/seller-schemes")) {
    return route.fulfill({
      status: 404,
      contentType: "application/json",
      body: JSON.stringify({ success: false, message: "Not Found" }),
    });
  }
  try {
    const headers = { ...route.request().headers() };
    delete headers.host;
    delete headers.origin;
    delete headers.referer;
    const resp = await fetch(`${LOCAL}${u.pathname}${u.search}`, {
      method: route.request().method(),
      headers,
      body: route.request().postDataBuffer() || undefined,
      redirect: "manual",
    });
    const buf = Buffer.from(await resp.arrayBuffer());
    await route.fulfill({
      status: resp.status,
      headers: { "content-type": resp.headers.get("content-type") || "application/json" },
      body: buf,
    });
  } catch {
    await route.fulfill({ status: 502, body: "{}" });
  }
});

const page = await ctx.newPage();
page.on("pageerror", (e) => errs.push(e.message.slice(0, 200)));
await page.goto(PREVIEW + "/", { waitUntil: "load", timeout: 60000 });
await page.locator('input[placeholder="Enter username"]').fill("superadmin");
await page.locator('input[placeholder="Enter password"]').fill("JustBrand@2026");
await page.locator('button:has-text("Login")').last().click();
await page.locator("button.sidebar-item").first().waitFor({ timeout: 15000 });
await page.locator('button.sidebar-item:has-text("Scheme Approvals")').click();
await page.locator(".sch-notice").waitFor({ timeout: 10000 });
const notice = await page.locator(".sch-notice").innerText();

const result = {
  unavailableBannerShown: notice.includes("Scheme API not available on this backend"),
  mentionsEndpoint: notice.includes("/api/admin/seller-schemes"),
  noFakeSchemeRows: (await page.locator("tr").count()) === 0,
  approveButtonsAbsent: (await page.locator("button:has-text('Approve')").count()) === 0,
  errs,
};
console.log(JSON.stringify(result, null, 2));

await browser.close();
be.kill("SIGTERM");
const pass =
  result.unavailableBannerShown &&
  result.mentionsEndpoint &&
  result.noFakeSchemeRows &&
  result.approveButtonsAbsent &&
  errs.length === 0;
process.exit(pass ? 0 : 1);
