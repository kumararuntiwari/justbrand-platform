// =====================================================
// JUSTBRAND — browser verification: Courier Partners +
// Payment Settings admin sections (additive UI)
// =====================================================
// Drives the REAL admin preview (same-origin /api → the preview's
// ISOLATED local backend; production is never contacted) and verifies:
//   - The two new sidebar entries exist (Commerce group).
//   - Courier Partners section: 4 seeded companies, Manual Mode banner,
//     per-partner config save (enable + rates), per-order booking card.
//   - Payment Settings section: honest "no gateway" banner, UPI enable
//     + UPI ID save, persistence across reload.
//   - Orders tab still renders (regression).
//
// Run: node tests/jb-admin-courier-ui.verify.mjs
// (ADMIN_URL env overrides the admin preview URL)

import { chromium } from "playwright";

const ADMIN_URL =
  process.env.ADMIN_URL ||
  "https://8006-0b7228e1-2c82-43c9-adf0-a376dbc7f0fc.daytonaproxy01.net";

const out = { errors: [], steps: {} };
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
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1000 } });
const page = await ctx.newPage();
page.on("pageerror", (e) => out.errors.push(e.message.slice(0, 250)));

// ---------- login ----------
await page.goto(ADMIN_URL + "/", { waitUntil: "load", timeout: 60000 });
await page.locator('input[placeholder="Enter username"]').fill("superadmin");
await page.locator('input[placeholder="Enter password"]').fill("JustBrand@2026");
await page.locator('button:has-text("Login")').last().click();
await page.locator("button.sidebar-item").first().waitFor({ timeout: 15000 });
ok("admin login via UI", true);

// ---------- new sidebar entries ----------
const sidebarText = await page.locator(".admin-sidebar").innerText();
ok(
  "sidebar has Courier Partners + Payment Settings entries",
  sidebarText.includes("Courier Partners") && sidebarText.includes("Payment Settings"),
  sidebarText.replace(/\s+/g, " ").slice(0, 300)
);

// ---------- Courier Partners section ----------
await page.locator('button.sidebar-item:has-text("Courier Partners")').click();
await page.locator('h2:has-text("Courier Partners (Logistics Companies)")').waitFor({ timeout: 10000 });
// wait for the partner table to finish loading before reading text
await page.locator("section.products-section table.sec-table tbody tr").first().waitFor({ timeout: 15000 });
// A previous section can leave an empty/old tbody in place while the courier
// request is still in flight, so wait for the actual seeded company names.
await page
  .locator("section.products-section")
  .filter({ hasText: "India Post" })
  .filter({ hasText: "DTDC" })
  .first()
  .waitFor({ timeout: 15000 });
// NOTE: the admin CSS uppercases section text (text-transform), so
// innerText comparisons are done case-insensitively below.
const sectionText = (await page.locator("section.products-section").first().innerText()).replace(/\s+/g, " ");
const sectionLc = sectionText.toLowerCase();
ok(
  "4 seeded courier companies visible",
  ["india post", "ekart", "shiprocket", "dtdc"].every((n) => sectionLc.includes(n)),
  sectionText.slice(0, 300)
);
ok("Manual Mode honesty banner visible", sectionLc.includes("manual mode"), sectionText.slice(0, 200));
ok(
  "no fake live tracking claimed",
  sectionText.toLowerCase().includes("nothing is auto-synced") ||
    sectionText.toLowerCase().includes("no live tracking"),
  sectionText.slice(0, 200)
);

// enable DTDC + save its row
const dtdcRow = page.locator("table.sec-table tbody tr", { hasText: "DTDC" }).first();
await dtdcRow.locator('input[type="checkbox"]').first().check();
await dtdcRow.locator('button:has-text("Save")').click();
await page.locator('.message:has-text("settings saved")').waitFor({ timeout: 10000 });
ok("partner config save works (DTDC enabled)", true);
// persistence: reload → DTDC still enabled
await page.reload({ waitUntil: "load" });
await page.locator('button.sidebar-item:has-text("Courier Partners")').click();
await page.locator('h2:has-text("Courier Partners (Logistics Companies)")').waitFor({ timeout: 10000 });
const dtdcRowAfter = page.locator("table.sec-table tbody tr", { hasText: "DTDC" }).first();
ok(
  "partner enable state persists after reload",
  await dtdcRowAfter.locator('input[type="checkbox"]').first().isChecked()
);

