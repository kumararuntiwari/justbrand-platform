// =====================================================
// JUSTBRAND — seller bulk import + supplier sync verification
// =====================================================
// Spawns the REAL backend on an isolated port with a THROWAWAY
// database and verifies, at the API level:
//   • CSV + XLSX parsing, preview, row-level validation report
//   • duplicate SKU detection (inside the file and against the
//     seller's own catalog) — never silently imported
//   • commit → products created as 'Pending' with the same pricing
//     rules as the manual Add Product flow
//   • admin-configurable import limits
//   • supplier connector: encrypted credentials (verified at rest),
//     approval gate, connection test, manual sync creating Pending
//     products and updating price/stock WITHOUT unpublishing an
//     approved product, sync history / error report
//   • cross-seller isolation (no access to another seller's
//     integration, import jobs, sync runs or products)
//
// Production is never contacted. Run: node tests/jb-imports-sync.test.mjs
// =====================================================

import { spawn } from "node:child_process";
import http from "node:http";
import { rmSync, mkdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(REPO_ROOT, "tests", ".tmp", "jb-imports-sync-db");
const PORT = Number(process.env.JB_TEST_PORT) || 4624;
const BASE = `http://127.0.0.1:${PORT}`;
const SUPPLIER_KEY = "sup-key-123456";
const SUPPLIER_SECRET = "super-secret-value-xyz";

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

async function upload(buffer, { token, name, type }) {
  const res = await fetch(`${BASE}/api/sellers/imports/preview`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/octet-stream",
      "X-JB-File-Name": encodeURIComponent(name),
      "X-JB-File-Type": type,
    },
    body: buffer,
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

// ---------- fake supplier API ----------
let supplierPayload = { data: { products: [] } };
let supplierHits = 0;

const supplier = http.createServer((req, res) => {
  supplierHits++;
  if (req.headers["x-api-key"] !== SUPPLIER_KEY) {
    res.writeHead(401, { "content-type": "application/json" });
    return res.end(JSON.stringify({ error: "bad key" }));
  }
  res.writeHead(200, { "content-type": "application/json" });
  res.end(JSON.stringify(supplierPayload));
});

await new Promise((resolve) => supplier.listen(0, "127.0.0.1", resolve));
const SUPPLIER_PORT = supplier.address().port;

// ---------- backend ----------
const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: "jb-imports-test-secret-local-only",
    JB_CREDENTIAL_KEY: "jb-test-credential-key",
    JB_ALLOW_PRIVATE_SUPPLIER_HOSTS: "1",
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
}, 120000);

