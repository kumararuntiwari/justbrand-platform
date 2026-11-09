// =====================================================
// JUSTBRAND — browser verification: Charges & Tax admin section
// =====================================================
// Spawns the REAL backend on an isolated port with a THROWAWAY
// database, intercepts every production API call from the Admin
// preview and routes it there — production is never contacted.
//
// Verifies: section loads with all 6 cards, delivery save + previous
// value, platform fee basis change, GST origin save, category GST rate
// add, GST review flag + admin classification apply, revenue tiles.
//
// Run (Playwright available, e.g. from /tmp/pw):
//   node jb-admin-charges.verify.mjs

import { chromium } from "playwright";
import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";
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
const DB_DIR = "/tmp/pw/jb-charges-verify-db";

const out = { errors: [], steps: {} };
function ok(name, cond, extra) {
  out.steps[name] = cond ? "PASS" : `FAIL ${extra !== undefined ? JSON.stringify(extra) : ""}`;
  if (!cond) out.failed = (out.failed || 0) + 1;
}
let be = null;
function cleanup() {
  try {
    if (be) be.kill("SIGTERM");
  } catch {}
}
// Never orphan the test backend — a leftover listener on our port
// silently serves a stale DB and produces phantom duplicate rows.
process.on("uncaughtException", (e) => {
  cleanup();
  console.error(e && e.stack ? e.stack : e);
  console.log(JSON.stringify(out, null, 2));
  process.exit(1);
});
const watchdog = setTimeout(() => {
  console.log(JSON.stringify(out, null, 2));
  console.error("WATCHDOG TIMEOUT");
  cleanup();
  process.exit(2);
}, 160000);

// ---------- local backend ----------
// Pre-spawn stale-listener probe: a leftover backend on this port
// answers health instantly and races past the post-spawn guard (our
// child's EADDRINUSE exit lands a few ms later), so seeds would land
// in a stale DB and produce phantom duplicate rows. Refuse instead.
{
  let held = false;
  try {
    await fetch(`${LOCAL}/api/health`, { signal: AbortSignal.timeout(2000) });
    held = true; // something already answered
  } catch (e) {
    held = !!(e && e.name === "TimeoutError"); // accepted but stalled = still held
  }
  if (held) {
    console.log(`STALE LISTENER on ${LOCAL} — a leftover test backend owns this port. Kill it and re-run.`);
    process.exit(3);
  }
}
rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });
be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: { ...process.env, PORT: "4611", JWT_SECRET: "jb-charges-test-secret-local-only" },
  stdio: ["ignore", "pipe", "pipe"],
});
let beErr = "";
be.stderr.on("data", (d) => (beErr = (beErr + d.toString()).slice(-2000)));

let up = false;
for (let i = 0; i < 75 && !up && be.exitCode === null; i++) {
  try {
    up = (await fetch(`${LOCAL}/api/health`)).ok;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up || be.exitCode !== null) {
  // Health answering while our own child is dead = a stale listener
  // from a previous run owns the port. Refuse to "verify" against it.
  console.log(
    `BACKEND NOT USABLE (up=${up}, childExit=${be.exitCode}) — port already in use by a leftover test backend?\n` + beErr
  );
  cleanup();
  process.exit(3);
}

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
  } catch {}
  return { status: res.status, data };
}

// ---------- seed: seller+product (unclassified), customer+order ----------
const aLogin = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const staff = aLogin.data?.token;
const reg = await api("POST", "/api/sellers/register", {
  body: {
    name: "Verify Seller",
    shopName: "Verify Shop",
    mobile: "9876500444",
    email: "vcharges@x.com",
    password: "seller123",
  },
});
await api("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
  token: staff,
  body: { kycStatus: "Approved" },
});
const sLogin = await api("POST", "/api/sellers/login", {
  body: { mobile: "9876500444", password: "seller123" },
});
const taxReady = await onboardGstSeller(api, {
  sellerToken: sLogin.data?.token,
  staffToken: staff,
});
ok("seller KYC + PAN + GST approved", taxReady.ok);
const prod = await api("POST", "/api/sellers/products", {
  token: sLogin.data?.token,
  body: {
    name: "Unclassified Book",
    category: "Books",
    price: "₹200",
    images: ["https://cdn.example.com/bk.jpg"],
  },
});
const prodId = prod.data?.product?.id;
await api("PUT", `/api/admin/products/${prodId}/approve`, { token: staff });

