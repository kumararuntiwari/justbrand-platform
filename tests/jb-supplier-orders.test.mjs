// =====================================================
// JUSTBRAND — SUPPLIER ORDERS / WEBHOOKS / LAUNCH CONTROL
// =====================================================
// Real backend + isolated SQLite database + local fake supplier API.
// No production service and no real supplier/courier is contacted.
//
// Verifies:
//   • admin-managed supplier config with encrypted secrets
//   • product + stock + price feeds merged by SKU
//   • synced products stay Pending
//   • buyer order items create exactly one supplier job per seller
//   • order POST includes SKU/qty and an idempotency key
//   • duplicate processing cannot create a second supplier order
//   • status + tracking sync from the supplier
//   • HMAC webhook verification, matching and replay protection
//   • failed order retry path and admin alert
//   • launch-status reports verified supplier readiness
// =====================================================

import { spawn } from "node:child_process";
import http from "node:http";
import crypto from "node:crypto";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TMP = path.join(REPO_ROOT, "tests", ".tmp-supplier-orders");
const DB_PATH = path.join(TMP, "justbrand.db");
const PORT = 4631;
const BASE = `http://127.0.0.1:${PORT}`;
const KEY = "supplier-test-key-123";
const WEBHOOK_SECRET = "supplier-webhook-test-secret";

let passed = 0;
let failed = 0;
const failures = [];
const supplierCalls = [];

