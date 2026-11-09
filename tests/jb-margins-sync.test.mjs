// =====================================================
// JUSTBRAND — profit margin rules + automatic stock/price sync
// =====================================================
// Spawns the REAL backend on an isolated port with a THROWAWAY
// database and verifies, at the API level:
//   • admin profit margin rules (global / seller / supplier /
//     category), precedence, audit history before/after
//   • price preview: supplier ₹1,000 + 20% = ₹1,200 and
//     ₹1,000 + ₹100 fixed = ₹1,100, with GST/delivery added once
//   • supplier price stored raw + markup stored separately;
//     re-sync recomputes from the raw price (no compounding)
//   • stock 0 → out of stock; failed sync → stock unverified →
//     buyer order refused (old stock is not shown as available)
//   • checkout re-checks LIVE supplier stock before the order
//   • default schedule 00:00 Asia/Kolkata, admin change applies,
//     failed-sync retry scheduling
//   • connectors: IndiaMART (crmkey) and Udaan (basic) are separate
//     adapters marked UNVERIFIED — never reported as working
//   • isolation: sellers cannot read margin rules or each other's data
//
// Production is never contacted. Run: node tests/jb-margins-sync.test.mjs
// =====================================================

import { spawn } from "node:child_process";
import http from "node:http";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(REPO_ROOT, "tests", ".tmp", "jb-margins-sync-db");
// Random port per run: a leftover test backend from an interrupted run
// must never be mistaken for this run's server.
const PORT =
  Number(process.env.JB_TEST_PORT) || 4700 + Math.floor(Math.random() * 200);
const BASE = `http://127.0.0.1:${PORT}`;
const SUPPLIER_KEY = "sup-key-123456";
const CRM_KEY = "crm-key-test";

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

// ---------- throwaway DB ----------
rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });

// ---------- fake supplier ----------
let catalog = [];
let failMode = false;
let lastCrmKey = null;
let hits = 0;

const supplier = http.createServer((req, res) => {
  hits++;
  const url = new URL(req.url, "http://localhost");

  if (url.searchParams.get("crmkey")) {
    lastCrmKey = url.searchParams.get("crmkey");
    if (lastCrmKey !== CRM_KEY) {
      res.writeHead(401, { "content-type": "application/json" });
      return res.end(JSON.stringify({ error: "bad crmkey" }));
    }
  } else if (req.headers["x-api-key"] !== SUPPLIER_KEY) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "bad key" }));
  }

  if (failMode) {
    res.writeHead(500, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "supplier down" }));
  }

  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify({ data: { products: catalog } }));
});

await new Promise((resolve) => supplier.listen(0, "127.0.0.1", resolve));
const SUPPLIER_PORT = supplier.address().port;

// ---------- backend ----------
try {
  if ((await fetch(`${BASE}/api/health`)).ok) {
    console.error(`PORT ${PORT} IS ALREADY SERVING — aborting instead of testing a stale process`);
    supplier.close();
    process.exit(4);
  }
} catch {}

const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: "jb-margins-test-secret-local-only",
    JB_CREDENTIAL_KEY: "jb-margins-credential-key",
    JB_ALLOW_PRIVATE_SUPPLIER_HOSTS: "1",
    JB_CHECKOUT_REFRESH_TTL_MS: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let beErr = "";
be.stderr.on("data", (d) => (beErr = (beErr + d.toString()).slice(-3000)));

const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT");
  try { be.kill("SIGTERM"); } catch {}
  try { supplier.close(); } catch {}
  process.exit(2);
}, 150000);

