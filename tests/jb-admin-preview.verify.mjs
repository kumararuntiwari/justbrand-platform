// =====================================================
// JUSTBRAND — browser verification: Admin PREVIEW (real, no stubs)
// =====================================================
// Verifies the FIX for "Request failed (404)" in Commerce → Charges & Tax:
//   - Every admin API request goes SAME-ORIGIN (the preview injects
//     window.__JB_API_BASE__ = "" and proxies /api to an isolated
//     local backend) — ZERO requests to production Hostinger.
//   - The exact endpoint /api/admin/charges/settings answers 200
//     with a token (it is 404 on the stale production backend).
//   - Delivery charge, platform fee and category GST save + reload
//     (load) round-trips work against the isolated backend.
//   - Empty/absent data renders honest copy — no fabricated products,
//     no non-statutory GST rates, no fake success.
//   - When the API fails, a CLEAR error is shown instead of cards.
//
// NO route interception of production is used — the preview itself
// must never call production. A single deliberate 503 interception
// proves the unavailable-state error copy.
//
// Run (Playwright available, e.g. from /tmp/pw):
//   node jb-admin-preview.verify.mjs

import { chromium } from "playwright";

const PREVIEW =
  process.env.ADMIN_URL ||
  "https://8007-0b7228e1-2c82-43c9-adf0-a376dbc7f0fc.daytonaproxy01.net";
const HOSTINGER = "justbrand-in-144629.hostingersite.com";
const SLABS = ["0", "0.5", "1.2", "1.5", "3", "5", "6", "12", "18", "28"];

const out = { errors: [], steps: {}, api: {} };
function ok(name, cond, extra) {
  out.steps[name] = cond ? "PASS" : `FAIL ${extra !== undefined ? JSON.stringify(extra) : ""}`;
  if (!cond) out.failed = (out.failed || 0) + 1;
}
const watchdog = setTimeout(() => {
  console.log(JSON.stringify(out, null, 2));
  console.error("WATCHDOG TIMEOUT");
  process.exit(2);
}, 150000);

const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1440, height: 1050 } });
const page = await ctx.newPage();

const hostingerRequests = [];
const seen = { settingsUrl: null, staffLoginUrl: null };
page.on("request", (req) => {
  const u = req.url();
  if (u.includes(HOSTINGER)) hostingerRequests.push(u);
  if (u.includes("/api/admin/charges/settings") && !seen.settingsUrl) seen.settingsUrl = u;
  if (u.includes("/api/staff/login") && !seen.staffLoginUrl) seen.staffLoginUrl = u;
});
page.on("pageerror", (e) => out.errors.push(e.message.slice(0, 250)));

const card = (title) =>
  page
    .locator("section.products-section")
    .filter({ has: page.locator("h2", { hasText: title }) });

async function ensureLogin() {
  if (await page.locator("button.sidebar-item").first().isVisible().catch(() => false)) return;
  await page.goto(PREVIEW + "/", { waitUntil: "load", timeout: 60000 });
  await page.locator('input[placeholder="Enter username"]').waitFor({ timeout: 20000 });
  await page.locator('input[placeholder="Enter username"]').fill("superadmin");
  await page.locator('input[placeholder="Enter password"]').fill("JustBrand@2026");
  await page.locator('button:has-text("Login")').last().click();
  await page.locator("button.sidebar-item").first().waitFor({ timeout: 20000 });
}

async function openCharges() {
  await page.locator('button.sidebar-item:has-text("Charges & Tax")').click();
  await page.locator('h2:has-text("Delivery Charge")').waitFor({ timeout: 15000 });
}

// ---------- 1. login (must be same-origin) ----------
await ensureLogin();
ok("admin login request is same-origin (not Hostinger)", Boolean(seen.staffLoginUrl) && seen.staffLoginUrl.startsWith(PREVIEW), seen.staffLoginUrl);
ok("login via UI", true);

