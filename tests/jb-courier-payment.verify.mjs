// =====================================================
// JUSTBRAND — courier partners + payment settings verification
// =====================================================
// Spawns the REAL backend on an isolated port with a THROWAWAY
// database and verifies, at the API level:
//   - Courier partners (India Post / Ekart / Shiprocket / DTDC) are
//     seeded, configurable (enabled, rates, COD, pincodes, tracking
//     template) and Manual-Mode only (no fake live API possible).
//   - Per-order courier assignment records partner + AWB + label ref
//     + courier status WITHOUT touching order totals, payment status,
//     the configured delivery charge / GST calculation, or the
//     person-based delivery-partner workflow (delivery.js).
//   - Admin payment settings (COD/UPI/BankTransfer display data) are
//     DB-backed with env fallback; the public /api/payment/config
//     shape is unchanged; secrets are never returned.
//   - Role gating: manager can manage, accountant read-only,
//     unauthenticated requests rejected.
//
// Production is never contacted. Run: node tests/jb-courier-payment.verify.mjs
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(REPO_ROOT, "tests", ".tmp", "jb-courier-payment-db");
const PORT = Number(process.env.JB_TEST_PORT) || 4622;
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
    console.log(`  ✗ FAIL: ${name}${extra !== undefined ? " — " + JSON.stringify(extra) : ""}`);
  }
}

async function api(method, p, { token, body } = {}) {
  const res = await fetch(BASE + p, {
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

// ---------- start backend on throwaway DB ----------
rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });

const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: { ...process.env, PORT: String(PORT), JWT_SECRET: "jb-courier-test-secret-local-only" },
  stdio: ["ignore", "pipe", "pipe"],
});
let beErr = "";
be.stderr.on("data", (d) => (beErr = (beErr + d.toString()).slice(-3000)));

const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT");
  try { be.kill("SIGTERM"); } catch {}
  process.exit(2);
}, 120000);

process.on("uncaughtException", (e) => {
  console.error(e && e.stack ? e.stack : e);
  try { be.kill("SIGTERM"); } catch {}
  process.exit(1);
});

