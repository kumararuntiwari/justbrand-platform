// =====================================================
// JUSTBRAND — browser verification: BUYER checkout breakdown
// =====================================================
// Spawns the REAL backend on an isolated port (throwaway DB) and
// serves the freshly built Buyer app from its dist/ via a child
// `vite preview`, intercepting every production API call so
// production is never contacted.
//
// Verifies (CUSTOMER-SAFE display contract):
//   - PDP and product cards show ONLY MRP / final price / discount —
//     no seller price, internal platform/Family charge or GST text
//   - Checkout shows the customer-facing delivery charge and final
//     payable total, but never platform fee, Family commission or
//     GST/IGST/CGST/SGST breakdown
//   - Displayed payable total == backend quote == order charged total
//     (internal charges remain INCLUDED in every total)
//   - Backend still CALCULATES platform fee, delivery and GST — the
//     admin revenue endpoint carries the exact fee/GST snapshot
//
// Run (Playwright available, e.g. from /tmp/pw):
//   node jb-buyer-checkout.verify.mjs

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
const LOCAL = "http://127.0.0.1:4614";
const APP = "http://127.0.0.1:4613";
const DB_DIR = "/tmp/pw/jb-buyer-verify-db";

const out = { errors: [], steps: {} };
function ok(name, cond, extra) {
  out.steps[name] = cond ? "PASS" : `FAIL ${extra !== undefined ? JSON.stringify(extra) : ""}`;
  if (!cond) out.failed = (out.failed || 0) + 1;
}
let be = null;
let vite = null;
function cleanup() {
  for (const child of [be, vite]) {
    try {
      if (child) child.kill("SIGTERM");
    } catch {}
  }
}
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
}, 150000);

// ---------- local backend ----------
// Pre-spawn stale-listener probe: a leftover backend on this port
// answers health instantly and races past the post-spawn guard (our
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
    cleanup();
    process.exit(3);
  }
}
rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });
be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: { ...process.env, PORT: "4614", JWT_SECRET: "jb-buyer-verify-secret-local-only" },
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
  console.log(`BACKEND NOT USABLE (up=${up}, childExit=${be.exitCode})\n` + beErr);
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

// ---------- seed: seller + classified product + customer ----------
const aLogin = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const staff = aLogin.data?.token;
const reg = await api("POST", "/api/sellers/register", {
  body: {
    name: "Buyer Verify Seller",
    shopName: "Buyer Verify Shop",
    mobile: "9876500777",
    email: "vbuyerseller@x.com",
    password: "seller123",
  },
});
await api("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
  token: staff,
  body: { kycStatus: "Approved" },
});
const sLogin = await api("POST", "/api/sellers/login", {
  body: { mobile: "9876500777", password: "seller123" },
});
const taxReady = await onboardGstSeller(api, {
  sellerToken: sLogin.data?.token,
  staffToken: staff,
});
ok("seller KYC + PAN + GST approved", taxReady.ok);
const prod = await api("POST", "/api/sellers/products", {
  token: sLogin.data?.token,
  body: {
    name: "Classified Book",
    category: "Books",
    price: "₹200",
    images: ["https://cdn.example.com/bk2.jpg"],
  },
});
const prodId = prod.data?.product?.id;
await api("PUT", `/api/admin/products/${prodId}/approve`, { token: staff });
// Category default rate (NOT hardcoded in the test — configured via API)
const rate = await api("PUT", "/api/admin/charges/gst-rates", {
  token: staff,
  body: { category: "Books", gstRate: 5, hsnCode: "4901" },
});
// GST origin must be configured (real admin setting) — without it the
// engine returns splitMode "origin_unconfigured" and charges no split.
const gstCfg = await api("PUT", "/api/admin/charges/gst", {
  token: staff,
  body: { originState: "Uttar Pradesh", priceIncludesGst: false },
});
ok(
  "seed: product approved + Books GST 5% + origin UP configured",
  prod.status === 201 && rate.status === 200 && gstCfg.status === 200 && Boolean(prodId),
  { prod: prod.status, rate: rate.status, gst: gstCfg.status }
);

const cReg = await api("POST", "/api/customers/register", {
  body: {
    name: "Checkout Buyer",
    mobile: "9876500888",
    email: "vcheckout@x.com",
    password: "buyer1234",
  },
});
const cLogin = await api("POST", "/api/customers/login", {
  body: { mobile: "9876500888", password: "buyer1234" },
});
const customerToken = cLogin.data?.token;
const customer = cReg.data?.customer || {
  name: "Checkout Buyer",
  email: "vcheckout@x.com",
  mobile: "9876500888",
};

