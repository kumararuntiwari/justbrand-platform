// =====================================================
// JUSTBRAND — ADMIN PANEL browser verification (local preview)
// =====================================================
// Spawns the REAL backend on an isolated port with a THROWAWAY
// database, intercepts every production API call from the Admin
// preview and routes it to that local backend — production is
// never contacted for reads or writes.
//
// Verifies: Task 1 scheme approval actions (server round-trip +
// server-side auth), Task 2 content editor sizing/preview/save/
// cancel/reset/unsaved-switch guard, Task 3 banner manager
// (6 banners, add/edit/enable/reorder), Task 4 header editor.
//
// Run (Playwright available, e.g. from /tmp/pw):
//   node jb-admin-browser.verify.mjs
// Exit code 0 = all checks passed.

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = [
  path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."),
  "/home/daytona/codebase",
].find((candidate) => existsSync(path.join(candidate, "backend", "server.js")));
const PREVIEW =
  process.env.ADMIN_URL ||
  "https://8007-0b7228e1-2c82-43c9-adf0-a376dbc7f0fc.daytonaproxy01.net";
const LOCAL = "http://127.0.0.1:4611";
const DB_DIR = "/tmp/pw/jb-admin-verify-db";

const out = { errors: [], api: { calls: 0, non2xx: [] }, steps: {} };
let dialogMode = "accept";
let BE = null;

// Crash-safe reporting: any unexpected throw still prints the partial
// results and never leaves a backend process behind.
process.on("uncaughtException", (e) => {
  out.crashed = String(e && e.message ? e.message : e).slice(0, 300);
  console.log(JSON.stringify(out, null, 2));
  try {
    if (BE) BE.kill("SIGKILL");
  } catch {
    /* ignore */
  }
  process.exit(1);
});
const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT");
  process.exit(2);
}, 160000);

// ---------- 1. local backend (throwaway DB, production untouched) ----------
// Pre-spawn stale-listener probe: a leftover backend on this port
// answers health instantly and races past the post-spawn checks (our
// child's EADDRINUSE exit lands a few ms later), so seeds would land
// in a stale DB. Refuse instead.
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
rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });
const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR, // justbrand.db created HERE — isolated
  env: { ...process.env, PORT: "4611", JWT_SECRET: "jb-schemes-test-secret-local-only" },
  stdio: ["ignore", "pipe", "pipe"],
});
BE = be;
let beErr = "";
be.stderr.on("data", (d) => {
  beErr = (beErr + d.toString()).slice(-2000);
});

let up = false;
for (let i = 0; i < 75 && !up; i++) {
  try {
    const r = await fetch(`${LOCAL}/api/health`);
    up = r.ok;
  } catch {
    /* not up yet */
  }
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up) {
  console.error("BACKEND NOT UP", beErr);
  process.exit(3);
}
if (/EADDRINUSE/.test(beErr)) {
  console.error("PORT ALREADY HELD BY ANOTHER BACKEND — kill it first", beErr);
  be.kill("SIGKILL");
  process.exit(4);
}

// ---------- helpers ----------
async function api(method, p, { token, body } = {}) {
  const res = await fetch(LOCAL + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await res.json();
  } catch {
    /* non-JSON */
  }
  return { status: res.status, data };
}
function ok(name, cond, extra) {
  out.steps[name] = cond ? "PASS" : `FAIL ${extra !== undefined ? JSON.stringify(extra) : ""}`;
  if (!cond) out.failed = (out.failed || 0) + 1;
}
// Poll until a check passes (renders/effects are async) — honest timeout,
// never an unconditional success.
async function until(fn, ms = 8000) {
  const t0 = Date.now();
  let last;
  while (Date.now() - t0 < ms) {
    last = await fn();
    if (last) return last;
    await new Promise((r) => setTimeout(r, 150));
  }
  return last;
}

// ---------- 2. seed ----------
const today = new Date().toISOString().slice(0, 10);
const plus = (d) => new Date(Date.now() + d * 86400000).toISOString().slice(0, 10);

const aLogin = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const adminToken = aLogin.data?.token;
ok("admin login (local backend)", Boolean(adminToken));