let up = false;
for (let i = 0; i < 90 && !up && be.exitCode === null; i++) {
  try {
    up = (await fetch(`${BASE}/api/health`)).ok;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up || be.exitCode !== null) {
  console.error(`BACKEND NOT USABLE (up=${up}, exit=${be.exitCode})\n${beErr}`);
  try { be.kill("SIGTERM"); } catch {}
  process.exit(3);
}
ok("backend boots with courier + payment modules", true);

// ---------- staff tokens ----------
const login = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const superTok = login.data?.token;
ok("superadmin login", Boolean(superTok));

// A manager + accountant staff member for role checks.
async function makeStaff(username, role) {
  const created = await api("POST", "/api/admin/staff", {
    token: superTok,
    body: { name: username, username, password: "Staff@2026x", role },
  });
  const loginRes = await api("POST", "/api/staff/login", {
    body: { username, password: "Staff@2026x" },
  });
  return { created: created.status, token: loginRes.data?.token };
}

const manager = await makeStaff("mgrverify", "manager");
const accountant = await makeStaff("acctverify", "accountant");
ok("manager + accountant staff created", Boolean(manager.token) && Boolean(accountant.token), {
  manager: manager.created,
  accountant: accountant.created,
});

// =====================================================
// 1. COURIER PARTNERS — seeding + listing
// =====================================================
console.log("\n# courier partners");

const list = await api("GET", "/api/admin/courier-partners", { token: superTok });
const names = (list.data?.partners || []).map((p) => p.name);
ok(
  "seeded partners: India Post, Ekart, Shiprocket, DTDC",
  ["India Post", "Ekart", "Shiprocket", "DTDC"].every((n) => names.includes(n)),
  names
);
ok("manual mode declared (no fake live API)", list.data?.mode === "manual");
const ekartSeed = (list.data?.partners || []).find((p) => p.code === "EKART");
ok("seeded partners start DISABLED (nothing live by accident)", ekartSeed?.enabled === false, ekartSeed);
ok("no API credentials leaked in list response", !(list.data?.partners || []).some((p) => "apiCredentials" in p && typeof p.apiCredentials === "string"));

// unauthenticated + role checks
const anon = await api("GET", "/api/admin/courier-partners");
ok("unauthenticated list rejected", anon.status === 401, anon.status);
const acctRead = await api("GET", "/api/admin/courier-partners", { token: accountant.token });
ok("accountant can READ courier partners", acctRead.status === 200 && acctRead.data?.success === true, acctRead.status);
const acctWrite = await api("PUT", `/api/admin/courier-partners/${ekartSeed.id}`, {
  token: accountant.token,
  body: { enabled: true },
});
ok("accountant CANNOT write courier partners", acctWrite.status === 403, acctWrite.status);
const mgrWrite = await api("PUT", `/api/admin/courier-partners/${ekartSeed.id}`, {
  token: manager.token,
  body: { enabled: true, codAvailable: true, baseRate: 40, perKgRate: 20, codCharge: 5, serviceablePincodes: ["226001", "110001", "400001"], trackingUrlTemplate: "https://ekart.example.com/track?awb={awb}" },
});
ok("manager can configure a partner", mgrWrite.status === 200 && mgrWrite.data?.partner?.enabled === true, mgrWrite.data);

// validation
const badPin = await api("PUT", `/api/admin/courier-partners/${ekartSeed.id}`, {
  token: superTok,
  body: { serviceablePincodes: ["226001", "12345"] },
});
ok("invalid pincode rejected", badPin.status === 400, badPin.data);
const fakeLive = await api("PUT", `/api/admin/courier-partners/${ekartSeed.id}`, {
  token: superTok,
  body: { apiMode: "live" },
});
ok(
  "apiMode 'live' rejected — Manual Mode enforced (no fake live tracking)",
  fakeLive.status === 400 && /Manual Mode/i.test(fakeLive.data?.message || ""),
  fakeLive.data
);

// credentials write-only
const credSave = await api("PUT", `/api/admin/courier-partners/${ekartSeed.id}`, {
  token: superTok,
  body: { apiCredentials: { accountId: "ACC-123", token: "SECRET-TOKEN-XYZ" } },
});
ok("api credentials saved", credSave.status === 200 && credSave.data?.partner?.hasApiCredentials === true, credSave.data);
ok(
  "credential VALUES never returned (only hasApiCredentials flag)",
  JSON.stringify(credSave.data?.partner || {}).includes("SECRET-TOKEN-XYZ") === false &&
    JSON.stringify(list.data?.partners || []).includes("SECRET-TOKEN-XYZ") === false
);

// =====================================================
// 2. PAYMENT SETTINGS
// =====================================================
console.log("\n# payment settings");

const pubBefore = await api("GET", "/api/payment/config");
ok(
  "public payment config works without auth (COD default)",
  pubBefore.status === 200 && JSON.stringify(pubBefore.data?.paymentMethods) === JSON.stringify(["COD"]),
  pubBefore.data
);

const psRead = await api("GET", "/api/admin/payment/settings", { token: superTok });
ok("admin payment settings readable", psRead.status === 200 && psRead.data?.settings?.availableMethods?.length === 3, psRead.data);
ok("gateway honestly reported as NOT integrated", psRead.data?.settings?.gateway?.integrated === false);

const psBad = await api("PUT", "/api/admin/payment/settings", {
  token: superTok,
  body: { mode: "COD,Crypto" },
});
ok("invalid payment method rejected", psBad.status === 400, psBad.data);
const psNoUpi = await api("PUT", "/api/admin/payment/settings", {
  token: superTok,
  body: { mode: "COD,UPI" },
});
ok("UPI enabled without UPI ID rejected", psNoUpi.status === 400, psNoUpi.data);

const psSave = await api("PUT", "/api/admin/payment/settings", {
  token: superTok,
  body: {
    mode: "COD,UPI,BankTransfer",
    upiId: "justbrand@upi",
    bankName: "HDFC Bank",
    bankAccountName: "JustBrand Enterprises",
    bankAccountNumber: "50100212345678",
    bankIfsc: "HDFC0000123",
  },
});
ok("payment settings saved by superadmin", psSave.status === 200, psSave.data);
ok(
  "admin view masks account number (last 4 only)",
  psSave.data?.settings?.bankAccountLast4 === "5678" && !JSON.stringify(psSave.data).includes("50100212345678"),
  psSave.data?.settings
);

const pubAfter = await api("GET", "/api/payment/config");
ok(
  "public config reflects saved settings (COD/UPI/BankTransfer) with SAME shape",
  JSON.stringify(pubAfter.data?.paymentMethods) === JSON.stringify(["COD", "UPI", "BankTransfer"]) &&
    pubAfter.data?.upiId === "justbrand@upi" &&
    pubAfter.data?.bank?.accountLast4 === "5678" &&
    typeof pubAfter.data?.note === "string",
  pubAfter.data
);
ok("full account number never public", !JSON.stringify(pubAfter.data).includes("50100212345678"));

const acctPs = await api("PUT", "/api/admin/payment/settings", {
  token: accountant.token,
  body: { mode: "COD" },
});
ok("accountant CANNOT write payment settings", acctPs.status === 403, acctPs.status);

// =====================================================
// 3. ORDER LIFECYCLE — courier assignment does not touch money
// =====================================================
console.log("\n# order courier assignment");

await api("PUT", `/api/admin/sellers/1/kyc`, { token: superTok, body: { kycStatus: "Approved" } }).catch(() => {});
const sellerReg = await api("POST", "/api/sellers/register", {
  body: { name: "Courier Seller", shopName: "Courier Shop", mobile: "9876543210", email: "cseller@x.com", password: "seller123" },
});
const sellerId = sellerReg.data?.seller?.id;
await api("PUT", `/api/admin/sellers/${sellerId}/kyc`, { token: superTok, body: { kycStatus: "Approved" } });
const sellerLogin = await api("POST", "/api/sellers/login", {
  body: { mobile: "9876543210", password: "seller123" },
});
const sellerTok = sellerLogin.data?.token;
const taxReady = await onboardGstSeller(api, { sellerToken: sellerTok, staffToken: superTok });
ok("seller KYC + PAN + GST approved", taxReady.ok);
const product = await api("POST", "/api/sellers/products", {
  token: sellerTok,
  body: { name: "Courier Test Product", category: "Fashion", price: "₹500", images: ["https://cdn.example.com/c1.jpg"] },
});
const productId = product.data?.product?.id;
await api("PUT", `/api/admin/products/${productId}/approve`, { token: superTok });
ok("seller + approved product seeded", Boolean(productId));

await api("POST", "/api/customers/register", {
  body: { name: "Courier Buyer", mobile: "9876501111", email: "cbuyer@x.com", password: "buyer1234" },
});
const cLogin = await api("POST", "/api/customers/login", {
  body: { mobile: "9876501111", password: "buyer1234" },
});
const buyerTok = cLogin.data?.token;

const quote = await api("POST", "/api/orders/quote", {
  token: buyerTok,
  body: { items: [{ productId, quantity: 1 }], state: "Uttar Pradesh", deliveryMethod: "Standard" },
});
const orderRes = await api("POST", "/api/orders", {
  token: buyerTok,
  body: {
    items: [{ productId, quantity: 1 }],
    address: "12 Courier Lane, Lucknow",
    phone: "9876501111",
    state: "Uttar Pradesh",
    city: "Lucknow",
    pincode: "226001",
    paymentMethod: "COD",
    clientGrandTotal: quote.data?.quote?.grandTotal,
  },
});
const orderId = orderRes.data?.order?.id;
ok("COD order placed", orderRes.status === 201 && Boolean(orderId), orderRes.data);

const beforeOrder = orderRes.data?.order || {};
const totalBefore = Number(beforeOrder.totalAmount);
const chargesBefore = beforeOrder.chargesJson;

// 3a. disabled partner rejected
const disabledTok = (await api("GET", "/api/admin/courier-partners", { token: superTok }))
  .data?.partners?.find((p) => p.code === "DTDC");
const assignDisabled = await api("PUT", `/api/admin/orders/${orderId}/courier`, {
  token: superTok,
  body: { courierPartnerId: disabledTok.id, awbNumber: "DT123456" },
});
ok("disabled partner rejected", assignDisabled.status === 400 && /disabled/i.test(assignDisabled.data?.message || ""), assignDisabled.data);

// 3b. non-serviceable pincode rejected
const shiprocket = (await api("GET", "/api/admin/courier-partners", { token: superTok }))
  .data?.partners?.find((p) => p.code === "SHIPROCKET");
await api("PUT", `/api/admin/courier-partners/${shiprocket.id}`, {
  token: superTok,
  body: { enabled: true, codAvailable: false, serviceablePincodes: ["600001"] }, // Chennai only, no COD
});
const assignNoCod = await api("PUT", `/api/admin/orders/${orderId}/courier`, {
  token: superTok,
  body: { courierPartnerId: shiprocket.id, awbNumber: "SR999" },
});
ok(
  "COD order rejected for partner without COD / outside serviceable pincodes",
  assignNoCod.status === 400,
  assignNoCod.data
);

// 3c. valid assignment (Ekart: enabled, COD ok, 226001 serviceable)
const assign = await api("PUT", `/api/admin/orders/${orderId}/courier`, {
  token: superTok,
  body: {
    courierPartnerId: ekartSeed.id,
    awbNumber: "EK-778899",
    shippingLabelRef: "LBL-2026-001",
    courierStatus: "Booked",
  },
});
ok(
  "valid courier assignment recorded (partner + AWB + label ref)",
  assign.status === 200 && assign.data?.order?.awbNumber === "EK-778899" && assign.data?.order?.shippingLabelRef === "LBL-2026-001" && assign.data?.order?.courierPartnerName === "Ekart",
  assign.data
);

// 3d. money untouched
const adminOrders = await api("GET", "/api/admin/orders", { token: superTok });
const adminOrder = (adminOrders.data?.orders || []).find((o) => o.id === orderId);
ok(
  "admin order shows courier name + AWB + status",
  adminOrder?.courierPartnerName === "Ekart" && adminOrder?.awbNumber === "EK-778899" && adminOrder?.courierStatus === "Booked",
  { courierPartnerName: adminOrder?.courierPartnerName, awbNumber: adminOrder?.awbNumber }
);
ok(
  "totals/payment/charges UNCHANGED by courier assignment",
  Number(adminOrder?.totalAmount) === totalBefore &&
    adminOrder?.paymentStatus === "Pending" &&
    adminOrder?.chargesJson === chargesBefore &&
    adminOrder?.status === "Pending",
  { total: adminOrder?.totalAmount, paymentStatus: adminOrder?.paymentStatus, status: adminOrder?.status }
);

// 3e. buyer sees courier info; deliveryPartnerName (person) untouched field
const buyerOrders = await api("GET", "/api/customer/orders", { token: buyerTok });
const buyerOrder = (buyerOrders.data?.orders || []).find((o) => o.id === orderId);
ok(
  "buyer order shows courier name + AWB",
  buyerOrder?.courierPartnerName === "Ekart" && buyerOrder?.awbNumber === "EK-778899",
  { courierPartnerName: buyerOrder?.courierPartnerName, awbNumber: buyerOrder?.awbNumber }
);
ok("person-based deliveryPartnerName field still present", "deliveryPartnerName" in (buyerOrder || {}));

// 3f. courier status update
const statusUp = await api("PUT", `/api/admin/orders/${orderId}/courier-status`, {
  token: superTok,
  body: { courierStatus: "In Transit" },
});
ok("courier status updated (manual record)", statusUp.status === 200, statusUp.data);
const badStatus = await api("PUT", `/api/admin/orders/${orderId}/courier-status`, {
  token: superTok,
  body: { courierStatus: "Teleported" },
});
ok("invalid courier status rejected", badStatus.status === 400, badStatus.data);

// 3g. clearing the booking
const assign2 = await api("PUT", `/api/admin/orders/${orderId}/courier`, {
  token: superTok,
  body: { courierPartnerId: ekartSeed.id, awbNumber: "EK-112233", courierStatus: "Booked" },
});
const clear = await api("PUT", `/api/admin/orders/${orderId}/courier`, {
  token: superTok,
  body: { courierPartnerId: null },
});
const afterClear = (await api("GET", "/api/admin/orders", { token: superTok }))
  .data?.orders?.find((o) => o.id === orderId);
ok(
  "courier booking can be cleared (mistake fix)",
  clear.status === 200 && afterClear?.courierPartnerId == null && afterClear?.awbNumber == null,
  { assign2: assign2.status, clear: clear.status }
);

// 3h. assign requires auth
const anonAssign = await api("PUT", `/api/admin/orders/${orderId}/courier`, {
  body: { courierPartnerId: ekartSeed.id, awbNumber: "X1" },
});
ok("unauthenticated courier assignment rejected", anonAssign.status === 401, anonAssign.status);

// =====================================================
// 4. EXISTING WORKFLOWS UNTOUCHED
// =====================================================
console.log("\n# regression: existing workflows");

// person-based delivery partner registration endpoint still alive
const dpList = await api("GET", "/api/admin/delivery/partners", { token: superTok });
ok(
  "person-based delivery partners endpoints intact (delivery.js)",
  dpList.status === 200 || dpList.status === 404 ? dpList.status === 200 : false,
  dpList.status
);

// customer quote still matches order total (configured charges honoured)
const quote2 = await api("POST", "/api/orders/quote", {
  token: buyerTok,
  body: { items: [{ productId, quantity: 2 }], state: "Uttar Pradesh", deliveryMethod: "Standard" },
});
ok("checkout quote endpoint intact", quote2.status === 200 && typeof quote2.data?.quote?.grandTotal === "number", quote2.data);

// core routes still healthy
for (const route of ["/api/products", "/api/categories", "/api/payment/config", "/api/site/content"]) {
  const r = await fetch(BASE + route);
  ok(`core route ${route} → 200`, r.status === 200, r.status);
}

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log("Failures:\n - " + failures.join("\n - "));
clearTimeout(watchdog);
be.kill("SIGTERM");
process.exit(failed ? 1 : 0);