function shutdown(code) {
  clearTimeout(watchdog);
  try { be.kill("SIGKILL"); } catch {}
  try { supplier.close(); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(code);
}

let up = false;
for (let i = 0; i < 90 && !up && be.exitCode === null; i++) {
  try {
    up = (await fetch(`${BASE}/api/health`)).ok;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up || be.exitCode !== null) {
  console.error(`BACKEND NOT USABLE (up=${up}, exit=${be.exitCode})\n${beErr}`);
  shutdown(3);
}
ok("backend boots with margins + sync module", true);

// ---------- accounts ----------
const staffLogin = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const superTok = staffLogin.data?.token;
ok("superadmin login", Boolean(superTok));

async function makeSeller(suffix, mobile) {
  const reg = await api("POST", "/api/sellers/register", {
    body: {
      name: `Margin Seller ${suffix}`,
      shopName: `Margin Shop ${suffix}`,
      mobile,
      email: `margin${suffix}@x.com`,
      password: "seller123",
    },
  });
  const id = reg.data?.seller?.id;
  await api("PUT", `/api/admin/sellers/${id}/kyc`, { token: superTok, body: { kycStatus: "Approved" } });
  const login = await api("POST", "/api/sellers/login", { body: { mobile, password: "seller123" } });
  const taxReady = await onboardGstSeller(api, {
    sellerToken: login.data?.token,
    staffToken: superTok,
  });
  ok(`seller ${suffix} KYC + PAN + GST approved`, taxReady.ok, JSON.stringify(taxReady.response));
  return { id, token: login.data?.token };
}

const sellerA = await makeSeller("a", "9822200001");
const sellerB = await makeSeller("b", "9822200002");
ok("two approved sellers", Boolean(sellerA.token && sellerB.token));

const customerReg = await api("POST", "/api/customers/register", {
  body: { name: "Margin Buyer", mobile: "9822200009", email: "buyer@x.com", password: "buyer123" },
});
const customerLogin = await api("POST", "/api/customers/login", {
  body: { mobile: "9822200009", password: "buyer123" },
});
const customerTok = customerLogin.data?.token;
ok("customer account ready", Boolean(customerReg.status < 500 && customerTok));

// =====================================================
// 1. SUPPLIER INTEGRATION (generic, approved)
// =====================================================
console.log("\n# supplier integration");

const saveIntegration = await api("PUT", "/api/sellers/integration", {
  token: sellerA.token,
  body: {
    connector: "generic",
    providerName: "Margin Test Supplier",
    baseUrl: `http://127.0.0.1:${SUPPLIER_PORT}`,
    authType: "api_key",
    authHeaderName: "X-API-Key",
    apiKey: SUPPLIER_KEY,
    productsPath: "/products",
    productsKey: "data.products",
    mapping: {},
    syncFrequencyMinutes: 1440,
    autoSync: true,
  },
});
const integrationId = saveIntegration.data?.integration?.id;
ok("generic integration saved", saveIntegration.status === 200, saveIntegration.data);
ok("credentials are masked in the response", saveIntegration.data?.integration?.apiKeyHint === "••••3456");

const approve = await api("POST", `/api/admin/seller-integrations/${integrationId}/approve`, {
  token: superTok,
});
ok("admin approves the integration", approve.status === 200, approve.data);

// =====================================================
// 2. MARGIN RULES
// =====================================================
console.log("\n# profit margin rules");

const sellerMargins = await api("GET", "/api/admin/margins", { token: sellerA.token });
ok("seller cannot read admin margin rules", sellerMargins.status === 403, sellerMargins.status);

const initial = await api("GET", "/api/admin/margins", { token: superTok });
ok("margin rules load for admin", initial.status === 200 && Array.isArray(initial.data?.rules));
const seededGlobal = initial.data?.rules?.find((rule) => rule.scopeType === "global");
ok("seeded global rule is 0% (no surprise markup)", seededGlobal?.marginValue === 0);

const setGlobal = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: {
    scopeType: "global",
    marginType: "percent",
    marginValue: 20,
    notes: "Global default markup",
    reason: "Set default 20% margin",
  },
});
ok("global 20% margin saved", setGlobal.status === 200 && setGlobal.data?.rule?.marginValue === 20, setGlobal.data);

const globalAudit = setGlobal.data?.audit?.[0];
ok(
  "global change is audited with before/after",
  globalAudit?.action === "updated" &&
    globalAudit?.before?.marginValue === 0 &&
    globalAudit?.after?.marginValue === 20,
  globalAudit
);

const setSeller = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "seller", scopeId: sellerA.id, marginType: "percent", marginValue: 10 },
});
ok("seller-specific 10% margin saved", setSeller.status === 200, setSeller.data);

const setCategory = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "category", scopeId: "Electronics", marginType: "percent", marginValue: 15 },
});
ok("category-specific 15% margin saved", setCategory.status === 200, setCategory.data);
ok("category rule key is case-insensitive", setCategory.data?.rule?.scopeKey === "category:electronics");

const setSupplier = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "supplier", scopeId: integrationId, marginType: "percent", marginValue: 25 },
});
ok("supplier-specific 25% margin saved", setSupplier.status === 200, setSupplier.data);

const badMargin = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "global", marginType: "percent", marginValue: 9999 },
});
ok("invalid markup is rejected", badMargin.status === 400, badMargin.status);