const cReg = await api("POST", "/api/customers/register", {
  body: {
    name: "Verify Buyer",
    mobile: "9876500555",
    email: "vbuyer@x.com",
    password: "buyer1234",
  },
});
const cLogin = await api("POST", "/api/customers/login", {
  body: { mobile: "9876500555", password: "buyer1234" },
});
const customer = cLogin.data?.token;
const q = await api("POST", "/api/orders/quote", {
  token: customer,
  body: { items: [{ productId: prodId, quantity: 2 }], state: "Uttar Pradesh" },
});
const order = await api("POST", "/api/orders", {
  token: customer,
  body: {
    items: [{ productId: prodId, quantity: 2 }],
    address: "99 Verify Lane, Test Nagar, India",
    phone: "9876500555",
    state: "Uttar Pradesh",
    paymentMethod: "COD",
    clientGrandTotal: q.data?.quote?.grandTotal,
  },
});
ok(
  "seed: quote + order placed with matching total",
  order.status === 201 && Number(order.data?.order?.totalAmount) === Number(q.data?.quote?.grandTotal),
  { status: order.status, total: order.data?.order?.totalAmount, quote: q.data?.quote?.grandTotal }
);

// ---------- browser ----------
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
// Same-origin preview (/api proxy) AND legacy production URLs both
// answer from the local throwaway backend — production never touched.
await ctx.route(/\/api\//, async (route) => {
  const u = new URL(route.request().url());
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
// Scoped card helper: title text also appears in tiles/descriptions,
// so match on the card's own <h2>.
const card = (title) =>
  page
    .locator("section.products-section")
    .filter({ has: page.locator("h2", { hasText: title }) });
page.on("pageerror", (e) => out.errors.push(e.message.slice(0, 250)));
await page.goto(PREVIEW + "/", { waitUntil: "load", timeout: 60000 });
await page.locator('input[placeholder="Enter username"]').fill("superadmin");
await page.locator('input[placeholder="Enter password"]').fill("JustBrand@2026");
await page.locator('button:has-text("Login")').last().click();
await page.locator("button.sidebar-item").first().waitFor({ timeout: 15000 });
ok("admin login via UI", true);

// ---- open Charges & Tax ----
await page.locator('button.sidebar-item:has-text("Charges & Tax")').click();
await page.locator('h2:has-text("Delivery Charge")').waitFor({ timeout: 10000 });
const titles = await page.locator(".products-section h2").allInnerTexts();
ok(
  "all 6 cards present",
  ["Delivery Charge", "Platform Fee", "GST Settings", "Category-wise GST Rates", "GST Review Flags", "Platform Revenue"].every(
    (t) => titles.some((h) => h.includes(t))
  ),
  titles
);

// ---- 1. delivery: save + previous value ----
const deliveryValue = card("Delivery Charge").locator('.cm-grid2 input[type="number"]').first();
await deliveryValue.fill("75");
await page.locator('button:has-text("Save delivery")').click();
await page.locator('.message:has-text("Delivery charge settings saved")').waitFor({ timeout: 10000 });
ok("delivery save #1 (flat 75)", (await card("Delivery Charge").innerText()).includes("₹75 flat"));

await deliveryValue.fill("90");
await page.locator('button:has-text("Save delivery")').click();
// The note renders the LIVE edit state (fill("90") alone shows ₹90), and
// both saves emit the SAME toast text — so wait for the one thing only
// save #2's response can render: the "Previous:" label. (has-text is
// case-insensitive; the colon matters — the empty state says
// "no previous save yet", without a colon.)
await card("Delivery Charge").locator('.ov-note:has-text("Previous:")').waitFor({ timeout: 10000 });
const deliveryNote = await card("Delivery Charge").locator(".ov-note").innerText();
ok(
  "previous value visible after save #2",
  deliveryNote.includes("Current: ₹90 flat") &&
    deliveryNote.includes("Previous:") && // capital-P label; the empty
    deliveryNote.includes("₹75 flat"), //  state says "no previous save yet"
  deliveryNote
);

// ---- 2. platform fee: basis + amount ----
await page.locator('label.cm-checkline:has-text("Per order (once)") input').check();
const platformValue = card("Platform Fee").locator('.cm-grid4 input[type="number"]').first();
await platformValue.fill("20");
await card("Platform Fee").locator("select").first().selectOption("flat"); // fee type
await page.locator('button:has-text("Save fee")').click();
await page.locator('.message:has-text("Platform fee settings saved")').waitFor({ timeout: 10000 });
const platformCard = (await card("Platform Fee").innerText()).toLowerCase(); // example line is CSS-uppercased
// describePlatform() renders flat as "₹20" (no "flat" word) + basis:
// "₹20 once per order" pins amount + mode + per-order basis together.
ok(
  "platform fee saved: flat ₹20 once per order + worked example",
  platformCard.includes("₹20 once per order") && platformCard.includes("fee = ₹20.00"),
  platformCard.replace(/\s+/g, " ").slice(0, 400)
);

// ---- 3. GST origin ----
const gstCard = card("GST Settings");
await gstCard.locator("select").first().selectOption("Uttar Pradesh");
await page.locator('button:has-text("Save GST settings")').click();
await page.locator('.message:has-text("GST settings saved")').waitFor({ timeout: 10000 });
ok("GST origin saved + shown", (await gstCard.innerText()).includes("Origin: Uttar Pradesh"));

// ---- 4. category rate ----
const rateCard = card("Category-wise GST Rates");
await rateCard.locator('input[list="chg-category-list"]').fill("Electronics");
await rateCard.locator("select").first().selectOption("18");
await rateCard.locator('input[placeholder="4–8 digits"]').fill("8517");
await rateCard.locator('button:has-text("Save rate")').click();
await page.locator('.message:has-text("saved for")').first().waitFor({ timeout: 10000 });
await rateCard.locator("tbody tr", { hasText: "Electronics" }).waitFor({ timeout: 5000 });
const rateRow = await rateCard.locator("tbody tr", { hasText: "Electronics" }).innerText();
ok("category rate row added (18% + HSN)", rateRow.includes("18%") && rateRow.includes("8517"), rateRow);

// ---- 5. review flag + apply classification ----
const reviewCard = card("GST Review Flags");
await reviewCard.locator("tbody tr", { hasText: "Unclassified Book" }).waitFor({ timeout: 5000 });
ok(
  "unclassified product flagged",
  (await reviewCard.innerText()).includes("no category rate") ||
    (await reviewCard.innerText()).includes("no_category_rate"),
  (await reviewCard.innerText()).replace(/\s+/g, " ").slice(0, 250)
);
const reviewRow = reviewCard.locator("tbody tr", { hasText: "Unclassified Book" });
await reviewRow.locator("select").selectOption("5");
await reviewRow.locator('input[placeholder="HSN"]').fill("4901");
await reviewRow.locator('button:has-text("Apply")').click();
await page.locator('.message:has-text("GST classification saved")').waitFor({ timeout: 10000 });
await page.waitForTimeout(600);
ok(
  "flag cleared after admin classification",
  (await reviewCard.locator("tbody tr", { hasText: "Unclassified Book" }).count()) === 0,
  await reviewCard.innerText()
);

// ---- 6. revenue ----
const revCard = card("Platform Revenue");
await revCard.locator(".chg-tile").first().waitFor({ timeout: 5000 });
const revText = (await revCard.innerText()).toLowerCase(); // tiles are CSS-uppercased
ok(
  "revenue tiles + order-wise breakdown row",
  revText.includes("platform fee collected") &&
    revText.includes("orders with breakdown") &&
    (await revCard.locator("tbody tr").count()) >= 1,
  revText.replace(/\s+/g, " ").slice(0, 300)
);

await page.screenshot({ path: "/tmp/pw/admin-charges.png", fullPage: true });
out.apiNote = "all API traffic intercepted → local throwaway backend";
console.log(JSON.stringify(out, null, 2));
await browser.close();
clearTimeout(watchdog);
be.kill("SIGTERM");
process.exit(out.failed ? 1 : 0);
