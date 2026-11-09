// =====================================================
// JUSTBRAND — LIMITED STOCK TRACKING TEST SUITE
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  node --test tests/jb-stock.test.mjs   (from repo root)
//
// Covers (business rules from the stock-tracking task):
//   - Seller stock input: blank = untracked (unlimited); negative,
//     fractional and non-numeric quantities are REJECTED on add AND
//     edit; edits persist the new value.
//   - Admin-approval visibility stays intact: stock edits resubmit
//     the product to Pending and it disappears from the Buyer feed
//     until re-approved.
//   - mapPublicProduct exposes `stock` + derived `inStock`.
//   - Order creation: atomic guarded decrement (stock >= qty) inside
//     the order transaction — sufficient stock decrements exactly,
//     insufficient stock rejects with OUT_OF_STOCK and leaves stock
//     unchanged (failed order never reduces stock).
//   - Concurrency: N parallel orders for a limited quantity can never
//     oversell — successes + failures partition the stock exactly and
//     the final stock is never negative.
//   - Untracked products (stock NULL) keep the old unlimited flow.
//   - Customer cancel (verified pre-shipping rule) restores stock
//     exactly once; a second cancel is blocked; orders that never
//     deducted stock (stockDeducted = 0) never inflate inventory.
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp-stock/ (isolated)
//   - Never touches justbrand.db at the repository root or production
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-stock");

const PORT = Number(process.env.JB_STOCK_TEST_PORT) || 4593;
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
    /* non-JSON response */
  }
  return { status: res.status, data };
}

let server = null;