// =====================================================
// 3. PRICE PREVIEW (example from the request)
// =====================================================
console.log("\n# price preview");

const previewSupplier = await api("POST", "/api/admin/margins/preview", {
  token: superTok,
  body: { supplierPrice: 1000, integrationId, category: "Electronics" },
});
const p1 = previewSupplier.data?.preview;
ok("preview resolves the supplier rule (25%)", p1?.marginLevel === "supplier", p1?.marginLevel);
ok("preview keeps supplier price separate", p1?.supplierPrice === 1000);
ok("supplier ₹1,000 + 25% = ₹1,250 selling", p1?.sellingPrice === 1250, p1?.sellingPrice);
ok("markup amount is ₹250", p1?.markupAmount === 250, p1?.markupAmount);
ok("final customer price includes GST/fees once", p1?.customerPrice > p1?.sellingPrice, p1?.customerPrice);

const previewPercent = await api("POST", "/api/admin/margins/preview", {
  token: superTok,
  body: { supplierPrice: 1000, marginType: "percent", marginValue: 20 },
});
ok(
  "₹1,000 + 20% = ₹1,200 (request example)",
  previewPercent.data?.preview?.sellingPrice === 1200,
  previewPercent.data?.preview
);

const previewFixed = await api("POST", "/api/admin/margins/preview", {
  token: superTok,
  body: { supplierPrice: 1000, marginType: "fixed", marginValue: 100 },
});
ok(
  "₹1,000 + ₹100 fixed = ₹1,100 (request example)",
  previewFixed.data?.preview?.sellingPrice === 1100,
  previewFixed.data?.preview
);

const previewSeller = await api("POST", "/api/admin/margins/preview", {
  token: superTok,
  body: { supplierPrice: 1000, sellerId: sellerA.id, category: "Grocery" },
});
ok("falls back to the seller rule (10%)", previewSeller.data?.preview?.sellingPrice === 1100);

const previewGlobal = await api("POST", "/api/admin/margins/preview", {
  token: superTok,
  body: { supplierPrice: 1000 },
});
ok("falls back to the global rule (20%)", previewGlobal.data?.preview?.sellingPrice === 1200);

// =====================================================
// 4. SYNC APPLIES MARKUP (no compounding)
// =====================================================
console.log("\n# sync applies markup once");

catalog = [
  {
    sku: "M-1",
    name: "Synced Electronics",
    category: "Electronics",
    price: 1000,
    stock: 5,
    hsnCode: "8517",
    images: ["https://img.example.com/m1.jpg"],
  },
  {
    sku: "M-2",
    name: "Synced Grocery",
    category: "Grocery",
    price: 500,
    stock: 0,
    images: ["https://img.example.com/m2.jpg"],
  },
];

const sync1 = await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });
ok("first sync succeeds", sync1.data?.result?.status === "success", sync1.data);
ok("new products are created Pending", sync1.data?.result?.created === 2, sync1.data?.result);

const adminProducts = await api("GET", "/api/admin/products", { token: superTok });
const list = adminProducts.data?.products || [];
const m1 = list.find((product) => product.sku === "M-1");
const m2 = list.find((product) => product.sku === "M-2");

ok("synced product is Pending (admin approval required)", m1?.status === "Pending", m1?.status);
ok("selling price = supplier 1000 + 25% = 1250", Number(m1?.price) === 1250, m1?.price);
ok("raw supplier price stored separately", Number(m1?.supplierPrice) === 1000);
ok("markup stored separately (₹250)", Number(m1?.markupAmount) === 250);
ok("markup type/value recorded", m1?.markupType === "percent" && Number(m1?.markupValue) === 25);
ok("customer price is higher than the selling price", Number(m1?.customerPrice) > 1250);
// Precedence: the supplier rule (25%) is MORE specific than the
// category/global rule, so it applies to every SKU of that supplier.
ok("supplier rule wins over global: ₹500 + 25% = ₹625", Number(m2?.price) === 625, m2?.price);
ok("zero stock means out of stock", m2?.inStock === false && Number(m2?.stock) === 0);

// same supplier price again → must NOT compound (1250 → 1250, not 1562.5)
await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });
let again = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find(
  (product) => product.sku === "M-1"
);
ok("re-sync does not apply markup twice", Number(again.price) === 1250, again.price);