const quoteBody = (state) => ({
  items: [{ productId: prodId, quantity: 1 }],
  state,
  deliveryMethod: "Standard",
});
const qInter = (await api("POST", "/api/orders/quote", { token: customerToken, body: quoteBody("Maharashtra") })).data?.quote;
const qIntra = (await api("POST", "/api/orders/quote", { token: customerToken, body: quoteBody("Uttar Pradesh") })).data?.quote;
ok(
  "backend quotes: inter=IGST, intra=CGST+SGST",
  qInter?.tax?.totals?.splitMode === "inter" && qIntra?.tax?.totals?.splitMode === "intra" && Number(qInter.grandTotal) > 0 && Number(qIntra.grandTotal) > 0,
  { inter: qInter?.tax?.totals?.splitMode, intra: qIntra?.tax?.totals?.splitMode }
);

// ---------- built buyer app (child vite preview) ----------
vite = spawn(
  path.join(REPO_ROOT, "apps", "buyer-app", "node_modules", ".bin", "vite"),
  ["preview", "--host", "127.0.0.1", "--port", "4613", "--strictPort"],
  { cwd: path.join(REPO_ROOT, "apps", "buyer-app"), stdio: ["ignore", "pipe", "pipe"] }
);
let viteErr = "";
vite.stderr.on("data", (d) => (viteErr = (viteErr + d.toString()).slice(-1500)));
let appUp = false;
for (let i = 0; i < 60 && !appUp; i++) {
  try {
    appUp = (await fetch(APP + "/")).ok;
  } catch {}
  if (!appUp) await new Promise((r) => setTimeout(r, 250));
}
if (!appUp) {
  console.log("BUYER PREVIEW NOT UP\n" + viteErr);
  cleanup();
  process.exit(4);
}