const reg = await api("POST", "/api/sellers/register", {
  body: {
    name: "Verify Seller",
    shopName: "Verify Shop",
    mobile: "9876500111",
    email: "vshop@x.com",
    password: "seller123",
  },
});
await api("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
  token: adminToken,
  body: { kycStatus: "Approved" },
});
const sLogin = await api("POST", "/api/sellers/login", {
  body: { mobile: "9876500111", password: "seller123" },
});
const sellerToken = sLogin.data?.token;
const taxReady = await onboardGstSeller(api, { sellerToken, staffToken: adminToken });
ok("seller KYC + PAN + GST approved", taxReady.ok);
const prod = await api("POST", "/api/sellers/products", {
  token: sellerToken,
  body: {
    name: "Verify Product",
    category: "Electronics",
    price: "₹500",
    shortDetails: "verify",
    images: ["https://cdn.example.com/v1.jpg"],
  },
});
const prodId = prod.data?.product?.id;

async function makeScheme(name, type, value, submit = true) {
  const c = await api("POST", "/api/sellers/schemes", {
    token: sellerToken,
    body: {
      name,
      description: `${name} description`,
      discountType: type,
      discountValue: value,
      productIds: [prodId],
      startDate: today,
      endDate: plus(30),
    },
  });
  const id = c.data?.scheme?.id;
  if (submit && id) await api("POST", `/api/sellers/schemes/${id}/submit`, { token: sellerToken });
  return id;
}
const sPending1 = await makeScheme("Festive Percent 10", "percent", 10);
const sPending2 = await makeScheme("Flat Clearance 100", "flat", 100);
const sExpired = await makeScheme("Expired Winter 20", "percent", 20);
const sDraft = await makeScheme("Draft Monsoon 5", "percent", 5, false);
await api("POST", `/api/admin/seller-schemes/${sExpired}/approve`, {
  token: adminToken,
  body: { note: "Approved before expiry" },
});

// make sExpired genuinely expired (direct write into the THROWAWAY db)
const requireBackend = createRequire(path.join(REPO_ROOT, "backend", "server.js"));
const Database = requireBackend("better-sqlite3");
const tdb = new Database(path.join(DB_DIR, "justbrand.db"));
tdb.prepare("UPDATE seller_schemes SET endDate = ? WHERE id = ?").run("2020-01-31", sExpired);
tdb.close();
ok(
  "schemes seeded (2 pending, 1 approved-expired, 1 draft)",
  Boolean(sPending1 && sPending2 && sExpired && sDraft && prodId)
);

// 6 banners: 5 active + 1 inactive
const GIF = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
for (let i = 1; i <= 6; i++) {
  await api("POST", "/api/admin/site/banners", {
    token: adminToken,
    body: {
      title: `Seed Banner ${i}`,
      subtitle: `Subtitle ${i}`,
      sortOrder: i - 1,
      active: i !== 6,
      imageUrl: GIF,
    },
  });
}
const bannersNow = await api("GET", "/api/admin/site/settings", { token: adminToken });
ok("6 banners seeded", (bannersNow.data?.banners || []).length === 6, bannersNow.data?.banners?.length);

// server-side authorization proof (NOT a frontend-only check)
const noTok = await api("GET", "/api/admin/seller-schemes");
ok(
  "GET admin schemes w/o token -> 401/403 (server enforced)",
  noTok.status === 401 || noTok.status === 403,
  noTok.status
);
const sellerTok = await api("GET", "/api/admin/seller-schemes", { token: sellerToken });
ok(
  "GET admin schemes with SELLER token -> 401/403 (server enforced)",
  sellerTok.status === 401 || sellerTok.status === 403,
  sellerTok.status
);
const sellerSelfApprove = await api("POST", `/api/admin/seller-schemes/${sPending1}/approve`, {
  token: sellerToken,
});
ok(
  "seller self-approve blocked by server",
  sellerSelfApprove.status === 401 || sellerSelfApprove.status === 403,
  sellerSelfApprove.status
);

// ---------- 3. browser ----------
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1360, height: 950 } });