async function startServer() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  server = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: TMP_DIR, // justbrand.db is created HERE, isolated from production
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      // Deterministic test secret — never the production secret.
      JWT_SECRET: "jb-stock-test-secret-local-only",
    },
  });

  let stderrTail = "";
  server.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  server.stdout.on("data", () => {});

  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE}/`);
      if (res.ok) return { ready: true, getStderr: () => stderrTail };
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ready: false, getStderr: () => stderrTail };
}

// -----------------------------------------------------
// Helpers
// -----------------------------------------------------

async function registerSeller(overrides = {}) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const body = {
    name: `Stock Seller ${stamp}`,
    shopName: `Stock Shop ${stamp}`,
    mobile: String(9876500000 + (stamp % 99999)),
    email: `stock.seller.${stamp}@example.com`,
    password: "Stock@12345",
    ...overrides,
  };
  const reg = await req("POST", "/api/sellers/register", { body });
  const login = await req("POST", "/api/sellers/login", {
    body: { email: body.email, password: body.password },
  });
  const staffToken = await adminLogin();
  const taxReady = await onboardGstSeller(req, {
    sellerToken: login.data?.token,
    staffToken,
  });
  ok("seller KYC + PAN + GST approved", taxReady.ok, JSON.stringify(taxReady.response));
  return { token: login.data?.token, sellerId: reg.data?.seller?.id, body };
}

async function adminLogin() {
  const login = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  return login.data?.token;
}

async function registerCustomer() {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const mobile = String(9876510000 + (stamp % 89999));
  const reg = await req("POST", "/api/customers/register", {
    body: { name: `Stock Customer ${stamp}`, mobile, password: "Cust@12345" },
  });
  return { token: reg.data?.token, mobile };
}

async function addProduct(sellerToken, overrides = {}) {
  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  return req("POST", "/api/sellers/products", {
    token: sellerToken,
    body: {
      name: `Stock Product ${stamp}`,
      category: "Electronics",
      price: "₹999",
      hsnCode: "8517",
      gstRate: 18,
      image: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
      description: "Stock test product",
      shortDetails: "Stock test",
      ...overrides,
    },
  });
}

async function approveProduct(adminToken, productId) {
  return req("PUT", `/api/admin/products/${productId}/approve`, { token: adminToken });
}

async function publicProduct(productId) {
  return req("GET", `/api/products/${productId}`);
}

async function placeOrder(customerToken, items, extra = {}) {
  return req("POST", "/api/orders", {
    token: customerToken,
    body: {
      items,
      address: "12, Stock Test Lane, Verification Nagar",
      city: "Indore",
      state: "Madhya Pradesh",
      pincode: "452001",
      phone: "9876543210",
      paymentMethod: "COD",
      ...extra,
    },
  });
}

// -----------------------------------------------------
// The flow
// -----------------------------------------------------

async function runFlow() {
  const { ready, getStderr } = await startServer();
  if (!ready) {
    console.error("Backend failed to start:\n" + getStderr());
    process.exit(1);
  }

  const admin = await adminLogin();
  ok("admin login (seeded superadmin)", Boolean(admin));

  const { token: seller, sellerId } = await registerSeller();
  ok("seller register + login", Boolean(seller));

  // The product-submission endpoint enforces the seller-KYC gate
  // (KYC_REQUIRED) — approve it first, same as the real flow.
  const kycApprove = await req("PUT", `/api/admin/sellers/${sellerId}/kyc`, {
    token: admin,
    body: { kycStatus: "Approved" },
  });
  ok("admin approves seller KYC (pre product-add)", kycApprove.status === 200, kycApprove.data);

  const { token: customer } = await registerCustomer();
  ok("customer register + login", Boolean(customer));

  // ===== 1. SELLER STOCK INPUT VALIDATION =====
  console.log("\n— Seller stock input validation");
  const negAdd = await addProduct(seller, { stock: -5 });
  ok("add with negative stock rejected (400)", negAdd.status === 400, negAdd.data);
  const fracAdd = await addProduct(seller, { stock: 2.5 });
  ok("add with fractional stock rejected (400)", fracAdd.status === 400, fracAdd.data);
  const textAdd = await addProduct(seller, { stock: "abc" });
  ok("add with non-numeric stock rejected (400)", textAdd.status === 400, textAdd.data);

  const png =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
  const addTracked = await addProduct(seller, { stock: 5, images: [png, png] });
  ok("add with stock 5 accepted (201)", addTracked.status === 201, addTracked.data);
  const trackedId = addTracked.data?.product?.id;
  ok("product row carries stock = 5", Number(addTracked.data?.product?.stock) === 5);
  ok("multi-image product saves both images",
    addTracked.data?.product?.images?.length === 2, addTracked.data?.product?.images);

  const addUntracked = await addProduct(seller, { stock: null });
  ok("add with blank/NULL stock accepted (201)", addUntracked.status === 201, addUntracked.data);
  const untrackedId = addUntracked.data?.product?.id;
  ok("blank stock stored as NULL (untracked)",
    addUntracked.data?.product?.stock === null || addUntracked.data?.product?.stock === undefined,
    addUntracked.data?.product?.stock);

  // ===== 2. ADMIN APPROVAL + BUYER VISIBILITY =====
  console.log("\n— Admin approval + Buyer visibility");
  const approveTracked = await approveProduct(admin, trackedId);
  ok("admin approves tracked product", approveTracked.status === 200 || approveTracked.data?.success === true, approveTracked.data);
  const approveUntracked = await approveProduct(admin, untrackedId);
  ok("admin approves untracked product", approveUntracked.status === 200 || approveUntracked.data?.success === true, approveUntracked.data);

  const pubTracked = await publicProduct(trackedId);
  ok("approved tracked product visible to Buyer", pubTracked.status === 200 && pubTracked.data?.id === trackedId, pubTracked.data);
  ok("public payload exposes stock = 5", Number(pubTracked.data?.stock) === 5);
  ok("public payload exposes inStock = true", pubTracked.data?.inStock === true);

  // ===== 3. SELLER EDIT: stock persists + goes back to Pending =====
  console.log("\n— Seller stock edit");
  const editNeg = await req("PUT", `/api/sellers/products/${trackedId}`, {
    token: seller,
    body: { stock: -1 },
  });
  ok("edit with negative stock rejected (400)", editNeg.status === 400, editNeg.data);

  const editTracked = await req("PUT", `/api/sellers/products/${trackedId}`, {
    token: seller,
    body: { stock: 7 },
  });
  ok("edit stock 5 → 7 accepted", editTracked.status === 200 && editTracked.data?.success === true, editTracked.data);
  ok("edited product carries stock = 7", Number(editTracked.data?.product?.stock) === 7);
  ok("edit without image fields preserves the whole gallery",
    editTracked.data?.product?.images?.length === 2, editTracked.data?.product?.images);
  ok("edited product resubmitted to Pending (business rule 1)",
    editTracked.data?.product?.status === "Pending", editTracked.data?.product?.status);

  // Admin rejection must carry the reason back to the seller.
  const rejectable = await addProduct(seller, { stock: 1 });
  const rejectRes = await req("PUT", `/api/admin/products/${rejectable.data?.product?.id}/reject`, {
    token: admin,
    body: { reason: "TEST: image quality too low" },
  });
  ok("admin reject stores rejection reason",
    rejectRes.status === 200 && rejectRes.data?.product?.rejectionReason === "TEST: image quality too low",
    rejectRes.data);
  const sellerCatalog = await req("GET", "/api/sellers/products", { token: seller });
  const rejectedRow = (sellerCatalog.data?.products || sellerCatalog.data || []).find(
    (p) => p.id === rejectable.data?.product?.id
  );
  ok("seller sees Rejected status + admin reason",
    rejectedRow?.status === "Rejected" && rejectedRow?.rejectionReason === "TEST: image quality too low",
    rejectedRow);

  const hiddenWhilePending = await publicProduct(trackedId);
  ok("Pending (edited) product hidden from Buyer feed",
    hiddenWhilePending.status === 404 || hiddenWhilePending.data?.id !== trackedId,
    { status: hiddenWhilePending.status, id: hiddenWhilePending.data?.id });

  await approveProduct(admin, trackedId); // re-approve for the order tests

  // ===== 4. ORDER: ATOMIC DECREMENT + ROLLBACK =====
  console.log("\n— Order creation with stock");
  const orderInsufficient = await placeOrder(customer, [{ productId: trackedId, quantity: 9 }]);
  ok("order qty 9 > stock 7 rejected (400/409 OUT_OF_STOCK)",
    (orderInsufficient.status === 400 || orderInsufficient.status === 409) &&
      orderInsufficient.data?.code === "OUT_OF_STOCK",
    { status: orderInsufficient.status, data: orderInsufficient.data });

  let check = await publicProduct(trackedId);
  ok("failed order leaves stock unchanged (still 7)", Number(check.data?.stock) === 7, check.data?.stock);

  const orderOk = await placeOrder(customer, [{ productId: trackedId, quantity: 2 }]);
  ok("order qty 2 ≤ stock 7 succeeds (201)", orderOk.status === 201 && orderOk.data?.success === true, orderOk.data);
  check = await publicProduct(trackedId);
  ok("stock decremented exactly 7 → 5", Number(check.data?.stock) === 5, check.data?.stock);
  ok("inStock still true at 5", check.data?.inStock === true);

  // Price-mismatch failed order must NOT reduce stock either.
  const mismatch = await placeOrder(customer, [{ productId: trackedId, quantity: 1 }], {
    clientGrandTotal: 1,
  });
  ok("PRICE_MISMATCH order rejected", mismatch.data?.code === "PRICE_MISMATCH" || mismatch.status === 400, mismatch.data);
  check = await publicProduct(trackedId);
  ok("PRICE_MISMATCH failure leaves stock unchanged (still 5)", Number(check.data?.stock) === 5, check.data?.stock);

  // ===== 5. CONCURRENCY: parallel orders can never oversell =====
  console.log("\n— Concurrency race (5 stock, 12 parallel orders of qty 1)");
  // stock is 5 now; race 12 parallel single-unit orders at it.
  const raceResults = await Promise.all(
    Array.from({ length: 12 }, () => placeOrder(customer, [{ productId: trackedId, quantity: 1 }]))
  );
  const raceSuccess = raceResults.filter((r) => r.status === 201).length;
  const raceRejected = raceResults.filter((r) => r.data?.code === "OUT_OF_STOCK").length;
  ok("exactly 5 parallel orders succeed (no oversell)", raceSuccess === 5, { raceSuccess });
  ok("exactly 7 parallel orders rejected OUT_OF_STOCK", raceRejected === 7, { raceRejected });
  check = await publicProduct(trackedId);
  ok("final stock is 0", Number(check.data?.stock) === 0, check.data?.stock);
  ok("inStock false at 0", check.data?.inStock === false);

  const orderZero = await placeOrder(customer, [{ productId: trackedId, quantity: 1 }]);
  ok("order on out-of-stock product rejected",
    (orderZero.status === 400 || orderZero.status === 409) && orderZero.data?.code === "OUT_OF_STOCK",
    orderZero.data);

  // ===== 6. UNTRACKED PRODUCT: unlimited flow preserved =====
  console.log("\n— Untracked (NULL stock) product flow");
  const untrackedOrder = await placeOrder(customer, [{ productId: untrackedId, quantity: 10 }]);
  ok("untracked product order of qty 10 succeeds (old behaviour)", untrackedOrder.status === 201, untrackedOrder.data);
  check = await publicProduct(untrackedId);
  ok("untracked product stock stays NULL after order", check.data?.stock === null || check.data?.stock === undefined);
  ok("untracked product inStock stays true", check.data?.inStock === true);

  // ===== 7. CANCEL: verified-rule restore, exactly once =====
  console.log("\n— Customer cancel restores stock (pre-shipping rule)");
  const cancelableId = orderOk.data?.order?.id;
  const cancelRes = await req("PUT", `/api/customer/orders/${cancelableId}/cancel`, { token: customer });
  ok("customer cancels own Pending/Processing order (200)", cancelRes.status === 200 && cancelRes.data?.success === true, cancelRes.data);
  check = await publicProduct(trackedId);
  ok("cancelled order restores stock 0 → 2", Number(check.data?.stock) === 2, check.data?.stock);

  const cancelAgain = await req("PUT", `/api/customer/orders/${cancelableId}/cancel`, { token: customer });
  ok("second cancel blocked (400) — no double restore", cancelAgain.status === 400, cancelAgain.data);
  check = await publicProduct(trackedId);
  ok("stock unchanged after blocked second cancel (still 2)", Number(check.data?.stock) === 2, check.data?.stock);

  // Order that never deducted stock (untracked product) must not
  // inflate inventory when cancelled.
  const untrackedOrderId = untrackedOrder.data?.order?.id;
  const cancelUntracked = await req("PUT", `/api/customer/orders/${untrackedOrderId}/cancel`, { token: customer });
  ok("cancel of untracked-stock order succeeds (200)", cancelUntracked.status === 200, cancelUntracked.data);
  check = await publicProduct(untrackedId);
  ok("untracked product stock still NULL after cancel (no inflation)",
    check.data?.stock === null || check.data?.stock === undefined, check.data?.stock);

  // ===== SUMMARY =====
  console.log(`\nSTOCK SUITE: ${passed} passed, ${failed} failed`);
  if (failed > 0) {
    console.log("Failures:\n - " + failures.join("\n - "));
  }
}

try {
  await runFlow();
} finally {
  if (server) {
    try {
      server.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  }
}

process.exit(failed > 0 ? 1 : 0);
