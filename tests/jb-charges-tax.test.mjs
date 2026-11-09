// =====================================================
// JUSTBRAND — CHARGES & TAX: delivery, platform fee, GST
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-charges-tax.test.mjs   (from repo root)
//
// Covers:
//   - Delivery charge: fixed ₹, percentage of order value, free-above
//     threshold, order-value band rules and delivery-method rules.
//   - Platform fee: fixed ₹ and percentage, per_order vs per_product
//     basis — charged exactly once, never double.
//   - GST: category default rate + product-level override, statutory
//     slab validation, GST-exclusive and GST-inclusive pricing,
//     CGST/SGST (intra-state) vs IGST (inter-state), unclassified
//     products flagged for review and NEVER auto-rated.
//   - Checkout quote == backend order/payment total, with server-side
//     PRICE_MISMATCH rejection of a tampered clientGrandTotal.
//   - Old orders keep their saved tax/fee details when settings change.
//   - Admin authorization + settings validation (400/401/403).
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp-charges/
//   - Never touches justbrand.db or production

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-charges");

const PORT = Number(process.env.JB_CHARGES_TEST_PORT) || 4613;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`);
  }
}

const round2 = (v) => Math.round((Number(v) || 0) * 100) / 100;

async function req(method, apiPath, { token, body } = {}) {
  const res = await fetch(BASE + apiPath, {
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

async function startServer() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const server = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: TMP_DIR, // justbrand.db created HERE — isolated
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: "jb-charges-test-secret-local-only",
    },
  });

  let stderrTail = "";
  server.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  server.stdout.on("data", () => {});

  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/api/health`);
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { server, ready, getStderr: () => stderrTail };
}

async function quote(token, items, opts = {}) {
  const res = await req("POST", "/api/orders/quote", {
    token,
    body: { items, state: opts.state ?? "", deliveryMethod: opts.deliveryMethod ?? "" },
  });
  return res;
}