// Intercept EVERY API call -> local backend. Production is never
// touched. The admin preview injects window.__JB_API_BASE__ = ""
// (same-origin), so we intercept /api/* on ANY origin — including
// the preview's own proxy path — and answer from the local backend.
await ctx.route(/\/api\//, async (route) => {
  const u = new URL(route.request().url());
  out.api.calls++;
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
    if (resp.status >= 400) {
      out.api.non2xx.push(`${route.request().method()} ${u.pathname} -> ${resp.status}`);
    }
    await route.fulfill({
      status: resp.status,
      headers: { "content-type": resp.headers.get("content-type") || "application/json" },
      body: buf,
    });
  } catch {
    await route.fulfill({
      status: 502,
      body: JSON.stringify({ success: false, message: "local backend unreachable" }),
    });
  }
});

const page = await ctx.newPage();
page.on("dialog", async (d) => {
  if (dialogMode === "accept") await d.accept();
  else await d.dismiss();
});
page.on("pageerror", (e) => out.errors.push(e.message.slice(0, 250)));

await page.goto(PREVIEW + "/", { waitUntil: "load", timeout: 60000 });
out.http = { title: await page.title() };

// login through the real form (requests intercepted to local backend)
await page.locator('input[placeholder="Enter username"]').fill("superadmin");
await page.locator('input[placeholder="Enter password"]').fill("JustBrand@2026");
await page.locator('button:has-text("Login")').last().click();
await page.locator("button.sidebar-item").first().waitFor({ timeout: 15000 });
ok("admin login via UI", true);

// ===== TASK 1: SCHEME APPROVALS =====
const schemesNav = page.locator('button.sidebar-item:has-text("Scheme Approvals")');
ok(
  "Scheme Approvals in sidebar (enabled)",
  (await schemesNav.isVisible()) && !(await schemesNav.isDisabled())
);
await schemesNav.click();
await page.locator('h2:has-text("Seller Scheme Approvals")').waitFor({ timeout: 10000 });

const pendTab = page.locator('button.sch-tab:has-text("Pending Approval")');
ok("pending tab shows count 2", (await pendTab.innerText()).includes("2"), await pendTab.innerText());

const row1 = page.locator("tr", { hasText: "Festive Percent 10" });
const row2 = page.locator("tr", { hasText: "Flat Clearance 100" });
ok("pending row shows seller name", (await row1.innerText()).includes("Verify Shop"), await row1.locator("td:nth-child(2)").innerText());
ok(
  "pending row shows discount type/value",
  (await row1.innerText()).includes("10% off") && (await row2.innerText()).includes("100 flat off")
);
ok("pending row shows product chip", (await row1.innerText()).includes(`#${prodId}`));
ok(
  "pending row shows dates + status",
  (await row1.innerText()).includes(today) && (await row1.innerText()).includes("Pending Approval")
);

// approve action (real endpoint round-trip). Approved schemes leave
// the Pending filter, so assertions continue on the "All" tab.
await row1.locator('button:has-text("Approve")').click();
await page.locator(".sch-dialog").waitFor({ timeout: 5000 });
await page.locator('.sch-dialog button:has-text("Confirm approve")').click();
await page.locator('.message:has-text("approved")').waitFor({ timeout: 10000 });
await page.locator('button.sch-tab:has-text("All")').click();
ok("approve round-trip (server -> badge Approved)", (await row1.innerText()).includes("Approved"));
ok(
  "approved row has no action buttons",
  (await row1.locator('button:has-text("Approve")').count()) === 0
);

// reject action with reason (still on the All tab)
await row2.locator('button:has-text("Reject")').click();
await page.locator(".sch-dialog").waitFor({ timeout: 5000 });
const confirmReject = page.locator('.sch-dialog button:has-text("Confirm reject")');
ok("reject requires a reason (disabled when empty)", await confirmReject.isDisabled());
await page.locator(".sch-dialog textarea").fill("Margin too thin for this catalogue.");
await confirmReject.click();
await page.locator('.message:has-text("rejected")').waitFor({ timeout: 10000 });
ok(
  "reject round-trip (reason stored as admin note)",
  (await row2.innerText()).includes("Rejected") &&
    (await row2.innerText()).includes("Margin too thin")
);