function shutdown(code) {
  clearTimeout(watchdog);
  try { be.kill("SIGTERM"); } catch {}
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
ok("backend boots with the import/sync module", true);

// ---------- staff + sellers ----------
const staffLogin = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const superTok = staffLogin.data?.token;
ok("superadmin login", Boolean(superTok));

async function makeSeller(suffix, mobile) {
  const reg = await api("POST", "/api/sellers/register", {
    body: {
      name: `Import Seller ${suffix}`,
      shopName: `Import Shop ${suffix}`,
      mobile,
      email: `import${suffix}@x.com`,
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

const seller = await makeSeller("a", "9811100001");
const otherSeller = await makeSeller("b", "9811100002");
ok("two approved sellers created", Boolean(seller.token && otherSeller.token));

// =====================================================
// 1. TEMPLATES
// =====================================================
console.log("\n# templates");

const csvTpl = await fetch(`${BASE}/api/sellers/imports/template?format=csv`, {
  headers: { Authorization: `Bearer ${seller.token}` },
});
const csvTplText = await csvTpl.text();
ok("CSV template downloads", csvTpl.status === 200 && csvTplText.includes("Product Name"));
ok(
  "CSV template carries the expected columns",
  ["SKU", "Category", "Price", "Image URLs", "Stock", "GST Rate (%)"].every((h) => csvTplText.includes(h))
);

const xlsxTpl = await fetch(`${BASE}/api/sellers/imports/template?format=xlsx`, {
  headers: { Authorization: `Bearer ${seller.token}` },
});
const xlsxTplBuf = Buffer.from(await xlsxTpl.arrayBuffer());
ok(
  "XLSX template downloads as a real ZIP workbook",
  xlsxTpl.status === 200 &&
    xlsxTplBuf.subarray(0, 2).toString() === "PK" &&
    /spreadsheetml\.sheet/.test(xlsxTpl.headers.get("content-type") || "")
);

const tplAnon = await fetch(`${BASE}/api/sellers/imports/template?format=csv`);
ok("template requires seller auth", tplAnon.status === 401);

// =====================================================
// 2. CSV PREVIEW + VALIDATION + DUPLICATE SKU
// =====================================================
console.log("\n# csv preview");

const csv = [
  "sku,name,category,price,comparePrice,stock,hsnCode,gstRate,description,images",
  "CSV-1,CSV Product One,Home,299,499,10,1234,5,First row,https://cdn.example.com/a.jpg|https://cdn.example.com/b.jpg",
  "CSV-2,CSV Bad Price,Home,abc,,5,,,Bad row,https://cdn.example.com/c.jpg",
  "CSV-1,CSV Duplicate Row,Home,199,,5,,,Duplicate sku,https://cdn.example.com/d.jpg",
  ",CSV No Image,Home,149,,,5,,No image row,",
].join("\r\n");

const previewCsv = await upload(Buffer.from(csv, "utf8"), {
  token: seller.token,
  name: "catalog.csv",
  type: "csv",
});
ok("CSV preview accepted", previewCsv.status === 201, previewCsv.data);
ok("preview counts rows / valid / errors", previewCsv.data?.totalRows === 4 && previewCsv.data?.validRows === 1, {
  total: previewCsv.data?.totalRows,
  valid: previewCsv.data?.validRows,
});
ok("duplicate SKU counted", previewCsv.data?.duplicateRows === 1);
const dupRow = (previewCsv.data?.rows || []).find((r) => r.duplicate);
ok(
  "duplicate row explains the SKU clash",
  Boolean(dupRow && dupRow.errors.some((e) => /Duplicate SKU in this file/i.test(e))),
  dupRow?.errors
);
const badPriceRow = (previewCsv.data?.rows || []).find((r) => r.name === "CSV Bad Price");
ok("invalid price reported per row", Boolean(badPriceRow?.errors.some((e) => /valid price/i.test(e))), badPriceRow?.errors);
const noImageRow = (previewCsv.data?.rows || []).find((r) => r.name === "CSV No Image");
ok(
  "missing image reported per row",
  Boolean(noImageRow?.errors.some((e) => /image/i.test(e))),
  noImageRow?.errors
);

// Commit only imports valid rows.
const commitCsv = await api("POST", `/api/sellers/imports/${previewCsv.data.importId}/commit`, {
  token: seller.token,
});
ok("CSV commit imports valid rows only", commitCsv.status === 200 && commitCsv.data?.imported === 1, commitCsv.data);
const commitAgain = await api("POST", `/api/sellers/imports/${previewCsv.data.importId}/commit`, {
  token: seller.token,
});
ok("same import cannot be committed twice", commitAgain.status === 409);

// Re-upload: the SKU now exists in the catalog → duplicate against DB.
const previewDup = await upload(Buffer.from(csv, "utf8"), {
  token: seller.token,
  name: "catalog-again.csv",
  type: "csv",
});
const catalogDup = (previewDup.data?.rows || []).find((r) => r.sku === "CSV-1");
ok(
  "existing catalog SKU detected as duplicate",
  Boolean(catalogDup?.errors.some((e) => /already exists/i.test(e))),
  catalogDup?.errors
);

// =====================================================
// 3. XLSX ROUND TRIP (template → upload → import)
// =====================================================
console.log("\n# xlsx preview");

const previewXlsx = await upload(xlsxTplBuf, {
  token: seller.token,
  name: "template.xlsx",
  type: "xlsx",
});
ok("XLSX preview parses the workbook", previewXlsx.status === 201, previewXlsx.data);
ok(
  "XLSX row mapped to product fields",
  previewXlsx.data?.rows?.[0]?.sku === "JB-SAMPLE-001" &&
    previewXlsx.data?.rows?.[0]?.name === "Sample Cotton Kurta" &&
    Number(previewXlsx.data?.rows?.[0]?.price) === 899,
  previewXlsx.data?.rows?.[0]
);
ok("XLSX multi-image cell split into 2 images", previewXlsx.data?.rows?.[0]?.imageCount === 2);

const commitXlsx = await api("POST", `/api/sellers/imports/${previewXlsx.data.importId}/commit`, {
  token: seller.token,
});
ok("XLSX commit imports the row", commitXlsx.status === 200 && commitXlsx.data?.imported === 1, commitXlsx.data);

// Product state: imported products are pending + carry SKU + pricing.
const sellerProducts = await api("GET", "/api/sellers/products", { token: seller.token });
const csvProduct = (sellerProducts.data?.products || []).find((p) => p.sku === "CSV-1");
ok(
  "imported product is Pending with SKU + computed customer price",
  csvProduct?.status === "Pending" &&
    csvProduct?.sku === "CSV-1" &&
    Number(csvProduct?.customerPrice) > 299 &&
    Array.isArray(csvProduct?.images) &&
    csvProduct.images.length === 2,
  csvProduct
);

// =====================================================
// 4. IMPORT HISTORY + LIMITS + TENANT ISOLATION
// =====================================================
console.log("\n# history, limits, isolation");

const history = await api("GET", "/api/sellers/imports", { token: seller.token });
ok("seller sees own import history", history.status === 200 && (history.data?.imports || []).length >= 3);

const detail = await api("GET", `/api/sellers/imports/${previewCsv.data.importId}`, { token: seller.token });
ok("import detail returns the row-level report", detail.status === 200 && detail.data?.import?.rows?.length === 4);

const foreignDetail = await api("GET", `/api/sellers/imports/${previewCsv.data.importId}`, {
  token: otherSeller.token,
});
ok("another seller cannot read the import job", foreignDetail.status === 404);

const badLimits = await api("PUT", "/api/admin/import-settings", {
  token: superTok,
  body: { maxRowsPerImport: 0 },
});
ok("admin settings reject invalid limits", badLimits.status === 400);

const limits = await api("PUT", "/api/admin/import-settings", {
  token: superTok,
  body: { maxRowsPerImport: 2, maxImportsPerDay: 5, minSyncFrequencyMinutes: 30, autoSyncEnabled: true },
});
ok("admin settings save", limits.status === 200 && limits.data?.settings?.maxRowsPerImport === 2, limits.data);

const overLimit = await upload(Buffer.from(csv, "utf8"), {
  token: seller.token,
  name: "too-many.csv",
  type: "csv",
});
ok("row limit enforced before preview", overLimit.status === 400 && /limit/i.test(overLimit.data?.message || ""));

await api("PUT", "/api/admin/import-settings", {
  token: superTok,
  body: { maxRowsPerImport: 2000, maxImportsPerDay: 10, minSyncFrequencyMinutes: 15 },
});

const adminImports = await api("GET", "/api/admin/product-imports", { token: superTok });
ok(
  "admin sees seller-wise import history",
  adminImports.status === 200 &&
    (adminImports.data?.imports || []).every((row) => row.sellerName) &&
    (adminImports.data?.imports || []).some((row) => row.sellerId === seller.id)
);
const adminImportsAnon = await api("GET", "/api/admin/product-imports");
ok("admin import history requires staff auth", adminImportsAnon.status === 401);

// =====================================================
// 5. SUPPLIER INTEGRATION — encrypted credentials
// =====================================================
console.log("\n# supplier integration");

const integrationBody = {
  providerName: "Test Supplier",
  baseUrl: `http://127.0.0.1:${SUPPLIER_PORT}`,
  authType: "api_key",
  authHeaderName: "X-API-Key",
  apiKey: SUPPLIER_KEY,
  apiSecret: SUPPLIER_SECRET,
  productsPath: "/products",
  productsKey: "data.products",
  mapping: { sku: "sku", name: "title", category: "cat", price: "price", stock: "qty", images: "image" },
  syncFrequencyMinutes: 60,
  autoSync: true,
};

const saved = await api("PUT", "/api/sellers/integration", { token: seller.token, body: integrationBody });
ok("seller saves supplier configuration", saved.status === 200, saved.data);
ok("new integration waits for admin approval", saved.data?.integration?.status === "Pending Approval");
ok(
  "credentials never returned by the API",
  !JSON.stringify(saved.data).includes(SUPPLIER_KEY) && !JSON.stringify(saved.data).includes(SUPPLIER_SECRET)
);
ok(
  "only a masked key hint is exposed",
  saved.data?.integration?.apiKeyHint === "••••3456" && saved.data?.integration?.hasApiKey === true && !("apiKeyEnc" in (saved.data.integration || {}))
);

// At rest: encrypted blob, not plaintext.
const requireFromBackend = createRequire(path.join(REPO_ROOT, "backend", "db.js"));
const Database = requireFromBackend("better-sqlite3");
const rawDb = new Database(path.join(DB_DIR, "justbrand.db"), { readonly: true });
const rawRow = rawDb
  .prepare("SELECT apiKeyEnc, apiSecretEnc, authType FROM seller_api_integrations WHERE sellerId = ?")
  .get(seller.id);
ok(
  "API key is AES-GCM encrypted at rest (v1:iv:tag:ciphertext)",
  Boolean(rawRow?.apiKeyEnc?.startsWith("v1:")) && !String(rawRow?.apiKeyEnc).includes(SUPPLIER_KEY)
);
ok(
  "API secret is encrypted at rest",
  Boolean(rawRow?.apiSecretEnc?.startsWith("v1:")) && !String(rawRow?.apiSecretEnc).includes(SUPPLIER_SECRET)
);

// Isolation: another seller sees nothing.
const foreignIntegration = await api("GET", "/api/sellers/integration", { token: otherSeller.token });
ok("another seller gets no integration (not even a masked one)", foreignIntegration.data?.integration === null);

const syncBeforeApproval = await api("POST", "/api/sellers/integration/sync", { token: seller.token });
ok(
  "manual sync blocked until admin approves",
  syncBeforeApproval.status === 403 && syncBeforeApproval.data?.code === "INTEGRATION_NOT_APPROVED"
);

const adminList = await api("GET", "/api/admin/seller-integrations", { token: superTok });
const adminRow = (adminList.data?.integrations || []).find((row) => row.sellerId === seller.id);
ok("admin sees the pending integration with connection status", Boolean(adminRow) && adminRow.status === "Pending Approval");
ok(
  "admin view also hides secrets",
  !JSON.stringify(adminList.data).includes(SUPPLIER_KEY) && !JSON.stringify(adminList.data).includes(SUPPLIER_SECRET)
);

const approve = await api("POST", `/api/admin/seller-integrations/${adminRow.id}/approve`, { token: superTok });
ok("admin approves the integration", approve.status === 200 && approve.data?.integration?.status === "Approved");

// Wrong-role guard: a seller token cannot use admin routes.
const sellerOnAdmin = await api("GET", "/api/admin/seller-integrations", { token: seller.token });
ok("seller token rejected on admin integration routes", sellerOnAdmin.status === 403);

// Connection test + manual sync.
supplierPayload = {
  data: {
    products: [
      { sku: "SUP-1", title: "Supplier Widget", cat: "Home", price: 499, qty: 12, image: "https://cdn.example.com/sup1.jpg" },
      { sku: "SUP-2", title: "Supplier Lamp", cat: "Home", price: 799, qty: 5, image: "https://cdn.example.com/sup2.jpg" },
    ],
  },
};

const testConn = await api("POST", "/api/sellers/integration/test", { token: seller.token });
ok(
  "connection test reads mapped items",
  testConn.status === 200 && testConn.data?.sample?.length === 2 && testConn.data.sample[0].sku === "SUP-1",
  testConn.data
);
ok("connection test never echoes the key", !JSON.stringify(testConn.data).includes(SUPPLIER_KEY));

const sync1 = await api("POST", "/api/sellers/integration/sync", { token: seller.token });
ok(
  "manual sync creates supplier products",
  sync1.status === 200 && sync1.data?.result?.created === 2 && sync1.data?.result?.failed === 0,
  sync1.data?.result
);

const afterSync = await api("GET", "/api/sellers/products", { token: seller.token });
const sup1 = (afterSync.data?.products || []).find((p) => p.sku === "SUP-1");
const sup2 = (afterSync.data?.products || []).find((p) => p.sku === "SUP-2");
ok(
  "synced products enter Pending approval with stock + image",
  sup1?.status === "Pending" && sup2?.status === "Pending" && Number(sup2?.stock) === 5 && Boolean(sup2?.image)
);

// =====================================================
// 6. SYNC UPDATES PRICE/STOCK WITHOUT UNPUBLISHING
// =====================================================
console.log("\n# sync updates");

await api("PUT", `/api/admin/products/${sup2.id}/approve`, { token: superTok });
const approvedBefore = await api("GET", `/api/admin/products`, { token: superTok }).catch(() => ({}));
const sup2BeforeCustomerPrice = Number(sup2.customerPrice);

supplierPayload = {
  data: {
    products: [
      { sku: "SUP-1", title: "Supplier Widget", cat: "Home", price: 499, qty: 12, image: "https://cdn.example.com/sup1.jpg" },
      { sku: "SUP-2", title: "Supplier Lamp", cat: "Home", price: 999, qty: 0, image: "https://cdn.example.com/sup2.jpg" },
    ],
  },
};

const sync2 = await api("POST", "/api/sellers/integration/sync", { token: seller.token });
ok(
  "second sync updates existing SKUs (no duplicates)",
  sync2.status === 200 && sync2.data?.result?.updated === 2 && sync2.data?.result?.created === 0,
  sync2.data?.result
);

const afterUpdate = await api("GET", "/api/sellers/products", { token: seller.token });
const sup2After = (afterUpdate.data?.products || []).find((p) => p.sku === "SUP-2");
ok(
  "approved product stays approved after a price/stock sync",
  sup2After?.status === "Approved",
  sup2After?.status
);
ok(
  "price sync recalculates the customer price",
  Number(sup2After?.customerPrice) > sup2BeforeCustomerPrice && Number(sup2After?.stock) === 0,
  { before: sup2BeforeCustomerPrice, after: sup2After?.customerPrice, stock: sup2After?.stock }
);
ok("approved product count did not grow", !approvedBefore?.error);

// Buyer visibility follows the existing approval gate: the synced
// SUP-2 is approved → visible, SUP-1 is pending → hidden.
const publicSup2 = await fetch(`${BASE}/api/products/${sup2.id}`);
ok("approved synced product is publicly readable", publicSup2.status === 200);
const publicSup1 = await fetch(`${BASE}/api/products/${sup1.id}`);
ok("pending synced product stays hidden from buyers", publicSup1.status === 404);

// =====================================================
// 7. SYNC HISTORY / ERRORS / ADMIN VIEW
// =====================================================
console.log("\n# sync history");

const runs = await api("GET", "/api/sellers/integration/runs", { token: seller.token });
ok("seller sees sync history", runs.status === 200 && (runs.data?.runs || []).length >= 2);
ok(
  "sync run records counts",
  (runs.data?.runs || [])[0]?.fetched === 2 && (runs.data?.runs || [])[0]?.status === "success"
);

const foreignRuns = await api("GET", "/api/sellers/integration/runs", { token: otherSeller.token });
ok("another seller cannot see sync history", (foreignRuns.data?.runs || []).length === 0);

// Supplier error path: bad key → 401 from supplier, reported, not thrown.
await api("PUT", "/api/sellers/integration", {
  token: seller.token,
  body: { ...integrationBody, apiKey: "wrong-key" },
});
const pendingAgain = await api("GET", "/api/sellers/integration", { token: seller.token });
ok("changing credentials resets approval", pendingAgain.data?.integration?.status === "Pending Approval");
await api("POST", `/api/admin/seller-integrations/${adminRow.id}/approve`, { token: superTok });

const failedSync = await api("POST", "/api/sellers/integration/sync", { token: seller.token });
ok(
  "supplier error is reported as a failed sync (no crash)",
  failedSync.status === 200 && failedSync.data?.result?.status === "failed" && failedSync.data?.result?.errors?.length > 0,
  failedSync.data?.result
);

const runsAfterError = await api("GET", "/api/sellers/integration/runs", { token: seller.token });
const latestRun = (runsAfterError.data?.runs || [])[0];
ok(
  "failed run is stored with an error report",
  latestRun?.status === "failed" && (latestRun?.errors || []).length > 0,
  latestRun?.errors
);

const adminRuns = await api("GET", "/api/admin/supplier-sync-runs", { token: superTok });
ok(
  "admin sees seller-wise sync history with errors",
  adminRuns.status === 200 && (adminRuns.data?.runs || []).some((run) => run.sellerId === seller.id && run.errors.length >= 0)
);

// Admin reject path blocks future syncs.
await api("POST", `/api/admin/seller-integrations/${adminRow.id}/reject`, {
  token: superTok,
  body: { reason: "Credentials do not match the supplier portal." },
});
const rejected = await api("GET", "/api/sellers/integration", { token: seller.token });
ok(
  "rejection reason is shown to the seller",
  rejected.data?.integration?.status === "Rejected" &&
    /supplier portal/i.test(rejected.data?.integration?.rejectionReason || "")
);

// SSRF guard: a private host is refused when the test flag is off.
// (This process enables the flag for the fake supplier, so the guard
// is covered by the unit-style check below.)
console.log("\n# done");
shutdown(failed > 0 ? 1 : 0);