// ---------- browser ----------
const browser = await chromium.launch({ headless: true, args: ["--no-sandbox"] });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1100 } });
await ctx.route(/justbrand-in-144629\.hostingersite\.com/, async (route) => {
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
page.on("pageerror", (e) => out.errors.push(e.message.slice(0, 250)));

// Logged-in buyer with one cart item, set before app scripts run.
await ctx.addInitScript(
  ([cust, tok, item]) => {
    localStorage.setItem("justbrand_customer", JSON.stringify(cust));
    localStorage.setItem("justbrand_customer_token", tok);
    localStorage.setItem("justbrand_cart", JSON.stringify([item]));
  },
  [customer, customerToken, { ...prod.data?.product, quantity: 1 }]
);

await page.goto(APP + "/", { waitUntil: "load", timeout: 60000 });
await page.locator("button.jb-cart-btn").first().waitFor({ timeout: 20000 });
ok("buyer app loads with cart button", true);

// ---------- display-only: internal charges hidden on cards + PDP ----------
const firstCardText = (await page.locator(".jb-pcard").first().innerText()).replace(/\s+/g, " ");
ok(
  "product cards show ONLY MRP/final price/discount (no fee/GST/seller text)",
  !/delivery|platform|family|gst|price includes|charge|seller price/i.test(firstCardText),
  { text: firstCardText.slice(0, 300) }
);

await page.goto(`${APP}/product/${prodId}`, { waitUntil: "load", timeout: 60000 });
await page.locator("h1").first().waitFor({ timeout: 20000 });
const pdpText = (await page.locator("body").innerText()).replace(/\s+/g, " ");
ok(
  "PDP shows ONLY final price: no GST/seller-price/fee/charge details",
  !/GST|IGST|CGST|SGST|Seller price|Price includes|Incl\.|delivery|platform|family ₹|charge/i.test(pdpText),
  { text: pdpText.slice(0, 300) }
);

// ---------- cart drawer → checkout ----------
await page.goto(APP + "/", { waitUntil: "load", timeout: 60000 });
await page.locator("button.jb-cart-btn").first().waitFor({ timeout: 20000 });
await page.locator("button.jb-cart-btn").first().click();
await page.locator('button:has-text("Proceed to Checkout")').waitFor({ timeout: 10000 });
await page.locator('button:has-text("Proceed to Checkout")').click();
await page.locator('.jb-quote-breakdown, [placeholder="House no, street, area, landmark"]').first().waitFor({ timeout: 15000 });
ok("checkout opens from cart drawer", true);

// ---------- form (inter-state address first) ----------
await page.locator('[placeholder="House no, street, area, landmark"]').fill("42 Test Highway, Andheri East");
await page.locator('[placeholder="City"]').fill("Mumbai");
await page.locator('[placeholder="6-digit PIN"]').fill("400001");
await page.locator('[placeholder="10-digit mobile number"]').fill("9876500888");
await page.locator('[placeholder="State"]').fill("Maharashtra");

const breakdown = page.locator(".jb-quote-breakdown");
await breakdown.waitFor({ timeout: 15000 });

// The breakdown carries no GST/fee rows anymore (final-price-only UI),
// so we wait for the debounced quote fetch to settle instead.
await page.waitForFunction(
  () => {
    const el = document.querySelector(".jb-quote-breakdown");
    return el && el.innerText.includes("Product price");
  },
  null,
  { timeout: 15000 }
);
await page.waitForTimeout(1200);
const interText = (await breakdown.innerText()).replace(/\s+/g, " ");
const feeLabel = qInter.platformBasis === "per_order" ? "(per order)" : "(per product)";
ok(
  "inter-state: platform fee row HIDDEN from customer summary (charge still in quote)",
  !interText.includes("Platform fee") && !interText.includes(feeLabel),
  { text: interText.slice(0, 300), fee: qInter.platformFee, basis: qInter.platformBasis }
);
ok(
  "inter-state: customer-facing delivery charge is shown and matches the quote",
  interText.includes("Delivery charge") &&
    (!Number(qInter.deliveryCharge) ||
      interText.includes(`₹${Number(qInter.deliveryCharge).toLocaleString("en-IN")}`)),
  { delivery: qInter.deliveryCharge, text: interText.slice(0, 300) }
);
ok(
  "inter-state: GST/IGST/CGST/SGST HIDDEN from customer breakdown",
  !/GST|IGST|CGST|SGST/i.test(interText),
  { gst: qInter.tax.totals.gstAmount, text: interText.slice(0, 300) }
);
ok(
  "hidden charges + GST are STILL calculated server-side (quote carries them)",
  Number(qInter.platformFee) >= 0 && Number(qInter.deliveryCharge) >= 0 &&
    Number(qInter.tax.totals.gstAmount) > 0 &&
    Number(qInter.grandTotal) > Number(qInter.itemsTotal),
  { platformFee: qInter.platformFee, delivery: qInter.deliveryCharge, gst: qInter.tax.totals.gstAmount, total: qInter.grandTotal, items: qInter.itemsTotal }
);
ok(
  "inter-state: displayed grand total == backend quote",
  interText.includes(`₹${Number(qInter.grandTotal).toLocaleString("en-IN")}`),
  { total: qInter.grandTotal, text: interText.slice(-160) }
);

// ---------- switch to intra-state ----------
await page.locator('[placeholder="State"]').fill("Uttar Pradesh");
// Delivery stays customer-facing; GST and internal platform/fee
// rows must never appear after the address switch.
await page.waitForTimeout(1500);
const intraText = (await breakdown.innerText()).replace(/\s+/g, " ");
ok(
  "intra-state: delivery shown, but NO GST/CGST/SGST/platform fee terms",
  intraText.includes("Delivery charge") &&
    !/GST|IGST|CGST|SGST|Platform fee/i.test(intraText),
  { text: intraText.slice(0, 300) }
);
ok(
  "intra-state: intra quote is calculated server-side (CGST+SGST > 0)",
  Number(qIntra.tax.totals.cgst) > 0 && Number(qIntra.tax.totals.sgst) > 0,
  { cgst: qIntra.tax.totals.cgst, sgst: qIntra.tax.totals.sgst }
);
ok(
  "intra-state: displayed grand total == backend quote",
  intraText.includes(`₹${Number(qIntra.grandTotal).toLocaleString("en-IN")}`),
  { total: qIntra.grandTotal, text: intraText.slice(-160) }
);

// ---------- place the order: displayed == charged ----------
const placeBtn = page.locator('button:has-text("Place Order")');
const btnText = (await placeBtn.innerText()).replace(/\s+/g, " ");
ok(
  "place-order button total == quote",
  btnText.includes(`₹${Number(qIntra.grandTotal).toLocaleString("en-IN")}`),
  { btn: btnText }
);
await placeBtn.click();
await page.locator('text="Order Confirmed"').waitFor({ timeout: 20000 });
const successText = (await page.locator("main").innerText()).replace(/\s+/g, " ");
ok(
  "order confirmed page shows the charged amount",
  successText.includes(`₹${Number(qIntra.grandTotal)}`) || successText.includes(`₹${Number(qIntra.grandTotal).toFixed(2)}`),
  { text: successText.slice(0, 300) }
);

// ---------- backend snapshot for the placed order ----------
const rev = await api("GET", "/api/admin/charges/platform-revenue", { token: staff });
const row = (rev.data?.orders || rev.data?.recent || []).find(
  (r) => Number(r.platformFee) === Number(qIntra.platformFee)
);
ok(
  "revenue endpoint carries order fee/GST snapshot",
  rev.status === 200 && Boolean(row) && row.splitMode === "intra",
  { status: rev.status, sample: row || (rev.data?.orders || rev.data?.recent || []).slice(0, 1) }
);

await page.screenshot({ path: "/tmp/pw/buyer-checkout.png", fullPage: true });
out.apiNote = "all API traffic intercepted → local throwaway backend";
out.quotes = { inter: qInter?.grandTotal, intra: qIntra?.grandTotal };
console.log(JSON.stringify(out, null, 2));
await browser.close();
clearTimeout(watchdog);
cleanup();
process.exit(out.failed ? 1 : 0);