// ---------- 2. open Charges & Tax ----------
await openCharges();
ok("exact endpoint /api/admin/charges/settings is same-origin", Boolean(seen.settingsUrl) && seen.settingsUrl.startsWith(PREVIEW + "/api/admin/charges/settings"), seen.settingsUrl);

const titles = await page.locator(".products-section h2").allInnerTexts();
ok(
  "all 6 cards present (endpoint 200 instead of 404)",
  ["Delivery Charge", "Platform Fee", "GST Settings", "Category-wise GST Rates", "GST Review Flags", "Platform Revenue"].every((t) => titles.some((h) => h.includes(t))),
  titles
);
ok("no load error visible", (await page.locator("text=Request failed").count()) === 0);

// ---------- 3. honest empty/absent data (no fabrication) ----------
// Data-aware: the isolated preview DB may hold real seeded rows from
// other verification runs — "no fabrication" means the UI renders
// EXACTLY what the backend reports (empty state only when empty),
// never invented rows.
const staffTok = await (async () => {
  const r = await fetch(PREVIEW + "/api/staff/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "superadmin", password: "JustBrand@2026" }),
  });
  return (await r.json()).token;
})();
const reviewApi = await (await fetch(PREVIEW + "/api/admin/charges/gst-review", {
  headers: { Authorization: `Bearer ${staffTok}` },
})).json();
const apiFlags = (reviewApi && reviewApi.products) || [];
const flagRows = await card("GST Review Flags").locator("tbody tr").count();
const reviewText = await card("GST Review Flags").innerText();
ok(
  "review flags: UI matches backend exactly (no fabricated products)",
  apiFlags.length === 0
    ? flagRows === 0 && /nothing pending review/i.test(reviewText)
    : flagRows === apiFlags.length && apiFlags.every((p) => reviewText.includes(p.name)),
  { api: apiFlags.length, ui: flagRows }
);
const rateRows = await card("Category-wise GST Rates").locator("tbody tr").allInnerTexts();
const rateValues = rateRows.map((r) => (r.match(/(\d+(?:\.\d+)?)\s*%/) || [])[1]).filter(Boolean);
ok(
  "category rates: only statutory slabs ever displayed (or empty)",
  rateValues.every((v) => SLABS.includes(v)),
  rateRows
);
const revApi = await (await fetch(PREVIEW + "/api/admin/charges/platform-revenue", {
  headers: { Authorization: `Bearer ${staffTok}` },
})).json();
const apiRecent = (revApi && revApi.recent) || [];
const revText = await card("Platform Revenue").innerText();
const revRows = await card("Platform Revenue").locator("tbody tr").count();
ok(
  "revenue: UI matches backend exactly (empty copy only when empty)",
  apiRecent.length === 0
    ? revText.includes("No orders with a fee breakdown yet.")
    : revRows === apiRecent.length &&
      apiRecent.every((r) => r.orderNumber && revText.includes(String(r.orderNumber))),
  { api: apiRecent.length, ui: revRows }
);

// ---------- 4. save → reload → load round-trips ----------
await card("Delivery Charge").locator('.cm-grid2 input[type="number"]').first().fill("65");
await page.locator('button:has-text("Save delivery")').click();
await page.locator('.message:has-text("Delivery charge settings saved")').waitFor({ timeout: 15000 });

await card("Platform Fee").locator('label.cm-checkline:has-text("Per order (once)") input').check();
await card("Platform Fee").locator('.cm-grid4 input[type="number"]').first().fill("25");
await card("Platform Fee").locator("select").first().selectOption("flat");
await page.locator('button:has-text("Save fee")').click();
await page.locator('.message:has-text("Platform fee settings saved")').waitFor({ timeout: 15000 });

await card("GST Settings").locator("select").first().selectOption("Uttar Pradesh");
await page.locator('button:has-text("Save GST settings")').click();
await page.locator('.message:has-text("GST settings saved")').waitFor({ timeout: 15000 });