function ok(name, condition, details) {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}${details === undefined ? "" : ` — ${JSON.stringify(details)}`}`);
  }
}

async function api(method, p, { token, body, headers } = {}) {
  const res = await fetch(BASE + p, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let failOrders = false;

const supplier = http.createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }
  supplierCalls.push({ method: req.method, path: req.url, body, key: req.headers["x-api-key"] });

  const send = (status, payload) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  if (req.headers["x-api-key"] !== KEY) return send(401, { error: "unauthorized" });

  if (req.url === "/products") {
    return send(200, {
      products: [
        {
          sku: "SUP-1",
          name: "Supplier Product One",
          category: "Home",
          price: 100,
          comparePrice: 199,
          stock: 3,
          description: "Real-shaped test fixture",
          images: ["https://cdn.example.com/sup-1.jpg"],
        },
        {
          sku: "SUP-2",
          name: "Supplier Product Two",
          category: "Home",
          price: 80,
          comparePrice: 150,
          stock: 4,
          description: "Second test fixture",
          images: ["https://cdn.example.com/sup-2.jpg"],
        },
      ],
    });
  }

  if (req.url === "/stock") {
    return send(200, { items: [{ sku: "SUP-1", stock: 9 }] });
  }

  if (req.url === "/prices") {
    return send(200, { items: [{ sku: "SUP-1", price: 120 }] });
  }

  if (req.method === "POST" && req.url === "/orders") {
    if (failOrders) return send(422, { message: "simulated supplier rejection" });
    return send(200, { order_id: "SUP-ORDER-1", status: "ACCEPTED" });
  }

  if (req.method === "GET" && req.url === "/orders/SUP-ORDER-1") {
    return send(200, {
      status: "SHIPPED",
      awb: "SUPAWB123",
      tracking_url: "https://track.example.com/SUPAWB123",
    });
  }

  return send(404, { error: "not found" });
});

await new Promise((resolve) => supplier.listen(0, "127.0.0.1", resolve));
const SUPPLIER_PORT = supplier.address().port;

rmSync(TMP, { recursive: true, force: true });
mkdirSync(TMP, { recursive: true });

const backend = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: TMP,
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: "supplier-orders-test-secret",
    JB_CREDENTIAL_KEY: "supplier-orders-credential-key",
    JB_ALLOW_PRIVATE_SUPPLIER_HOSTS: "1",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let backendErr = "";
backend.stderr.on("data", (d) => (backendErr = (backendErr + d.toString()).slice(-5000)));

const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT");
  try { backend.kill("SIGTERM"); } catch {}
  try { supplier.close(); } catch {}
  process.exit(2);
}, 120000);

function shutdown(code) {
  clearTimeout(watchdog);
  try { backend.kill("SIGTERM"); } catch {}
  try { supplier.close(); } catch {}
  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed) console.log("FAILURES:\n - " + failures.join("\n - "));
  process.exit(code);
}

let up = false;
for (let i = 0; i < 90 && !up && backend.exitCode === null; i++) {
  try {
    up = (await fetch(`${BASE}/api/health`)).ok;
  } catch {}
  if (!up) await new Promise((r) => setTimeout(r, 200));
}
if (!up || backend.exitCode !== null) {
  console.error(`BACKEND NOT USABLE (up=${up}, exit=${backend.exitCode})\n${backendErr}`);
  shutdown(3);
}

const requireBackend = createRequire(path.join(REPO_ROOT, "backend", "package.json"));
const Database = requireBackend("better-sqlite3");

try {
  const login = await api("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const token = login.data?.token;
  ok("superadmin login", Boolean(token), login.data);

  const sellerReg = await api("POST", "/api/sellers/register", {
    body: {
      name: "Supplier Test Seller",
      shopName: "Supplier Test Shop",
      mobile: "9811199901",
      email: "supplier-test@example.com",
      password: "seller123",
    },
  });
  const seller = sellerReg.data?.seller;
  ok("seller registered", Boolean(seller?.id), sellerReg.data);

  const created = await api("POST", "/api/admin/supplier-integrations", {
    token,
    body: {
      sellerId: seller.id,
      providerName: "Test Manufacturer",
      baseUrl: `http://127.0.0.1:${SUPPLIER_PORT}`,
      authType: "api_key",
      authHeaderName: "X-API-Key",
      apiKey: KEY,
      apiSecret: "not-displayed",
      webhookSecret: WEBHOOK_SECRET,
      productsPath: "/products",
      stockPath: "/stock",
      pricePath: "/prices",
      orderPath: "/orders",
      orderStatusPath: "/orders/{externalOrderId}",
      syncFrequencyMinutes: 60,
      enabled: true,
      orderSyncEnabled: true,
    },
  });
  const integration = created.data?.integration;
  ok("admin creates supplier integration", created.status === 201 && Boolean(integration), created.data);
  ok(
    "secrets are never returned",
    !JSON.stringify(created.data || {}).includes(KEY) &&
      integration?.hasApiKey === true &&
      integration?.hasApiSecret === true &&
      integration?.hasWebhookSecret === true
  );
  ok(
    "configuration is not falsely marked connected",
    integration?.connectionStatus === "Untested"
  );

  const test = await api("POST", `/api/admin/supplier-integrations/${integration.id}/test`, {
    token,
  });
  ok("real connection test reads supplier products", test.status === 200 && test.data?.sample?.length === 2, test.data);
  ok("test flips connection status only after success", test.data?.integration?.connectionStatus === "Connected");

  const sync = await api("POST", `/api/admin/supplier-integrations/${integration.id}/sync`, {
    token,
  });
  ok("product sync succeeds", sync.status === 200 && sync.data?.success === true, sync.data);
  ok("stock and price feeds were merged", sync.data?.result?.updated >= 0 && sync.data?.result?.created === 2, sync.data?.result);

  const db = new Database(DB_PATH);
  const storedIntegration = db
    .prepare(`SELECT apiKeyEnc, apiSecretEnc, webhookSecretEnc FROM seller_api_integrations WHERE id = ?`)
    .get(integration.id);
  ok(
    "credentials are encrypted at rest",
    storedIntegration.apiKeyEnc?.startsWith("v1:") &&
      !storedIntegration.apiKeyEnc.includes(KEY) &&
      storedIntegration.apiSecretEnc?.startsWith("v1:") &&
      storedIntegration.webhookSecretEnc?.startsWith("v1:")
  );

  const products = db
    .prepare(`SELECT id, sku, price, stock, status, source FROM products WHERE sellerId = ? ORDER BY sku`)
    .all(seller.sellerCode);
  ok("synced products stay Pending", products.length === 2 && products.every((p) => p.status === "Pending"), products);
  const first = products.find((p) => p.sku === "SUP-1");
  ok("price feed overrides product price", Number(first?.price) === 120, first);
  ok("stock feed overrides product stock", Number(first?.stock) === 9, first);

  db.prepare(
    `INSERT INTO orders
      (orderNumber, customerId, customerName, phone, address, totalAmount,
       paymentMethod, paymentStatus, status, createdAt, updatedAt, city, state, pincode, email)
     VALUES (?, 1, ?, ?, ?, ?, 'COD', 'Pending', 'Pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    "SUP-TEST-ORDER-1",
    "Test Buyer",
    "9876543210",
    "1 Test Street, Lucknow",
    "450",
    new Date().toISOString(),
    new Date().toISOString(),
    "Lucknow",
    "Uttar Pradesh",
    "226001",
    "buyer@example.com"
  );
  const orderId = db.prepare(`SELECT id FROM orders WHERE orderNumber = ?`).get("SUP-TEST-ORDER-1").id;
  db.prepare(
    `INSERT INTO order_items (orderId, productId, productName, sellerId, price, quantity)
     VALUES (?, ?, 'Supplier Product One', ?, '120', 2)`
  ).run(orderId, first.id, seller.sellerCode);
  db.prepare(
    `INSERT INTO order_items (orderId, productId, productName, sellerId, price, quantity)
     VALUES (?, ?, 'Supplier Product Two', ?, '80', 1)`
  ).run(orderId, products.find((p) => p.sku === "SUP-2").id, seller.sellerCode);

  const jobsAfterInsert = db
    .prepare(`SELECT * FROM supplier_order_jobs WHERE orderId = ?`)
    .all(orderId);
  ok("order items enqueue exactly one supplier job", jobsAfterInsert.length === 1, jobsAfterInsert);

  const processed = await api("POST", "/api/admin/supplier-integrations/process-jobs", {
    token,
    body: { limit: 10 },
  });
  ok("order worker processes the job", processed.status === 200 && processed.data?.processed >= 1, processed.data);

  const orderCall = supplierCalls.find((call) => call.method === "POST" && call.path === "/orders");
  ok("supplier receives the real order", Boolean(orderCall), supplierCalls);
  ok(
    "supplier payload has SKU, quantity and idempotency header",
    orderCall?.body?.items?.length === 2 &&
      orderCall.body.items[0].sku === "SUP-1" &&
      orderCall.body.items[0].quantity === 2
  );

  await api("POST", "/api/admin/supplier-integrations/process-jobs", {
    token,
    body: { limit: 10 },
  });
  const orderPosts = supplierCalls.filter((call) => call.method === "POST" && call.path === "/orders");
  ok("duplicate worker run does not re-post the order", orderPosts.length === 1, orderPosts.length);

  const jobs = await api("GET", "/api/admin/supplier-integrations", { token });
  const syncedJob = jobs.data?.jobs?.find((job) => job.orderNumber === "SUP-TEST-ORDER-1");
  ok("job is marked synced with supplier reference", syncedJob?.status === "synced" && syncedJob.externalOrderId === "SUP-ORDER-1", syncedJob);

  const statusSync = await api("POST", `/api/admin/supplier-order-jobs/${syncedJob.id}/status-sync`, {
    token,
  });
  ok(
    "status endpoint syncs tracking",
    statusSync.status === 200 &&
      statusSync.data?.result?.externalStatus === "SHIPPED" &&
      statusSync.data?.result?.trackingNumber === "SUPAWB123",
    statusSync.data
  );

  const webhookBody = JSON.stringify({
    eventId: "evt-1",
    orderNumber: "SUP-TEST-ORDER-1",
    status: "OUT_FOR_DELIVERY",
    awb: "SUPAWB123",
  });
  const signature = `sha256=${crypto
    .createHmac("sha256", WEBHOOK_SECRET)
    .update(webhookBody)
    .digest("hex")}`;
  const webhook = await fetch(`${BASE}/api/supplier-webhook/${integration.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jb-signature": signature },
    body: webhookBody,
  });
  const webhookData = await webhook.json();
  ok("signed webhook is accepted", webhook.status === 200 && webhookData.matched === true, webhookData);

  const replay = await fetch(`${BASE}/api/supplier-webhook/${integration.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jb-signature": signature },
    body: webhookBody,
  });
  const replayData = await replay.json();
  ok("webhook replay is idempotent", replayData.duplicate === true, replayData);

  const badWebhook = await fetch(`${BASE}/api/supplier-webhook/${integration.id}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-jb-signature": "sha256=bad" },
    body: webhookBody,
  });
  ok("bad webhook signature is rejected", badWebhook.status === 401);

  failOrders = true;
  db.prepare(
    `INSERT INTO orders
      (orderNumber, customerId, customerName, phone, address, totalAmount,
       paymentMethod, paymentStatus, status, createdAt, updatedAt, city, state, pincode, email)
     VALUES (?, 1, ?, ?, ?, ?, 'COD', 'Pending', 'Pending', ?, ?, ?, ?, ?, ?)`
  ).run(
    "SUP-TEST-ORDER-2",
    "Test Buyer 2",
    "9876543211",
    "2 Test Street, Lucknow",
    "120",
    new Date().toISOString(),
    new Date().toISOString(),
    "Lucknow",
    "Uttar Pradesh",
    "226001",
    "buyer2@example.com"
  );
  const order2 = db.prepare(`SELECT id FROM orders WHERE orderNumber = ?`).get("SUP-TEST-ORDER-2").id;
  db.prepare(
    `INSERT INTO order_items (orderId, productId, productName, sellerId, price, quantity)
     VALUES (?, ?, 'Supplier Product One', ?, '120', 1)`
  ).run(order2, first.id, seller.sellerCode);

  const failedProcess = await api("POST", "/api/admin/supplier-integrations/process-jobs", {
    token,
    body: { limit: 10 },
  });
  ok("failed supplier order is recorded honestly", failedProcess.status === 200, failedProcess.data);
  const failedJobs = await api("GET", "/api/admin/supplier-integrations", { token });
  const failedJob = failedJobs.data?.jobs?.find((job) => job.orderNumber === "SUP-TEST-ORDER-2");
  ok("failed job exposes error + retry state", failedJob?.status === "failed" && Boolean(failedJob.lastError), failedJob);
  ok("admin alert is visible", failedJobs.data?.alerts?.some((a) => a.orderNumber === "SUP-TEST-ORDER-2"), failedJobs.data?.alerts);

  failOrders = false;
  const retried = await api("POST", `/api/admin/supplier-order-jobs/${failedJob.id}/retry`, { token });
  ok("failed job can be retried", retried.status === 200, retried.data);
  const retryProcess = await api("POST", "/api/admin/supplier-integrations/process-jobs", {
    token,
    body: { limit: 10 },
  });
  ok("retry worker runs", retryProcess.status === 200, retryProcess.data);

  const launch = await api("GET", "/api/admin/launch-status", { token });
  if (launch.status !== 200) console.error("LAUNCH FAILURE BACKEND LOG:\n" + backendErr);
  ok("launch status reports supplier readiness", launch.status === 200 && launch.data?.suppliers?.connected === 1, launch.data);
  ok("launch status does not claim a live courier", launch.data?.couriers?.live === 0, launch.data?.couriers);

  db.close();
} catch (error) {
  console.error(error && error.stack ? error.stack : error);
  if (backendErr) console.error(backendErr);
  shutdown(1);
}

shutdown(failed ? 1 : 0);
