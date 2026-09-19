// =====================================================
// JUSTBRAND — END-TO-END FLOW TEST SUITE
// =====================================================
// Zero-dependency Node test suite (Node 18+, built-ins only).
// Run with:  npm test   (from the repository root)
//
// Covers the business-critical chain:
//   seller register → seller login → add product → admin approve
//   → buyer visibility → customer order → order delivered
//   → commissions generated → order cancelled → commissions voided
//
// Also verifies:
//   - Auth isolation (seller vs staff vs customer/member tokens)
//   - Anonymous product submission is rejected (legacy + current route)
//   - Cross-seller product tampering is blocked
//   - Rejected / re-edited products never leak to buyers
//   - Public product data never leaks seller KYC/bank fields
//
// Safety:
//   - Spawns the REAL backend (backend/server.js) on an isolated port
//   - Uses a THROWAWAY SQLite database in tests/.tmp/ (gitignored)
//   - Never touches justbrand.db at the repository root or production
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp");

const PORT = Number(process.env.JB_TEST_PORT) || 4591;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond) {
  if (cond) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failed++;
    failures.push(name);
    console.log(`  ✗ FAIL: ${name}`);
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

function publicArray(payload) {
  return Array.isArray(payload) ? payload : payload?.products || [];
}

// -----------------------------------------------------
// Start the real backend against a throwaway database
// -----------------------------------------------------

async function startServer() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const server = spawn(
    process.execPath,
    [BACKEND_ENTRY],
    {
      cwd: TMP_DIR, // justbrand.db is created HERE, isolated from production
      stdio: ["ignore", "pipe", "pipe"],
      env: {
        ...process.env,
        PORT: String(PORT),
        // Deterministic test secret — never the production secret.
        JWT_SECRET: "jb-flow-test-secret-local-only",
      },
    }
  );

  let stderrTail = "";
  server.stderr.on("data", (d) => {
    stderrTail = (stderrTail + d.toString()).slice(-4000);
  });
  server.stdout.on("data", () => {});

  // Wait for readiness by polling the health endpoint (no fixed sleep).
  const deadline = Date.now() + 15000;
  let ready = false;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + "/");
      if (res.ok) {
        ready = true;
        break;
      }
    } catch {
      /* server not up yet */
    }
    await new Promise((r) => setTimeout(r, 200));
  }

  return { server, ready, getStderr: () => stderrTail };
}

// -----------------------------------------------------
// The flow
// -----------------------------------------------------