await card("Category-wise GST Rates").locator('input[list="chg-category-list"]').fill("Electronics");
await card("Category-wise GST Rates").locator("select").first().selectOption("18");
await card("Category-wise GST Rates").locator('input[placeholder="4–8 digits"]').fill("8517");
await page.locator('button:has-text("Save rate")').click();
await page.locator('.message:has-text("saved for")').first().waitFor({ timeout: 15000 });
ok("all three save calls succeeded (delivery, fee, GST + rate)", true);

// Full reload: values must come BACK from the isolated backend's DB.
await page.reload({ waitUntil: "load" });
await ensureLogin();
await openCharges();

const dNote = await card("Delivery Charge").locator(".ov-note").innerText();
const pNote = await card("Platform Fee").locator(".ov-note").innerText();
const gNote = await card("GST Settings").locator(".ov-note").innerText();
// Root-cause fix: the preview DB legitimately contains other categories
// whose names CONTAIN the word "Electronics" (for example the older
// "TEST Electronics Onboarding" row). A substring locator counted those
// too and made a correct DB/UI look like a duplicate. Assert the exact
// category cell and the saved rate/HSN instead — without deleting or
// rewriting any existing preview record.
const rateRowsAfterReload = await card("Category-wise GST Rates")
  .locator("tbody tr")
  .allInnerTexts();
const exactElectronicsRows = rateRowsAfterReload.filter((text) => {
  const cells = text.split(/[\t\n]/).map((part) => part.trim()).filter(Boolean);
  return cells[0] === "Electronics" && cells.some((c) => c === "18%") && cells.includes("8517");
});
ok("LOAD after reload: delivery ₹65 flat", dNote.includes("Current: ₹65 flat"), dNote);
ok("LOAD after reload: platform ₹25 once per order", pNote.includes("₹25 once per order"), pNote);
ok("LOAD after reload: GST origin Uttar Pradesh", gNote.includes("Origin: Uttar Pradesh"), gNote);
ok(
  "LOAD after reload: exact Electronics 18% + 8517 row persisted",
  exactElectronicsRows.length >= 1,
  { exactElectronicsRows, rateRowsAfterReload }
);

// ---------- 5. unavailable API → clear error, no fake cards ----------
await page.route("**/api/admin/charges/settings", (route) =>
  route.fulfill({
    status: 503,
    contentType: "application/json",
    body: JSON.stringify({ success: false, message: "Preview backend unavailable (simulated)." }),
  })
);
await page.reload({ waitUntil: "load" });
await ensureLogin();
await page.locator('button.sidebar-item:has-text("Charges & Tax")').click();
await page.locator("text=Preview backend unavailable (simulated)").waitFor({ timeout: 15000 });
const errShown = await page.locator("text=Preview backend unavailable (simulated)").isVisible();
const cardsDuringOutage = (await page.locator('h2:has-text("Delivery Charge")').count()) === 0;
ok("API unavailable → clear error message shown", errShown);
ok("API unavailable → no section cards / no fake data", cardsDuringOutage);
await page.unroute("**/api/admin/charges/settings");

await page.reload({ waitUntil: "load" });
await ensureLogin();
await openCharges();
ok("recovers after API is back", await page.locator('h2:has-text("Delivery Charge")').isVisible());

// ---------- 6. production was NEVER contacted ----------
ok("ZERO requests to production Hostinger during the whole session", hostingerRequests.length === 0, hostingerRequests.slice(0, 5));
out.api.hostingerRequests = hostingerRequests.length;
out.api.settingsUrl = seen.settingsUrl;

await page.screenshot({ path: "/tmp/pw/admin-preview-local.png", fullPage: true });
console.log(JSON.stringify(out, null, 2));
await browser.close();
clearTimeout(watchdog);
process.exit(out.failed ? 1 : 0);