// filters: Expired (All tab already active above)
await page.locator('button.sch-tab:has-text("Expired")').click();
await page.locator('tr:has-text("Expired Winter 20")').waitFor({ timeout: 5000 });
ok(
  "Expired filter shows expired scheme",
  (await page.locator('tr:has-text("Expired Winter 20")').innerText()).includes("Expired")
);
await page.locator('button.sch-tab:has-text("All")').click();
ok(
  "All filter shows Draft scheme",
  (await page.locator('tr:has-text("Draft Monsoon 5")').innerText()).includes("Draft")
);
await page.screenshot({ path: "/tmp/pw/admin-schemes.png" });

// ===== TASK 2: CONTENT EDITOR =====
await page.locator('button.sidebar-item:has-text("About Us")').click();
const mainDesc = page.locator('label.cm-field', { hasText: "Main description" }).locator("textarea");
await mainDesc.waitFor({ timeout: 10000 });
const style = await mainDesc.evaluate((el) => {
  const s = getComputedStyle(el);
  return { minH: parseFloat(s.minHeight), fs: parseFloat(s.fontSize), lh: parseFloat(s.lineHeight) };
});
ok(
  "textarea sizing (min-height>=100, font>=14, line-height>=22)",
  style.minH >= 100 && style.fs >= 14 && parseFloat(style.lh) >= 22,
  style
);

const HINDI =
  "नमस्ते दुनिया — यह एक लंबा हिंदी पैराग्राफ है जिसमें कई वाक्य और जानकारी है।\nदूसरी लाइन: लाइन ब्रेक सहेजा जाना चाहिए।\nThird line mixed English check123.";
await mainDesc.fill(HINDI);

await page.locator('button:has-text("Preview")').first().click();
const prevP = page.locator(".cm-preview p").first();
await prevP.waitFor({ timeout: 5000 });
const prevCheck = await prevP.evaluate((el) => ({ ws: getComputedStyle(el).whiteSpace, txt: el.innerText }));
ok(
  "preview preserves paragraphs/line breaks (pre-line + newlines)",
  prevCheck.ws === "pre-line" && prevCheck.txt.includes("\n"),
  prevCheck.ws
);
ok(
  "preview shows the typed text",
  prevCheck.txt.includes("नमस्ते दुनिया") && prevCheck.txt.includes("check123")
);
await page.locator('button:has-text("Edit")').first().click();
ok("text intact after preview round-trip", (await mainDesc.inputValue()) === HINDI);

await page.locator('button:has-text("Save")').first().click();
await page.locator('.message:has-text("Content saved")').waitFor({ timeout: 10000 });
ok("save succeeded", true);

await page.reload({ waitUntil: "load" });
await page.locator("button.sidebar-item").first().waitFor({ timeout: 15000 });
await page.locator('button.sidebar-item:has-text("About Us")').click();
await mainDesc.waitFor({ timeout: 10000 });
ok("saved content reloaded after full page reload", (await mainDesc.inputValue()) === HINDI);

// section-switch unsaved guard: dismissed -> stays, text kept
await mainDesc.fill(HINDI + " EDITED-BUT-DISCARDED");
dialogMode = "dismiss";
await page.locator('button.sidebar-item:has-text("Contact Us")').click();
await page.waitForTimeout(600);
ok(
  "switching section with unsaved changes warns (cancel keeps section)",
  (await page.locator(".breadcrumb-current").innerText()).includes("About Us"),
  await page.locator(".breadcrumb-current").innerText()
);
ok("text intact after cancelled switch", (await mainDesc.inputValue()).includes("EDITED-BUT-DISCARDED"));
dialogMode = "accept";
await page.locator('button.sidebar-item:has-text("Contact Us")').click();
await page.locator('.breadcrumb-current:has-text("Contact Us")').waitFor({ timeout: 5000 });
ok("confirming discard navigates to new section", true);