// ---------- seed one order through the preview API so the booking
// table has a real row (same isolated backend the UI uses) ----------
{
  const staffTok = await page.evaluate(() => localStorage.getItem("justbrand_staff_token"));
  const j = async (method, p, body, token) => {
    const res = await fetch(ADMIN_URL + p, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
    return { status: res.status, data: await res.json().catch(() => null) };
  };
  const reg = await j("POST", "/api/sellers/register", {
    name: "UI Seller",
    shopName: "UI Shop",
    mobile: "9911223344",
    email: "uiseller@x.com",
    password: "seller123",
  });
  await j("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, { kycStatus: "Approved" }, staffTok);
  const sLogin = await j("POST", "/api/sellers/login", {
    mobile: "9911223344",
    password: "seller123",
  });
  const sellerTok = sLogin.data?.token;
  await j(
    "PUT",
    "/api/sellers/kyc",
    {
      panNumber: "AAAPZ1234C",
      address: "99 Courier Test Street, Mumbai",
      city: "Mumbai",
      state: "Maharashtra",
      pincode: "400001",
    },
    sellerTok
  );
  let sellerId = reg.data?.seller?.id;
  if (!sellerId) {
    const sellerList = await j("GET", "/api/admin/sellers", null, staffTok);
    sellerId = (sellerList.data?.sellers || []).find((s) => s.mobile === "9911223344")?.id;
  }
  await j("PUT", `/api/admin/sellers/${sellerId}/kyc`, { kycStatus: "Approved" }, staffTok);
  await j("PUT", `/api/admin/sellers/${sellerId}/pan`, { panStatus: "Verified" }, staffTok);
  await j("POST", "/api/sellers/gst", { gstin: "27AAPFU0939F1ZV" }, sellerTok);
  const gstApproval = await j(
    "PUT",
    `/api/admin/sellers/${sellerId}/gst`,
    { gstStatus: "Approved" },
    staffTok
  );
  ok("seller KYC + PAN + GST approved", gstApproval.status === 200, gstApproval.data);
  const prod = await j(
    "POST",
    "/api/sellers/products",
    { name: "UI Courier Product", category: "Fashion", price: "₹300", images: ["https://cdn.example.com/u1.jpg"] },
    sLogin.data?.token
  );
  await j("PUT", `/api/admin/products/${prod.data?.product?.id}/approve`, {}, staffTok);
  await j("POST", "/api/customers/register", {
    name: "UI Buyer",
    mobile: "9911556677",
    email: "uibuyer@x.com",
    password: "buyer1234",
  });
  const cLogin = await j("POST", "/api/customers/login", {
    mobile: "9911556677",
    password: "buyer1234",
  });
  const order = await j(
    "POST",
    "/api/orders",
    {
      items: [{ productId: prod.data?.product?.id, quantity: 1 }],
      address: "9 UI Street, Lucknow",
      phone: "9911556677",
      state: "Uttar Pradesh",
      city: "Lucknow",
      pincode: "226001",
      paymentMethod: "COD",
    },
    cLogin.data?.token
  );
  out.seededOrderId = order.data?.order?.id || null;
  ok("seed: one COD order placed via preview API", order.status === 201, order.data);
}

// per-order booking card
const bookingCard = page
  .locator("section.products-section")
  .filter({ has: page.locator("h2", { hasText: "Per-Order Courier Booking" }) });
await bookingCard.waitFor({ timeout: 10000 });
ok(
  "per-order courier booking card present (AWB / label / status)",
  (await bookingCard.innerText()).includes("AWB"),
  null
);
// the card mounted BEFORE the seed — refresh it so the new order row appears
await bookingCard.locator('button:has-text("Refresh")').click();
const seededRow = bookingCard.locator("tbody tr").first();
await seededRow.waitFor({ timeout: 15000 });
const bookingHead = (await bookingCard.locator("thead").innerText()).toLowerCase();
ok(
  "booking table has courier + AWB + label + status columns",
  ["courier partner", "awb / tracking no.", "label ref", "courier status"].every((h) =>
    bookingHead.includes(h)
  ),
  bookingHead
);

// full UI booking: select Ekart + AWB + label ref + save
await seededRow.locator("select").first().selectOption({ label: "DTDC" });
await seededRow.locator('input[placeholder="AWB number"]').fill("DTDC-UI-5566");
await seededRow.locator('input[placeholder="Label ref"]').fill("LBL-UI-9");
await seededRow.locator('button:has-text("Save")').click();
await page.locator('.message:has-text("Courier booking saved")').waitFor({ timeout: 10000 });
ok("booking saved via UI (partner + AWB + label ref)", true);
const rowAfter = await bookingCard.locator("tbody tr").first().innerText();
const awbAfter = await seededRow.locator('input[placeholder="AWB number"]').inputValue();
const labelAfter = await seededRow.locator('input[placeholder="Label ref"]').inputValue();
ok(
  "booking row shows courier + AWB + label after save",
  rowAfter.toUpperCase().includes("DTDC") && awbAfter === "DTDC-UI-5566" && labelAfter === "LBL-UI-9",
  { row: rowAfter.replace(/\s+/g, " ").slice(0, 160), awbAfter, labelAfter }
);

await page.screenshot({ path: "/tmp/pw/admin-courier-partners.png", fullPage: true });

// ---------- Payment Settings section ----------
await page.locator('button.sidebar-item:has-text("Payment Settings")').click();
await page.locator('h2:has-text("Payment Settings")').waitFor({ timeout: 10000 });
// wait for the settings draft to finish loading (save button renders last)
await page.locator('button:has-text("Save payment settings")').waitFor({ timeout: 15000 });
const payText = (await page.locator("section.products-section").first().innerText()).replace(/\s+/g, " ");
const payLc = payText.toLowerCase();
ok(
  "honest gateway banner: no online gateway connected",
  payLc.includes("no online payment gateway is connected"),
  payText.slice(0, 200)
);
ok(
  "COD marked always-on",
  payLc.includes("cash on delivery") && payLc.includes("always on"),
  payText.slice(0, 200)
);

// enable UPI + save UPI ID
await page.locator('label:has-text("UPI Transfer (manual)") input[type="checkbox"]').check();
await page.locator('input[placeholder="yourname@upi"]').fill("justbrand@upi");
const [payResp] = await Promise.all([
  page.waitForResponse(
    (r) => r.url().includes("/api/admin/payment/settings") && r.request().method() === "PUT",
    { timeout: 15000 }
  ),
  page.locator('button:has-text("Save payment settings")').click(),
]);
ok("payment settings save API returned 200", payResp.status() === 200, payResp.status());

// persistence + live public config check
await page.reload({ waitUntil: "load" });
await page.locator('button.sidebar-item:has-text("Payment Settings")').click();
await page.locator('h2:has-text("Payment Settings")').waitFor({ timeout: 10000 });
await page.locator('button:has-text("Save payment settings")').waitFor({ timeout: 15000 });
const upiChecked = await page
  .locator('label:has-text("UPI Transfer (manual)") input[type="checkbox"]')
  .isChecked();
const upiValue = await page.locator('input[placeholder="yourname@upi"]').inputValue();
ok("UPI setting persists after reload", upiChecked && upiValue === "justbrand@upi", { upiChecked, upiValue });

const publicConfig = await (await fetch(ADMIN_URL + "/api/payment/config")).json();
ok(
  "public /api/payment/config reflects saved UPI (buyer checkout path)",
  Array.isArray(publicConfig.paymentMethods) &&
    publicConfig.paymentMethods.includes("UPI") &&
    publicConfig.upiId === "justbrand@upi",
  publicConfig
);

// ---------- regression: Orders tab ----------
await page.locator('button.sidebar-item:has-text("Orders")').click();
await page.locator("table.sec-table").first().waitFor({ timeout: 10000 });
ok("Orders tab still renders (regression)", true);

await page.screenshot({ path: "/tmp/pw/admin-payment-settings.png", fullPage: true });
out.apiNote = "admin preview /api → isolated local backend (production never contacted)";
console.log(JSON.stringify(out, null, 2));
clearTimeout(watchdog);
await browser.close();
process.exit(out.failed ? 1 : 0);