// supplier raises price → markup recomputed from the RAW price
catalog = catalog.map((item) =>
  item.sku === "M-1" ? { ...item, price: 1100 } : item
);
const sync2 = await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });
ok("price update sync succeeds", sync2.data?.result?.updated >= 1, sync2.data?.result);
again = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find(
  (product) => product.sku === "M-1"
);
ok("₹1,100 + 25% = ₹1,375 (from raw price)", Number(again.price) === 1375, again.price);
ok("supplier price remains ₹1,100", Number(again.supplierPrice) === 1100);

// =====================================================
// 5. APPROVAL + BUYER VISIBILITY + GST PARITY
// =====================================================
console.log("\n# approval & customer price parity");

const approveM1 = await api("PUT", `/api/admin/products/${m1.id}/approve`, { token: superTok });
ok("admin approves the synced product", approveM1.status === 200, approveM1.data);

const manual = await api("POST", "/api/sellers/products", {
  token: sellerA.token,
  body: {
    name: "Manual Electronics",
    category: "Electronics",
    price: "1375",
    stock: "10",
    hsnCode: "8517",
    image: "https://img.example.com/manual.jpg",
  },
});
ok("manual product created for parity check", manual.status === 200 || manual.status === 201, manual.data);
const manualId = manual.data?.product?.id;
await api("PUT", `/api/admin/products/${manualId}/approve`, { token: superTok });

const adminAfterApproval = (await api("GET", "/api/admin/products", { token: superTok })).data.products;
const syncedApproved = adminAfterApproval.find((product) => product.sku === "M-1");
const manualApproved = adminAfterApproval.find((product) => product.id === manualId);
ok(
  "same selling price → same customer price (GST/delivery not doubled)",
  Number(syncedApproved?.customerPrice) === Number(manualApproved?.customerPrice),
  { synced: syncedApproved?.customerPrice, manual: manualApproved?.customerPrice }
);

const publicList = await fetch(`${BASE}/api/products`).then((res) => res.json());
const publicProduct = publicList.find((product) => product.id === m1.id);
ok("approved synced product is public", Boolean(publicProduct));
ok("buyer payload never exposes supplier cost / markup", publicProduct && !("supplierPrice" in publicProduct) && !("markupAmount" in publicProduct));
ok("buyer sees inStock true with stock 5", publicProduct?.inStock === true);

const sellerProducts = await api("GET", "/api/sellers/products", { token: sellerA.token });
const sellerRow = sellerProducts.data?.products?.find((product) => product.sku === "M-1");
ok("seller payload hides the supplier cost / markup too", sellerRow && !("supplierPrice" in sellerRow) && !("markupAmount" in sellerRow));

// =====================================================
// 6. STOCK 0 + FAILED SYNC SAFETY
// =====================================================
console.log("\n# stock safety");

catalog = catalog.map((item) => (item.sku === "M-1" ? { ...item, stock: 0 } : item));
await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });
let pub = await fetch(`${BASE}/api/products`).then((res) => res.json());
let pubM1 = pub.find((product) => product.id === m1.id);
ok("stock 0 → product shows out of stock", pubM1?.inStock === false && Number(pubM1?.stock) === 0);

const zeroOrder = await api("POST", "/api/orders", {
  token: customerTok,
  body: {
    items: [{ productId: m1.id, quantity: 1 }],
    address: "12 Test Street, Andheri West, Mumbai",
    phone: "9822200009",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400053",
  },
});
ok("checkout refuses zero stock", zeroOrder.status >= 400, zeroOrder.status);

// supplier restores stock
catalog = catalog.map((item) => (item.sku === "M-1" ? { ...item, stock: 5 } : item));
await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });

// failed sync → old stock must not stay available
failMode = true;
const failedSync = await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });
ok("supplier failure produces a failed sync", failedSync.data?.result?.status === "failed", failedSync.data?.result);
ok("failed sync schedules a retry", failedSync.data?.result?.retryScheduled === true);

const afterFail = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find(
  (product) => product.sku === "M-1"
);
ok("failed sync marks stock unverified", afterFail?.stockUnverified === true, afterFail?.stockUnverified);

pub = await fetch(`${BASE}/api/products`).then((res) => res.json());
pubM1 = pub.find((product) => product.id === m1.id);
ok("unverified stock is not shown as available", pubM1?.inStock === false);

const blockedOrder = await api("POST", "/api/orders", {
  token: customerTok,
  body: {
    items: [{ productId: m1.id, quantity: 1 }],
    address: "12 Test Street, Andheri West, Mumbai",
    phone: "9822200009",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400053",
  },
});
ok(
  "order refused when supplier stock is unconfirmed",
  blockedOrder.status === 409 && blockedOrder.data?.code === "STOCK_UNVERIFIED",
  blockedOrder.data
);