// Cancel + Reset behaviour back on About
await page.locator('button.sidebar-item:has-text("About Us")').click();
await mainDesc.waitFor({ timeout: 10000 });
const restored = await until(async () => (await mainDesc.inputValue()) === HINDI, 6000);
ok("About draft back to saved text after navigation", restored, (await mainDesc.inputValue()).slice(0, 60));
await mainDesc.fill(HINDI + " junk-not-saved");
await page.locator('button:has-text("Cancel")').first().click(); // confirm dialog auto-accepted
await page.waitForTimeout(400);
ok("Cancel restores saved text (no junk kept)", (await mainDesc.inputValue()) === HINDI);
await page.locator('button:has-text("Reset to defaults")').first().click();
await page.waitForTimeout(400);
ok("Reset loads defaults (Hindi draft replaced)", !(await mainDesc.inputValue()).includes("नमस्ते"));
await page.locator('button:has-text("Cancel")').first().click();
await page.waitForTimeout(400);
ok("Cancel after Reset restores saved content", (await mainDesc.inputValue()) === HINDI);

// ===== TASK 3: BANNERS =====
await page.locator('button.sidebar-item:has-text("Homepage Banners")').click();
await page.locator(".sec-count").waitFor({ timeout: 10000 });
ok(
  "6 seeded banners listed (5 active)",
  (await page.locator(".sec-count").innerText()).includes("5 active / 6 total"),
  await page.locator(".sec-count").innerText()
);
ok(
  "all 6 banner rows on page 1",
  (await page.locator('tr:has-text("Seed Banner")').count()) === 6,
  await page.locator('tr:has-text("Seed Banner")').count()
);

await page.locator('button:has-text("Add banner")').click();
await page.locator(".cm-bannerform input[type='text']").first().fill("Verification Banner 7");
await page
  .locator('.cm-bannerform label:has-text("Display order") input')
  .fill("7");
await page.locator('button:has-text("Save banner")').click();
await page.locator('.message:has-text("Banner added")').waitFor({ timeout: 10000 });
ok(
  "banner added via UI (7 total, 6 active)",
  (await page.locator(".sec-count").innerText()).includes("6 active / 7 total"),
  await page.locator(".sec-count").innerText()
);

await page
  .locator("tr", { hasText: "Verification Banner 7" })
  .locator('button:has-text("Edit")')
  .click();
await page.locator(".cm-bannerform input[type='text']").nth(1).fill("Edited subtitle ok");
await page.locator('button:has-text("Save banner")').click();
await page.locator('.message:has-text("Banner updated")').waitFor({ timeout: 10000 });
ok(
  "banner edit persisted",
  (
    await page.locator("tr", { hasText: "Verification Banner 7" }).innerText()
  ).includes("Edited subtitle ok")
);

await page
  .locator("tr", { hasText: "Verification Banner 7" })
  .locator('button:has-text("Hide")')
  .click();
await page.locator('.message:has-text("hidden from")').waitFor({ timeout: 10000 });
ok(
  "enable/disable toggle (active count drops to 5)",
  (await page.locator(".sec-count").innerText()).includes("5 active / 7 total"),
  await page.locator(".sec-count").innerText()
);
await page
  .locator("tr", { hasText: "Verification Banner 7" })
  .locator('button:has-text("Show")')
  .click();
await page.locator('.message:has-text("visible to")').waitFor({ timeout: 10000 });
ok("re-enable banner (6 active)", (await page.locator(".sec-count").innerText()).includes("6 active / 7 total"));

const beforeTitles = await page
  .locator('tr:has-text("Seed Banner") td:nth-child(2) strong')
  .allInnerTexts();
await page
  .locator("tr", { hasText: beforeTitles[0] })
  .locator('button[title="Move down in the slider"]')
  .click();
await page.locator('.message:has-text("order updated")').waitFor({ timeout: 10000 });
const expectFirst = beforeTitles[1];
const movedDown = await until(
  async () =>
    (await page.locator('tr:has-text("Seed Banner") td:nth-child(2) strong').allInnerTexts())[0] ===
    expectFirst
);
const afterTitles = await page
  .locator('tr:has-text("Seed Banner") td:nth-child(2) strong')
  .allInnerTexts();