async function runFlow() {
  // ===== A. SEED =====
  console.log("\n— Seed: staff, seller+products, customer");

  const aLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const staff = aLogin.data?.token;
  ok("admin login", aLogin.status === 200 && Boolean(staff));

  const reg = await req("POST", "/api/sellers/register", {
    body: {
      name: "Charges Seller",
      shopName: "Charges Shop",
      mobile: "9876500222",
      email: "charges@x.com",
      password: "seller123",
    },
  });
  await req("PUT", `/api/admin/sellers/${reg.data?.seller?.id}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  const sLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876500222", password: "seller123" },
  });
  const seller = sLogin.data?.token;
  ok("seller login", Boolean(seller));

  const taxReady = await onboardGstSeller(req, { sellerToken: seller, staffToken: staff });
  ok("seller KYC + PAN + GST approved", taxReady.ok, JSON.stringify(taxReady.response));

  async function addProduct(body) {
    const res = await req("POST", "/api/sellers/products", {
      token: seller,
      body: {
        images: ["https://cdn.example.com/ch.jpg"],
        ...body,
      },
    });
    const id = res.data?.product?.id;
    await req("PUT", `/api/admin/products/${id}/approve`, { token: staff });
    return id;
  }

  const p1 = await addProduct({
    name: "Charge Test One",
    category: "Electronics",
    price: "₹1000",
  });
  const p2 = await addProduct({
    name: "Charge Test Two",
    category: "Watches",
    price: "₹300",
    gstRate: 12, // valid product-level override (slab)
  });
  const p3 = await addProduct({
    name: "Charge Test Three",
    category: "Electronics",
    price: "₹500",
    gstRate: 7, // NOT a statutory slab → must be flagged, never charged
  });
  const p4 = await addProduct({
    name: "Charge Test Four",
    category: "Books",
    price: "₹200",
    gstRate: 7, // invalid + no category rate → 0% + review flag
  });
  ok("4 products seeded + approved", Boolean(p1 && p2 && p3 && p4), { p1, p2, p3, p4 });

  const cReg = await req("POST", "/api/customers/register", {
    body: {
      name: "Charges Customer",
      mobile: "9876500333",
      email: "chargescust@x.com",
      password: "charges1234",
    },
  });
  const cLogin = await req("POST", "/api/customers/login", {
    body: { mobile: "9876500333", password: "charges1234" },
  });
  const customer = cLogin.data?.token;
  ok("customer login", Boolean(customer));

  // ===== B. AUTHORIZATION ON SETTINGS ENDPOINTS =====
  console.log("\n— Admin authorization (server-enforced)");

  const noTok = await req("GET", "/api/admin/charges/settings");
  ok("settings w/o token → 401", noTok.status === 401, noTok.status);

  const custTok = await req("GET", "/api/admin/charges/settings", { token: customer });
  ok("settings with customer token → 401/403", custTok.status === 401 || custTok.status === 403, custTok.status);

  const noTokPut = await req("PUT", "/api/admin/charges/delivery", { body: { mode: "flat", value: 1 } });
  ok("delivery PUT w/o token → 401", noTokPut.status === 401, noTokPut.status);

  const custRev = await req("GET", "/api/admin/charges/platform-revenue", { token: customer });
  ok("platform revenue with customer token → 401/403", custRev.status === 401 || custRev.status === 403, custRev.status);

  // ===== C. DEFAULTS (legacy behaviour preserved) =====
  console.log("\n— Defaults");

  const settings0 = await req("GET", "/api/admin/charges/settings", { token: staff });
  ok(
    "default delivery = flat ₹40",
    settings0.data?.delivery?.mode === "flat" && Number(settings0.data?.delivery?.value) === 40,
    settings0.data?.delivery
  );
  ok(
    "default platform = 5% per_product, enabled",
    settings0.data?.platformFee?.enabled === true &&
      settings0.data?.platformFee?.mode === "percent" &&
      Number(settings0.data?.platformFee?.value) === 5 &&
      settings0.data?.platformFee?.basis === "per_product",
    settings0.data?.platformFee
  );
  ok(
    "default GST = exclusive, origin unconfigured, no previous saves",
    settings0.data?.gst?.priceIncludesGst === false &&
      settings0.data?.gst?.originState === "" &&
      settings0.data?.previous?.delivery === null,
    { gst: settings0.data?.gst, previous: settings0.data?.previous }
  );

  // Defaults quote for P1: 1000 + 5% platform(50) + 3% mlm(30) + delivery(40) + GST 0
  const q0 = await quote(customer, [{ productId: p1, quantity: 1 }]);
  const Q0 = q0.data?.quote;
  ok("quote computes with defaults", q0.status === 200 && Boolean(Q0));
  ok("defaults: platform 50, mlm 30, delivery 40, gst 0",
    Number(Q0.platformFee) === 50 &&
      Number(Q0.mlmCommission) === 30 &&
      Number(Q0.deliveryCharge) === 40 &&
      Number(Q0.tax.totals.gstAmount) === 0,
    { platform: Q0.platformFee, mlm: Q0.mlmCommission, delivery: Q0.deliveryCharge });
  ok("defaults: grand total 1120.00", round2(Q0.grandTotal) === 1120, Q0.grandTotal);
  ok("unclassified product is flagged (no guessed rate)",
    Q0.needsReview.some((n) => n.productId === p1), Q0.needsReview);

  const reviewEarly = await req("GET", "/api/admin/charges/gst-review", { token: staff });
  const earlyIds = (reviewEarly.data?.products || []).map((p) => p.id);
  const early3 = (reviewEarly.data?.products || []).find((p) => p.id === p3);
  ok("review list flags unclassified + invalid-rate products",
    earlyIds.includes(p1) && earlyIds.includes(p3) && earlyIds.includes(p4) &&
      early3?.flags?.includes("no_category_rate") && Number(early3?.gstRate) === 0,
    reviewEarly.data?.products);

  // ===== D. QUOTE == ORDER + PRICE_MISMATCH =====
  console.log("\n— Quote ↔ order integrity");

  const place1 = await req("POST", "/api/orders", {
    token: customer,
    body: {
      items: [{ productId: p1, quantity: 1 }],
      address: "12 Charges Street, Test Nagar, India",
      phone: "9876500333",
      state: "",
      paymentMethod: "COD",
      clientGrandTotal: Q0.grandTotal,
    },
  });
  ok("order placed with matching clientGrandTotal", place1.status === 201, place1.status);
  const order1 = place1.data?.order;
  ok("order totalAmount == quote grandTotal", Number(order1?.totalAmount) === round2(Q0.grandTotal), {
    total: order1?.totalAmount,
    quote: Q0.grandTotal,
  });
  let savedCharges = null;
  try {
    savedCharges = JSON.parse(order1?.chargesJson || "null");
  } catch {
    savedCharges = null;
  }
  ok("order snapshots full charges breakdown (chargesJson)",
    Boolean(savedCharges) &&
      Number(savedCharges.platformFee) === 50 &&
      Number(savedCharges.deliveryCharge) === 40,
    savedCharges && { platform: savedCharges.platformFee, delivery: savedCharges.deliveryCharge });

  const tampered = await req("POST", "/api/orders", {
    token: customer,
    body: {
      items: [{ productId: p1, quantity: 1 }],
      address: "12 Charges Street, Test Nagar, India",
      phone: "9876500333",
      paymentMethod: "COD",
      clientGrandTotal: 1,
    },
  });
  ok("tampered clientGrandTotal → 400 PRICE_MISMATCH",
    tampered.status === 400 && tampered.data?.code === "PRICE_MISMATCH",
    { status: tampered.status, code: tampered.data?.code });

  // ===== E. DELIVERY CHARGE =====
  console.log("\n— Delivery charge: flat / percent / free-above / rules");

  let res = await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "flat", value: 75, freeAboveOrderValue: 0, rules: [] },
  });
  ok("save flat ₹75", res.status === 200, res.data?.message);

  let q = await quote(customer, [{ productId: p1, quantity: 1 }]);
  ok("flat ₹75 applied", Number(q.data.quote.deliveryCharge) === 75 && round2(q.data.quote.grandTotal) === 1155,
    { delivery: q.data.quote.deliveryCharge, total: q.data.quote.grandTotal });

  res = await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "flat", value: 90, freeAboveOrderValue: 0, rules: [] },
  });
  const settings1 = await req("GET", "/api/admin/charges/settings", { token: staff });
  ok("previous value visible after second save (75)",
    res.status === 200 && Number(settings1.data?.previous?.delivery?.value) === 75,
    settings1.data?.previous?.delivery);

  const pubP1 = await req("GET", `/api/products/${p1}`);
  ok("products repriced on save (deliveryCharge=90)",
    Number(pubP1.data?.deliveryCharge) === 90,
    pubP1.data?.deliveryCharge);

  res = await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "percent", value: 10, freeAboveOrderValue: 0, rules: [] },
  });
  q = await quote(customer, [{ productId: p1, quantity: 1 }]);
  ok("percent 10% of order value = ₹100",
    res.status === 200 &&
      Number(q.data.quote.deliveryCharge) === 100 &&
      round2(q.data.quote.grandTotal) === 1180,
    { delivery: q.data.quote.deliveryCharge, total: q.data.quote.grandTotal });

  res = await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "flat", value: 40, freeAboveOrderValue: 500, rules: [] },
  });
  q = await quote(customer, [{ productId: p1, quantity: 1 }]);
  ok("free above ₹500 → delivery ₹0 (order value 1000)",
    res.status === 200 && Number(q.data.quote.deliveryCharge) === 0 && round2(q.data.quote.grandTotal) === 1080,
    { delivery: q.data.quote.deliveryCharge, total: q.data.quote.grandTotal });

  res = await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: {
      mode: "flat",
      value: 40,
      freeAboveOrderValue: 0,
      rules: [
        { method: "", minOrderValue: 0, maxOrderValue: 499, mode: "flat", value: 30 },
        { method: "Express", minOrderValue: 0, maxOrderValue: null, mode: "flat", value: 150 },
      ],
    },
  });
  ok("delivery rules saved", res.status === 200, res.data?.message);

  const qBand = await quote(customer, [{ productId: p2, quantity: 1 }]);
  ok("order-value band rule: ₹300 order → ₹30",
    Number(qBand.data.quote.deliveryCharge) === 30,
    qBand.data.quote.deliveryCharge);

  const qExpress = await quote(customer, [{ productId: p1, quantity: 1 }], { deliveryMethod: "Express" });
  ok("delivery-method rule: Express → ₹150",
    Number(qExpress.data.quote.deliveryCharge) === 150 && round2(qExpress.data.quote.grandTotal) === 1230,
    { delivery: qExpress.data.quote.deliveryCharge, total: qExpress.data.quote.grandTotal });

  const qStd = await quote(customer, [{ productId: p1, quantity: 1 }], { deliveryMethod: "Standard" });
  ok("no rule matches → default ₹40",
    Number(qStd.data.quote.deliveryCharge) === 40 && round2(qStd.data.quote.grandTotal) === 1120,
    qStd.data.quote.deliveryCharge);

  // Reset delivery to defaults for the remaining phases.
  await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "flat", value: 40, freeAboveOrderValue: 0, rules: [] },
  });

  // ===== F. PLATFORM FEE =====
  console.log("\n— Platform fee: per_order vs per_product (never twice)");

  res = await req("PUT", "/api/admin/charges/platform-fee", {
    token: staff,
    body: { enabled: true, mode: "flat", value: 20, basis: "per_order" },
  });
  const qPo = await quote(customer, [{ productId: p1, quantity: 2 }]);
  ok("per_order flat ₹20 charged ONCE for 2 units",
    res.status === 200 &&
      Number(qPo.data.quote.platformFee) === 20 &&
      round2(qPo.data.quote.grandTotal) === 2120,
    { platform: qPo.data.quote.platformFee, total: qPo.data.quote.grandTotal });

  const pubP1b = await req("GET", `/api/products/${p1}`);
  ok("per_order basis removes fee from unit price (no double charge)",
    Number(pubP1b.data?.platformCharge) === 0 && Number(pubP1b.data?.customerPrice) === 1070,
    { platformCharge: pubP1b.data?.platformCharge, customerPrice: pubP1b.data?.customerPrice });

  res = await req("PUT", "/api/admin/charges/platform-fee", {
    token: staff,
    body: { enabled: true, mode: "flat", value: 20, basis: "per_product" },
  });
  const qPp = await quote(customer, [{ productId: p1, quantity: 2 }]);
  ok("per_product flat ₹20 × 2 units = ₹40",
    res.status === 200 &&
      Number(qPp.data.quote.platformFee) === 40 &&
      round2(qPp.data.quote.grandTotal) === 2140,
    { platform: qPp.data.quote.platformFee, total: qPp.data.quote.grandTotal });

  const sumEq = round2(
    qPp.data.quote.baseTotal +
      qPp.data.quote.platformFee +
      qPp.data.quote.mlmCommission +
      qPp.data.quote.deliveryCharge +
      qPp.data.quote.tax.totals.gstAmount
  );
  ok("breakdown sums EXACTLY once to the grand total",
    sumEq === round2(qPp.data.quote.grandTotal), { sumEq, grand: qPp.data.quote.grandTotal });

  // Restore default platform (5% per_product) for GST math below.
  await req("PUT", "/api/admin/charges/platform-fee", {
    token: staff,
    body: { enabled: true, mode: "percent", value: 5, basis: "per_product" },
  });

  // ===== G. GST: category default, slabs, intra/inter =====
  console.log("\n— GST: category rate, intra vs inter, override, review flags");

  res = await req("PUT", "/api/admin/charges/gst", {
    token: staff,
    body: { originState: "Uttar Pradesh", priceIncludesGst: false },
  });
  ok("GST origin saved (Uttar Pradesh)", res.status === 200, res.data?.message);

  res = await req("PUT", "/api/admin/charges/gst-rates", {
    token: staff,
    body: { category: "Electronics", gstRate: 18, hsnCode: "8517" },
  });
  ok("category rate 18% + HSN saved", res.status === 200, res.data?.message);

  res = await req("PUT", "/api/admin/charges/gst-rates", {
    token: staff,
    body: { category: "Toys", gstRate: 7 },
  });
  ok("non-statutory slab (7%) rejected → 400", res.status === 400, res.status);

  const pubP1c = await req("GET", `/api/products/${p1}`);
  ok("product repriced with category rate 18% (customerPrice 1321.60)",
    Number(pubP1c.data?.gstRate) === 18 && Number(pubP1c.data?.customerPrice) === 1321.6,
    { gstRate: pubP1c.data?.gstRate, customerPrice: pubP1c.data?.customerPrice });

  // Intra-state (origin Uttar Pradesh, buyer Uttar Pradesh)
  const qIntra = await quote(customer, [{ productId: p1, quantity: 1 }], { state: "Uttar Pradesh" });
  const T = qIntra.data.quote.tax.totals;
  ok("intra-state: taxable 1120, GST 18% = 201.60",
    Number(T.taxableValue) === 1120 && Number(T.gstAmount) === 201.6,
    T);
  ok("intra-state: CGST+SGST split (100.80 + 100.80), IGST 0",
    T.splitMode === "intra" &&
      Number(T.cgst) === 100.8 &&
      Number(T.sgst) === 100.8 &&
      Number(T.igst) === 0,
    T);
  ok("intra-state: grand total 1321.60", round2(qIntra.data.quote.grandTotal) === 1321.6,
    qIntra.data.quote.grandTotal);

  // Inter-state (origin UP, buyer Maharashtra)
  const qInter = await quote(customer, [{ productId: p1, quantity: 1 }], { state: "Maharashtra" });
  const Ti = qInter.data.quote.tax.totals;
  ok("inter-state: IGST 201.60, CGST/SGST 0",
    Ti.splitMode === "inter" && Number(Ti.igst) === 201.6 && Number(Ti.cgst) === 0 && Number(Ti.sgst) === 0,
    Ti);
  ok("inter-state: same grand total 1321.60",
    round2(qInter.data.quote.grandTotal) === 1321.6, qInter.data.quote.grandTotal);

  // Destination unknown → total still correct, split never guessed
  const qUnknown = await quote(customer, [{ productId: p1, quantity: 1 }], { state: "" });
  const Tu = qUnknown.data.quote.tax.totals;
  ok("destination unknown: split flagged, NOT guessed",
    Tu.splitMode === "destination_unknown" && Tu.cgst === null && Tu.sgst === null && Tu.igst === null,
    Tu);
  ok("destination unknown: GST total + grand total still exact",
    Number(Tu.gstAmount) === 201.6 && round2(qUnknown.data.quote.grandTotal) === 1321.6, Tu);

  // Origin unconfigured → split flagged
  await req("PUT", "/api/admin/charges/gst", {
    token: staff,
    body: { originState: "", priceIncludesGst: false },
  });
  const qNoOrigin = await quote(customer, [{ productId: p1, quantity: 1 }], { state: "Uttar Pradesh" });
  ok("origin unconfigured: split flagged as origin_unconfigured",
    qNoOrigin.data.quote.tax.totals.splitMode === "origin_unconfigured" &&
      qNoOrigin.data.quote.tax.totals.cgst === null,
    qNoOrigin.data.quote.tax.totals);
  ok("previous GST settings visible",
    (await req("GET", "/api/admin/charges/settings", { token: staff })).data?.previous?.gst
      ?.originState === "Uttar Pradesh");

  // Restore origin for later phases
  await req("PUT", "/api/admin/charges/gst", {
    token: staff,
    body: { originState: "Uttar Pradesh", priceIncludesGst: false },
  });

  // Product-level override beats category default (P2: Watches, 12%)
  const qP2 = await quote(customer, [{ productId: p2, quantity: 1 }], { state: "Uttar Pradesh" });
  ok("product override (12%) beats category default",
    qP2.data.quote.tax.lines.length === 1 && Number(qP2.data.quote.tax.lines[0].gstRate) === 12,
    qP2.data.quote.tax.lines);
  ok("override math: taxable 364 (300+15+9+40), GST 12% = 43.68, total 407.68",
    Number(qP2.data.quote.tax.totals.taxableValue) === 364 &&
      Number(qP2.data.quote.tax.totals.gstAmount) === 43.68 &&
      round2(qP2.data.quote.grandTotal) === 407.68,
    qP2.data.quote.tax.totals);

  // Mixed-slab order: P1 (18%) + P2 (12%) → two tax lines
  const qMixed = await quote(customer, [{ productId: p1, quantity: 1 }, { productId: p2, quantity: 1 }], {
    state: "Uttar Pradesh",
  });
  const rates = qMixed.data.quote.tax.lines.map((line) => Number(line.gstRate)).sort((a, b) => a - b);
  ok("mixed order groups tax by slab (12% + 18% lines)",
    qMixed.data.quote.tax.lines.length === 2 && rates[0] === 12 && rates[1] === 18, rates);

  // Invalid product override + admin category default → falls back to
  // the admin-configured rate (never a guessed one).
  const qP3 = await quote(customer, [{ productId: p3, quantity: 1 }], { state: "Uttar Pradesh" });
  ok("invalid product rate (7%) → admin category 18% applies (no guess)",
    Number(qP3.data.quote.tax.lines[0].gstRate) === 18,
    qP3.data.quote.tax.lines);

  // ===== H. GST-INCLUSIVE =====
  console.log("\n— GST-inclusive pricing");

  res = await req("PUT", "/api/admin/charges/gst", {
    token: staff,
    body: { originState: "Uttar Pradesh", priceIncludesGst: true },
  });
  const pubP1d = await req("GET", `/api/products/${p1}`);
  ok("inclusive mode reprices product (GST extracted, customerPrice 1120)",
    res.status === 200 && Number(pubP1d.data?.customerPrice) === 1120,
    pubP1d.data?.customerPrice);

  const qInc = await quote(customer, [{ productId: p1, quantity: 1 }], { state: "Uttar Pradesh" });
  const Ti2 = qInc.data.quote.tax.totals;
  ok("inclusive: selling price unchanged (grand 1120)",
    round2(qInc.data.quote.grandTotal) === 1120, qInc.data.quote.grandTotal);
  ok("inclusive: taxable 949.15, GST 170.85 extracted",
    Number(Ti2.taxableValue) === 949.15 && Number(Ti2.gstAmount) === 170.85, Ti2);
  ok("inclusive: CGST+SGST sum exactly to GST",
    Ti2.splitMode === "intra" && round2(Number(Ti2.cgst) + Number(Ti2.sgst)) === Number(Ti2.gstAmount),
    Ti2);

  // Back to exclusive for remaining tests
  await req("PUT", "/api/admin/charges/gst", {
    token: staff,
    body: { originState: "Uttar Pradesh", priceIncludesGst: false },
  });

  // ===== I. GST REVIEW FLAGS + ADMIN OVERRIDE =====
  console.log("\n— Review flags & admin product tax override");

  const review0 = await req("GET", "/api/admin/charges/gst-review", { token: staff });
  const flagged4 = (review0.data?.products || []).find((p) => p.id === p4);
  ok("unclassified product flagged for review (rate 0, no guessing)",
    Boolean(flagged4) && Number(flagged4.gstRate) === 0 && flagged4.flags.includes("no_category_rate"),
    flagged4);

  const badTax = await req("PUT", `/api/admin/products/${p4}/tax`, {
    token: staff,
    body: { gstRate: 7, hsnCode: "4901" },
  });
  ok("invalid slab on product tax → 400", badTax.status === 400, badTax.status);

  const badHsn = await req("PUT", `/api/admin/products/${p4}/tax`, {
    token: staff,
    body: { gstRate: 5, hsnCode: "12" },
  });
  ok("invalid HSN (2 digits) → 400", badHsn.status === 400, badHsn.status);

  const goodTax = await req("PUT", `/api/admin/products/${p4}/tax`, {
    token: staff,
    body: { gstRate: 5, hsnCode: "4901" },
  });
  ok("admin sets valid product classification (5% + HSN)",
    goodTax.status === 200 && Number(goodTax.data?.resolved?.gstRate) === 5 &&
      goodTax.data?.resolved?.source === "product",
    goodTax.data?.resolved);

  const review1 = await req("GET", "/api/admin/charges/gst-review", { token: staff });
  ok("flag cleared after classification",
    !(review1.data?.products || []).some((p) => p.id === p4), review1.data?.products?.map((p) => p.id));

  const qP4 = await quote(customer, [{ productId: p4, quantity: 1 }], { state: "Uttar Pradesh" });
  ok("classified product now charges 5% (taxable 256, GST 12.80)",
    Number(qP4.data.quote.tax.totals.taxableValue) === 256 &&
      Number(qP4.data.quote.tax.totals.gstAmount) === 12.8 &&
      round2(qP4.data.quote.grandTotal) === 268.8,
    qP4.data.quote.tax.totals);

  // ===== J. VALIDATION REJECTIONS =====
  console.log("\n— Settings validation (no bad values accepted)");

  const cases = [
    ["delivery invalid mode", "PUT", "/api/admin/charges/delivery", { mode: "weird", value: 10 }],
    ["delivery percent > 100", "PUT", "/api/admin/charges/delivery", { mode: "percent", value: 150, freeAboveOrderValue: 0, rules: [] }],
    ["delivery negative flat", "PUT", "/api/admin/charges/delivery", { mode: "flat", value: -5, freeAboveOrderValue: 0, rules: [] }],
    ["delivery rule max < min", "PUT", "/api/admin/charges/delivery", { mode: "flat", value: 40, freeAboveOrderValue: 0, rules: [{ method: "", minOrderValue: 500, maxOrderValue: 100, mode: "flat", value: 10 }] }],
    ["platform invalid basis", "PUT", "/api/admin/charges/platform-fee", { enabled: true, mode: "percent", value: 5, basis: "sometimes" }],
    ["platform percent > 100", "PUT", "/api/admin/charges/platform-fee", { enabled: true, mode: "percent", value: 101, basis: "per_order" }],
    ["gst unknown origin state", "PUT", "/api/admin/charges/gst", { originState: "Atlantis", priceIncludesGst: false }],
  ];
  for (const [name, method, path_, body] of cases) {
    const r = await req(method, path_, { token: staff, body });
    ok(`${name} → 400`, r.status === 400, { status: r.status, message: r.data?.message });
  }

  // ===== K. OLD ORDERS NEVER CHANGE =====
  console.log("\n— Old orders keep saved tax/fee details");

  const before = await req("GET", "/api/customer/orders", { token: customer });
  const oldOrder = (before.data?.orders || []).find((o) => o.id === order1.id);
  ok("original order still retrievable", Boolean(oldOrder));

  await req("PUT", "/api/admin/charges/delivery", {
    token: staff,
    body: { mode: "flat", value: 99, freeAboveOrderValue: 0, rules: [] },
  });
  await req("PUT", "/api/admin/charges/platform-fee", {
    token: staff,
    body: { enabled: true, mode: "flat", value: 33, basis: "per_order" },
  });

  const after = await req("GET", "/api/customer/orders", { token: customer });
  const oldOrderAfter = (after.data?.orders || []).find((o) => o.id === order1.id);
  ok("totalAmount unchanged after settings changes",
    Number(oldOrderAfter?.totalAmount) === Number(oldOrder?.totalAmount),
    { before: oldOrder?.totalAmount, after: oldOrderAfter?.totalAmount });
  ok("chargesJson snapshot unchanged after settings changes",
    oldOrderAfter?.chargesJson === oldOrder?.chargesJson);

  const qNew = await quote(customer, [{ productId: p1, quantity: 1 }], { state: "Uttar Pradesh" });
  ok("NEW orders use the new settings (delivery 99 + per_order 33)",
    Number(qNew.data.quote.deliveryCharge) === 99 && Number(qNew.data.quote.platformFee) === 33,
    { delivery: qNew.data.quote.deliveryCharge, platform: qNew.data.quote.platformFee });

  // ===== L. PLATFORM REVENUE =====
  console.log("\n— Platform revenue & order-wise breakdown");

  const rev = await req("GET", "/api/admin/charges/platform-revenue", { token: staff });
  const recentSum = round2(
    (rev.data?.recent || []).reduce((sum, row) => sum + Number(row.platformFee || 0), 0)
  );
  ok("revenue endpoint returns totals + order-wise rows",
    rev.status === 200 && Number(rev.data?.orderCount) >= 1 && Array.isArray(rev.data?.recent),
    { orderCount: rev.data?.orderCount, recent: rev.data?.recent?.length });
  ok("totalCollected equals the sum of order breakdowns",
    Math.abs(Number(rev.data?.totalCollected) - recentSum) < 0.01,
    { total: rev.data?.totalCollected, sum: recentSum });
  ok("order-wise rows include fee/delivery/gst fields",
    (rev.data?.recent || []).every(
      (row) => row.platformFee !== undefined && row.deliveryCharge !== undefined && row.gstAmount !== undefined
    ));
}

const { server, ready, getStderr } = await startServer();

if (!ready) {
  console.error("Backend failed to start:\n" + getStderr());
  process.exit(1);
}

try {
  await runFlow();
} finally {
  server.kill();
}

console.log(`\n=== CHARGES & TAX: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failures:\n  - " + failures.join("\n  - "));
  process.exit(1);
}