const integrationAfterFail = (await api("GET", "/api/admin/seller-integrations", { token: superTok })).data.integrations.find(
  (row) => row.id === integrationId
);
ok("last successful sync time is still shown", Boolean(integrationAfterFail?.lastSuccessfulSyncAt));
ok("sync failure status is visible to admin", integrationAfterFail?.lastSyncStatus === "failed");
ok("retry count is tracked", Number(integrationAfterFail?.syncRetryCount) >= 1);

failMode = false;
const recover = await api("POST", "/api/sellers/integration/sync", { token: sellerA.token });
ok("recovery sync succeeds", recover.data?.result?.status !== "failed");
const afterRecover = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find(
  (product) => product.sku === "M-1"
);
ok("successful sync clears the unverified flag", afterRecover?.stockUnverified === false);

// =====================================================
// 7. CHECKOUT REFRESHES LIVE SUPPLIER STOCK
// =====================================================
console.log("\n# checkout-time live stock check");

catalog = catalog.map((item) => (item.sku === "M-1" ? { ...item, stock: 7 } : item));
const hitsBefore = hits;

const order = await api("POST", "/api/orders", {
  token: customerTok,
  body: {
    items: [{ productId: m1.id, quantity: 1 }],
    address: "12 Test Street, Andheri West, Mumbai",
    phone: "9822200009",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400053",
  },
});
ok("order succeeds when supplier confirms stock", order.status === 200 || order.status === 201, order.data);
ok("checkout contacted the supplier live", hits > hitsBefore, { hits, hitsBefore });

const afterOrder = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find(
  (product) => product.sku === "M-1"
);
ok("order decrements the live stock (7 → 6)", Number(afterOrder?.stock) === 6, afterOrder?.stock);

// supplier drops stock without any scheduled sync → checkout must catch it
catalog = catalog.map((item) => (item.sku === "M-1" ? { ...item, stock: 0 } : item));
await new Promise((resolve) => setTimeout(resolve, 50));
const staleOrder = await api("POST", "/api/orders", {
  token: customerTok,
  body: {
    items: [{ productId: m1.id, quantity: 1 }],
    address: "12 Test Street, Andheri West, Mumbai",
    phone: "9822200009",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400053",
  },
});
ok(
  "checkout catches a stock drop that no sync has seen yet",
  staleOrder.status === 400 || staleOrder.status === 409,
  staleOrder.data
);

// =====================================================
// 8. SCHEDULE + RETRY SETTINGS
// =====================================================
console.log("\n# sync schedule");

const settingsRes = await api("GET", "/api/admin/import-settings", { token: superTok });
const settings = settingsRes.data?.settings;
ok("default schedule is 00:00 Asia/Kolkata", settings?.scheduleTime === "00:00" && settings?.scheduleTimezone === "Asia/Kolkata");
ok("default frequency is daily (1440 min)", Number(settings?.scheduleFrequencyMinutes) === 1440);
ok("default retry policy present", Number(settings?.syncRetryLimit) >= 0 && Number(settings?.syncRetryBackoffMinutes) >= 5);

const integrationsA = (await api("GET", "/api/admin/seller-integrations", { token: superTok })).data.integrations.find(
  (row) => row.id === integrationId
);
const nextAt = new Date(integrationsA?.nextSyncAt || 0);
ok(
  "next run is scheduled at 00:00 IST (18:30 UTC)",
  nextAt.getUTCHours() === 18 && nextAt.getUTCMinutes() === 30,
  integrationsA?.nextSyncAt
);

const badTime = await api("PUT", "/api/admin/import-settings", {
  token: superTok,
  body: { scheduleTime: "25:00" },
});
ok("invalid schedule time rejected", badTime.status === 400);

const newSchedule = await api("PUT", "/api/admin/import-settings", {
  token: superTok,
  body: { scheduleTime: "21:30", scheduleFrequencyMinutes: 1440, scheduleMode: "global", syncRetryLimit: 2, syncRetryBackoffMinutes: 15 },
});
ok("admin changes the schedule", newSchedule.status === 200, newSchedule.data);