ok(
  "reorder moves banner down one slot",
  movedDown && afterTitles[0] === beforeTitles[1] && afterTitles[1] === beforeTitles[0],
  { before: beforeTitles.slice(0, 3), after: afterTitles.slice(0, 3) }
);
const orderNums = await page.locator(".cm-ordercell > span").allInnerTexts();
ok(
  "order numbers gap-free after reorder",
  orderNums.join(",") === orderNums.map((_, i) => String(i)).join(","),
  orderNums
);
await page.screenshot({ path: "/tmp/pw/admin-banners.png" });

// ===== TASK 4: HEADER EDITOR =====
await page.locator('button.sidebar-item:has-text("Header Appearance")').click();
await page.locator('.cm-subhead:has-text("A. Logo")').waitFor({ timeout: 10000 });
// The section briefly re-enters its loading skeleton after navigation —
// poll until the editor is fully rendered before reading headings.
const headings = await until(async () => {
  const h = await page.locator(".cm-subhead").allInnerTexts();
  const pv = await page.locator(".cm-headerpreview").isVisible();
  return h.length >= 4 && pv ? h : null;
});
ok(
  "sections A/B/C/D clearly organised",
  headings.some((h) => h.includes("A. Logo")) &&
    headings.some((h) => h.includes("B. Brand name")) &&
    headings.some((h) => h.includes("C. Cart icon")) &&
    headings.some((h) => h.includes("D. Account & Wishlist")),
  headings
);
ok("live preview present", (await page.locator(".cm-headerpreview").isVisible()) === true);
const legend = await page.locator(".cm-legend").innerText();
ok(
  "preview legend labels Account/Wishlist/Cart",
  legend.includes("Account") && legend.includes("Wishlist") && legend.includes("Cart"),
  legend
);

const nameInput = page.locator('label.cm-field', { hasText: "Brand name text" }).locator("input");
await nameInput.fill("VerifyBrand");
// React state → live preview is asynchronous. Poll instead of reading in
// the same tick (the previous immediate read was timing-dependent).
ok(
  "preview updates live",
  Boolean(await until(async () => (await page.locator(".cm-hp-name").innerText()) === "VerifyBrand", 6000)),
  await page.locator(".cm-hp-name").innerText()
);
await page.locator('button:has-text("Preview")').first().click();
ok(
  "preview mode shows settings summary",
  (await page.locator(".cm-summarylist").innerText()).includes("Account/Wishlist")
);
await page.locator('button:has-text("Edit")').first().click();
await page.locator('button:has-text("Save")').first().click();
await page.locator('.message:has-text("Content saved")').waitFor({ timeout: 10000 });

await page.reload({ waitUntil: "load" });
await page.locator("button.sidebar-item").first().waitFor({ timeout: 15000 });
await page.locator('button.sidebar-item:has-text("Header Appearance")').click();
await page
  .locator('label.cm-field', { hasText: "Brand name text" })
  .locator("input")
  .waitFor({ timeout: 10000 });
ok(
  "header settings persisted after reload",
  Boolean(
    await until(
      async () =>
        (await page
          .locator('label.cm-field', { hasText: "Brand name text" })
          .locator("input")
          .inputValue()) === "VerifyBrand",
      6000
    )
  ),
  await page.locator('label.cm-field', { hasText: "Brand name text" }).locator("input").inputValue()
);

// save/load contract: payload shape the Buyer header reads is unchanged.
// Poll the API too: the UI success message can render just before the
// fetched settings state has settled on a slow preview backend.
const h = await until(async () => {
  const settingsAfter = await api("GET", "/api/admin/site/settings", { token: adminToken });
  const header = settingsAfter.data?.settings?.header || {};
  return header.name?.text === "VerifyBrand" ? header : null;
}, 6000);
ok(
  "header payload keeps Buyer contract keys",
  !!h && ["enabled", "logo", "name", "cart", "actions"].every((k) => k in h),
  Object.keys(h || {})
);
await page.screenshot({ path: "/tmp/pw/admin-header.png" });

out.apiCallsIntercepted = out.api.calls;
await browser.close();
clearTimeout(watchdog);
be.kill("SIGTERM");
console.log(JSON.stringify(out, null, 2));
process.exit(out.failed ? 1 : 0);