async function runFlow() {
  // ===== 1. SELLER: register, login =====
  console.log("\n— Seller registration & login");
  const reg = await req("POST", "/api/sellers/register", {
    body: {
      name: "Flow Seller",
      shopName: "Flow Shop",
      mobile: "9876511111",
      email: "flow@x.com",
      password: "seller123",
    },
  });
  ok("seller register accepted", reg.status === 201);

  const sLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876511111", password: "seller123" },
  });
  ok("seller login returns token", sLogin.status === 200 && Boolean(sLogin.data.token));
  const seller = sLogin.data.token;

  // The product-submission endpoint enforces the seller-KYC gate
  // (KYC_REQUIRED) — verify it blocks before approval, same as the real
  // admin flow and the remote product-add contract.
  const earlyProductAttempt = await req("POST", "/api/sellers/products", {
    token: seller,
    body: { name: "Too Early", category: "Test", price: "₹10" },
  });
  ok(
    "product submission blocked before KYC approval (403 KYC_REQUIRED)",
    earlyProductAttempt.status === 403 && earlyProductAttempt.data?.code === "KYC_REQUIRED"
  );

  // ===== 2. AUTH ISOLATION =====
  console.log("\n— Auth isolation");
  const sellerOnAdmin = await req("GET", "/api/admin/products", { token: seller });
  ok("seller token blocked from admin routes", sellerOnAdmin.status === 403);

  const aLoginEarly = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const staff = aLoginEarly.data?.token;
  ok("staff login returns token", aLoginEarly.status === 200 && Boolean(staff));

  const staffOnSeller = await req("GET", "/api/sellers/me", { token: staff });
  ok("staff token blocked from seller routes", staffOnSeller.status === 403);

  // Approve the flow seller's KYC (required for product submission).
  const flowSellerIdEarly = reg.data.seller?.id;
  const kycApproveEarly = await req("PUT", `/api/admin/sellers/${flowSellerIdEarly}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  ok("admin approves flow seller KYC (pre product-add)", kycApproveEarly.status === 200);

  // ===== 3. SELLER: add products =====
  console.log("\n— Seller product submission");
  const pWeb = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: "Web Image Product",
      category: "Electronics",
      price: "₹1299",
      image: "https://cdn.example.com/pic.jpg",
      shortDetails: "Has absolute URL image",
    },
  });
  ok("seller adds product (web image)", pWeb.status === 201);
  ok("new product starts Pending", pWeb.data.product?.status === "Pending");
  const webId = pWeb.data.product?.id;

  const pB64 = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: "Base64 Product",
      category: "Fashion",
      price: "₹499",
      image: "data:image/png;base64,iVBORw0KGgo=",
      shortDetails: "Has base64 image",
    },
  });
  ok("seller adds product (base64 image)", pB64.status === 201);
  const b64Id = pB64.data.product?.id;

  const mine = await req("GET", "/api/sellers/products", { token: seller });
  ok("seller sees own 2 products", mine.data.products?.length === 2);

  // ===== 4. ANONYMOUS / UNAUTHORIZED SUBMISSION MUST FAIL =====
  console.log("\n— Unauthorized submission protection");
  const anonAdd = await req("POST", "/api/sellers/products", {
    body: { name: "Sneaky", price: "₹1" },
  });
  ok("anonymous submission rejected on /api/sellers/products", anonAdd.status === 401);

  const anonLegacy = await req("POST", "/api/products", {
    body: { name: "Sneaky Legacy", price: "₹1" },
  });
  ok("anonymous submission rejected on legacy POST /api/products", anonLegacy.status === 401);

  // ===== 5. BUYER (before approval): must see nothing =====
  console.log("\n— Buyer visibility (pre-approval)");
  let pub = await req("GET", "/api/products");
  let pubArr = publicArray(pub.data);
  ok("buyer sees NO unapproved products", !pubArr.some((p) => [webId, b64Id].includes(p.id)));

  // ===== 6. ADMIN: see pending, approve one, reject other =====
  console.log("\n— Admin approval flow");
  const adminList = await req("GET", "/api/admin/products", { token: staff });
  const pending = (adminList.data.products || []).filter((p) => p.status === "Pending");
  ok("admin sees 2 pending products", pending.length === 2);
  ok(
    "admin view shows seller identity",
    pending.every((p) => p.sellerName === "Flow Seller" || p.sellerId)
  );

  // The approve endpoint enforces the seller-KYC gate (SELLER_KYC_REQUIRED),
  // so approve the flow seller's KYC first — same as the real admin flow.
  const flowSellerId = reg.data.seller?.id;
  const kycApprove = await req("PUT", `/api/admin/sellers/${flowSellerId}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  ok("admin approves flow seller KYC", kycApprove.status === 200);

  const apWeb = await req("PUT", `/api/admin/products/${webId}/approve`, { token: staff });
  ok("admin approves product", apWeb.status === 200);
  const apRej = await req("PUT", `/api/admin/products/${b64Id}/reject`, { token: staff });
  ok("admin rejects product", apRej.status === 200);

  // ===== 7. BUYER (after approval): sees only approved =====
  console.log("\n— Buyer visibility (post-approval)");
  pub = await req("GET", "/api/products");
  pubArr = publicArray(pub.data);
  const webProd = pubArr.find((p) => p.id === webId);
  const rejProd = pubArr.find((p) => p.id === b64Id);
  ok("buyer sees approved product", Boolean(webProd));
  ok("rejected product stays hidden", !rejProd);

  // ===== 8. SELLER EDIT resets approval (no bypass) =====
  console.log("\n— Edit resets approval");
  const edit = await req("PUT", `/api/sellers/products/${webId}`, {
    token: seller,
    body: { shortDetails: "edited detail" },
  });
  ok("seller edits own product", edit.status === 200);
  ok("edit resets status to Pending", edit.data.product?.status === "Pending");

  pub = await req("GET", "/api/products");
  const pubArr3 = publicArray(pub.data);
  ok("edited product hidden from buyers until re-approval", !pubArr3.some((p) => p.id === webId));

  const reApprove = await req("PUT", `/api/admin/products/${webId}/approve`, { token: staff });
  ok("admin re-approves", reApprove.status === 200);

  // ===== 9. CROSS-SELLER PROTECTION =====
  console.log("\n— Cross-seller protection");
  await req("POST", "/api/sellers/register", {
    body: {
      name: "Rival F",
      shopName: "Rival F Shop",
      mobile: "9876522222",
      email: "rivalf@x.com",
      password: "seller456",
    },
  });
  const rLogin = await req("POST", "/api/sellers/login", {
    body: { mobile: "9876522222", password: "seller456" },
  });
  const rival = rLogin.data.token;
  const steal = await req("PUT", `/api/sellers/products/${webId}`, {
    token: rival,
    body: { name: "Stolen" },
  });
  ok("cross-seller edit blocked", steal.status === 403 || steal.status === 404);
  const stealDel = await req("DELETE", `/api/sellers/products/${webId}`, { token: rival });
  ok("cross-seller delete blocked", stealDel.status === 403 || stealDel.status === 404);

  // ===== 10. PRIVACY: no KYC/bank leak in public products =====
  console.log("\n— Public data privacy");
  const kycJson = JSON.stringify(pubArr3);
  ok(
    "no KYC/bank fields in public products",
    !/panNumber|aadhaar|accountNumber|ifsc/i.test(kycJson)
  );

  // ===== 11. LEGACY /api/products still works for authenticated STAFF =====
  console.log("\n— Legacy endpoint (authenticated staff path preserved)");
  const staffLegacyAdd = await req("POST", "/api/products", {
    token: staff,
    body: { name: "Staff Legacy Product", price: "₹99", sellerId: "SELLER-legacy", sellerName: "Legacy" },
  });
  ok("authenticated staff can still submit via legacy endpoint", staffLegacyAdd.status === 200);

  // ===== 12. MLM + CUSTOMER: register → order → commission → void =====
  console.log("\n— MLM / commission flow");
  const mRoot = await req("POST", "/api/mlm/register", {
    body: { name: "Root Member", mobile: "9000000001", email: "root@x.com", password: "member123" },
  });
  ok("MLM root member registered", mRoot.status === 201 && Boolean(mRoot.data.member?.memberId));
  const rootId = mRoot.data.member?.memberId;

  const mChild = await req("POST", "/api/mlm/register", {
    body: {
      name: "Child Member",
      mobile: "9000000002",
      email: "child@x.com",
      password: "member123",
      referralCode: rootId,
    },
  });
  ok("MLM child member registered under root", mChild.status === 201);

  const cust = await req("POST", "/api/customers/register", {
    body: {
      name: "Flow Customer",
      mobile: "9000000003",
      email: "cust@x.com",
      password: "cust1234",
      referralCode: rootId,
    },
  });
  ok("customer registered with referral", cust.status === 201);

  const cLogin = await req("POST", "/api/customers/login", {
    body: { mobile: "9000000003", password: "cust1234" },
  });
  const customer = cLogin.data.token;
  ok("customer login returns token", cLogin.status === 200 && Boolean(customer));

  // Order: shipping phone = child member's mobile → child earns shopping
  // commission, root earns direct commission (backend-priced total).
  const order = await req("POST", "/api/orders", {
    token: customer,
    body: {
      items: [{ productId: webId, quantity: 1, price: "₹1" }],
      address: "123 Test Street, Test Nagar, India",
      phone: "9000000002",
      paymentMethod: "COD",
    },
  });
  ok("customer places order on approved product", order.status === 201);
  ok(
    "order total comes from backend pricing (base+platform+mlm+delivery)",
    Number(order.data.order?.totalAmount) === 1442.92
  );
  const orderId = order.data.order?.id;

  const delivered = await req("PUT", `/api/admin/orders/${orderId}/status`, {
    token: staff,
    body: { status: "Delivered" },
  });
  ok("admin marks order Delivered", delivered.status === 200);

  const rootWallet = await req("GET", "/api/mlm/wallet", { token: mRoot.data.token });
  ok(
    "root member has pending commission after delivery",
    Number(rootWallet.data.wallet?.pending) > 0
  );

  const childWallet = await req("GET", "/api/mlm/wallet", { token: mChild.data.token });
  ok(
    "child member has pending shopping commission after delivery",
    Number(childWallet.data.wallet?.pending) > 0
  );

  // Cancel the delivered order → all Pending commissions must be voided.
  const cancelled = await req("PUT", `/api/admin/orders/${orderId}/status`, {
    token: staff,
    body: { status: "Cancelled" },
  });
  ok("admin cancels order", cancelled.status === 200);

  const rootCommissions = await req("GET", "/api/mlm/commissions", { token: mRoot.data.token });
  ok(
    "all root member commissions voided after cancellation",
    (rootCommissions.data.commissions || []).every((c) => c.status === "Void")
  );
  const rootWalletAfter = await req("GET", "/api/mlm/wallet", { token: mRoot.data.token });
  ok("root wallet pending drops to 0 after cancellation", Number(rootWalletAfter.data.wallet?.pending) === 0);

  // ===== 13. CUSTOMER PROFILE (own only) =====
  console.log("\n— Customer profile management");
  const profileUpdate = await req("PUT", "/api/customers/me", {
    token: customer,
    body: {
      name: "Flow Customer Updated",
      email: "updated@x.com",
      address: "456 New Street, Test Nagar",
      city: "TestCity",
      state: "TestState",
      pincode: "110001",
    },
  });
  ok("customer updates own profile", profileUpdate.status === 200);
  ok(
    "profile update persists name and address",
    profileUpdate.data.customer?.name === "Flow Customer Updated" &&
      profileUpdate.data.customer?.city === "TestCity"
  );

  const badPin = await req("PUT", "/api/customers/me", {
    token: customer,
    body: { pincode: "12" },
  });
  ok("invalid PIN code rejected", badPin.status === 400);

  // Customer A must not be able to reach customer B's orders — a second
  // customer is registered and both lists stay isolated.
  const cust2 = await req("POST", "/api/customers/register", {
    body: {
      name: "Other Customer",
      mobile: "9000000009",
      email: "other@x.com",
      password: "cust9999",
    },
  });
  const c2Login = await req("POST", "/api/customers/login", {
    body: { mobile: "9000000009", password: "cust9999" },
  });
  const otherOrders = await req("GET", "/api/customer/orders", {
    token: c2Login.data.token,
  });
  ok(
    "customer isolation: other customer sees no orders",
    (otherOrders.data.orders || []).every((o) => o.customerId !== cust.data.customer?.id)
  );

  // ===== 14. MLM PAYOUT HISTORY =====
  console.log("\n— Payout request history");
  const payoutHistory = await req("GET", "/api/mlm/payout-requests", {
    token: mRoot.data.token,
  });
  ok("member can read own payout history", payoutHistory.status === 200 && Array.isArray(payoutHistory.data.requests));
  ok("payout history starts empty for new member", (payoutHistory.data.requests || []).length === 0);

  // ===== 15. SELLER SUMMARY (dashboard stats) =====
  console.log("\n— Seller dashboard summary");
  const summary = await req("GET", "/api/sellers/summary", { token: seller });
  ok("seller summary endpoint responds", summary.status === 200);
  ok(
    "summary counts match seller's 2 products",
    Number(summary.data.summary?.totalProducts) === 2
  );
  ok(
    "summary shows 1 approved / 1 rejected",
    Number(summary.data.summary?.approvedProducts) === 1 &&
      Number(summary.data.summary?.rejectedProducts) === 1
  );
  ok(
    "summary shows the delivered/cancelled order",
    Number(summary.data.summary?.orders) >= 1
  );
  ok(
    "summary includes KYC status",
    ["Pending", "Approved", "Rejected", "Submitted"].includes(
      summary.data.summary?.kycStatus
    )
  );

  const rivalSummary = await req("GET", "/api/sellers/summary", { token: rival });
  ok(
    "cross-seller isolation: rival summary shows 0 products",
    Number(rivalSummary.data.summary?.totalProducts) === 0 &&
      Number(rivalSummary.data.summary?.orders) === 0
  );

  // ===== 16. MAX 3 DIRECT MEMBERS + SPILLOVER =====
  // Root already has 1 direct (mChild, slot A). Fill B and C, then the
  // next referred member must spill over instead of becoming a 4th direct.
  console.log("\n— Max 3 direct members (A/B/C) + spillover");
  const m3 = await req("POST", "/api/mlm/register", {
    body: { name: "Direct Three", mobile: "9000000011", password: "member123", referralCode: rootId },
  });
  ok("2nd direct member registers (slot B)", m3.status === 201);

  const m4 = await req("POST", "/api/mlm/register", {
    body: { name: "Direct Four", mobile: "9000000012", password: "member123", referralCode: rootId },
  });
  ok("3rd direct member registers (slot C)", m4.status === 201);
  ok(
    "3rd direct member IS a direct child of the referrer",
    m4.data.member?.parentId === rootId
  );

  const m5 = await req("POST", "/api/mlm/register", {
    body: { name: "Spill Five", mobile: "9000000013", password: "member123", referralCode: rootId },
  });
  ok("4th referred member still registers (no rejection)", m5.status === 201);
  ok(
    "4th referred member is NOT a direct child of the referrer (spillover)",
    m5.data.member?.parentId !== rootId && Boolean(m5.data.member?.parentId)
  );
  ok(
    "spilled member got a valid placement position",
    ["A", "B", "C"].includes(String(m5.data.member?.position || "").toUpperCase())
  );

  const meAfter = await req("GET", "/api/mlm/me", { token: mRoot.data.token });
  const directCount = (meAfter.data.directTeam || []).length;
  ok("referrer still has exactly 3 direct members", directCount === 3);
  ok(
    "direct positions are A, B, C",
    ["A", "B", "C"].every((p) =>
      (meAfter.data.directTeam || []).some(
        (c) => String(c.position || "").toUpperCase() === p
      )
    )
  );

  // Spillover chain stays intact: the spilled member sits inside the
  // referrer's subtree (root + 3 directs + 1 spill = 5 nodes).
  const rootTree = await req("GET", "/api/mlm/tree", { token: mRoot.data.token });
  const countSubtree = (node) =>
    1 + (node.children || []).reduce((sum, c) => sum + countSubtree(c), 0);
  const subtreeSize = rootTree.data.member
    ? countSubtree({ ...rootTree.data.member, children: rootTree.data.children })
    : 0;
  ok(
    "spilled member is inside the referrer's subtree (root + 3 direct + spill = 5)",
    subtreeSize === 5
  );
}

// -----------------------------------------------------
// Runner
// -----------------------------------------------------

const { server, ready, getStderr } = await startServer();

try {
  if (!ready) {
    failed++;
    console.log("✗ FAIL: backend did not become ready in time");
    console.log(getStderr());
  } else {
    await runFlow();
  }
} catch (err) {
  failed++;
  failures.push(`CRASH: ${err.message}`);
  console.log("✗ CRASH:", err.message);
  console.log(getStderr());
} finally {
  server.kill("SIGTERM");
}

console.log(`\n=== FLOW: ${passed} passed, ${failed} failed ===`);
if (failed > 0) {
  console.log("Failed checks:");
  failures.forEach((f) => console.log(`  - ${f}`));
  process.exitCode = 1;
}