const integrationsB = (await api("GET", "/api/admin/seller-integrations", { token: superTok })).data.integrations.find(
  (row) => row.id === integrationId
);
const changed = new Date(integrationsB?.nextSyncAt || 0);
ok(
  "schedule change recalculates the next run (21:30 IST = 16:00 UTC)",
  changed.getUTCHours() === 16 && changed.getUTCMinutes() === 0,
  integrationsB?.nextSyncAt
);

// =====================================================
// 9. CONNECTORS — IndiaMART / Udaan (unverified by design)
// =====================================================
console.log("\n# IndiaMART / Udaan connectors");

const indiamart = await api("PUT", "/api/sellers/integration", {
  token: sellerB.token,
  body: {
    connector: "indiamart",
    providerName: "IndiaMART",
    baseUrl: `http://127.0.0.1:${SUPPLIER_PORT}`,
    authType: "bearer",
    apiKey: CRM_KEY,
    productsPath: "/products",
    mapping: {},
  },
});
ok("IndiaMART connector saves", indiamart.status === 200, indiamart.data);
ok("IndiaMART forces its documented crmkey auth", indiamart.data?.integration?.authType === "crmkey");
ok(
  "IndiaMART connector is marked unverified (not claimed working)",
  indiamart.data?.integration?.connectorInfo?.verification === "unverified_partner" &&
    indiamart.data?.integration?.connectorInfo?.certified === false
);

const udaan = await api("PUT", "/api/sellers/integration", {
  token: sellerB.token,
  body: {
    connector: "udaan",
    providerName: "Udaan",
    baseUrl: `http://127.0.0.1:${SUPPLIER_PORT}`,
    authType: "bearer",
    apiKey: "udaan-user",
    apiSecret: "udaan-pass",
    productsPath: "/products",
    mapping: {},
  },
});
ok("Udaan connector saves", udaan.status === 200, udaan.data);
ok("Udaan forces Basic auth (partner-issued credentials)", udaan.data?.integration?.authType === "basic");
ok(
  "Udaan connector is marked unverified",
  udaan.data?.integration?.connectorInfo?.certified === false
);

const sellerConnectors = await api("GET", "/api/sellers/integration", { token: sellerB.token });
ok(
  "connector registry is exposed to the seller UI",
  Array.isArray(sellerConnectors.data?.connectors) &&
    sellerConnectors.data.connectors.some((item) => item.key === "indiamart") &&
    sellerConnectors.data.connectors.some((item) => item.key === "udaan")
);

// =====================================================
// 10. ADMIN REPRICE + MANUAL SYNC
// =====================================================
console.log("\n# admin reprice & manual sync");

await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "supplier", scopeId: integrationId, marginType: "percent", marginValue: 30 },
  reason: "Raise supplier margin",
});

const reprice = await api("POST", `/api/admin/seller-integrations/${integrationId}/reprice`, {
  token: superTok,
});
ok("admin reprice runs", reprice.status === 200 && reprice.data?.repriced >= 1, reprice.data);

const repriced = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find(
  (product) => product.sku === "M-1"
);
ok("reprice uses the raw supplier price (₹1,100 + 30% = ₹1,430)", Number(repriced?.price) === 1430, repriced?.price);
ok("supplier price is unchanged by repricing", Number(repriced?.supplierPrice) === 1100);

const manualSync = await api("POST", `/api/admin/seller-integrations/${integrationId}/sync`, {
  token: superTok,
});
ok("admin can trigger a manual sync", manualSync.status === 200, manualSync.data);

const auditNow = (await api("GET", "/api/admin/margins", { token: superTok })).data.audit;
ok("audit history keeps every change", auditNow.length >= 5, auditNow.length);
ok(
  "audit records the supplier margin change 25% → 30%",
  auditNow.some(
    (entry) =>
      entry.scopeType === "supplier" &&
      entry.before?.marginValue === 25 &&
      entry.after?.marginValue === 30
  )
);

// =====================================================
// 11. ISOLATION
// =====================================================
console.log("\n# isolation");

ok(
  "seller B sees only its own integration",
  sellerConnectors.data?.integration?.providerName === "Udaan"
);
const sellerBRuns = await api("GET", "/api/sellers/integration/runs", { token: sellerB.token });
ok("seller B has no access to seller A sync runs", (sellerBRuns.data?.runs || []).length === 0);

const sellerBMargins = await api("POST", "/api/admin/margins/preview", {
  token: sellerB.token,
  body: { supplierPrice: 1000 },
});
ok("seller cannot use the margin preview endpoint", sellerBMargins.status === 403);

shutdown(failed === 0 ? 0 : 1);
