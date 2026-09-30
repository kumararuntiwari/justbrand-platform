// =====================================================
// JUSTBRAND — E2E DELIVERY VERIFICATION (THROWAWAY DB)
// =====================================================
// Spawns the REAL backend (backend/server.js) with an isolated SQLite
// database in tests/.tmp-e2e/ (gitignored). Verifies the complete
// Buyer → Seller → Admin → Delivery Partner → Buyer flow via HTTP.
// Never touches justbrand.db at the repository root or production.
// =====================================================

import { spawn } from "node:child_process";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-e2e");

const PORT = Number(process.env.JB_E2E_TEST_PORT) || 4599;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;

function ok(name, condition, extra = "") {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    console.log(`  ✗ ${name} ${extra}`);
  }
}

async function req(method, urlPath, { token, body } = {}) {
  const response = await fetch(`${BASE}${urlPath}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  let data = null;
  try {
    data = await response.json();
  } catch {
    data = null;
  }
  return { status: response.status, data };
}

function waitForServer(child, timeoutMs = 30000) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const timer = setInterval(async () => {
      try {
        const r = await fetch(`${BASE}/api/health`).catch(() => null);
        if (r && (r.ok || r.status === 404)) {
          clearInterval(timer);
          resolve();
        }
      } catch {
        /* keep waiting */
      }
      if (Date.now() - startedAt > timeoutMs) {
        clearInterval(timer);
        child.kill();
        reject(new Error("Backend did not start in time."));
      }
    }, 300);
  });
}

async function main() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  const child = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: TMP_DIR,
    env: { ...process.env, PORT: String(PORT), JB_DB_FILE: "e2e-delivery.db" },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let backendLogs = "";
  child.stdout.on("data", (d) => (backendLogs += d.toString()));
  child.stderr.on("data", (d) => (backendLogs += d.toString()));

  try {
    await waitForServer(child);

    console.log("\n— E2E: setup (admin, seller, customer, product, order)");

    // Admin staff login (server seeds a super admin).
    const staffUser = process.env.JB_ADMIN_USERNAME || "superadmin";
    const staffPass = process.env.JB_ADMIN_PASSWORD || "JustBrand@2026";
    let r = await req("POST", "/api/staff/login", { body: { username: staffUser, password: staffPass } });
    ok("admin login", r.status === 200 && r.data?.success, JSON.stringify(r.data));
    const adminToken = r.data?.token;

    if (!adminToken) {
      throw new Error("Cannot continue without admin token.");
    }

    // Seller register + login (login is by mobile + password).
    const sellerMobile = `9${Math.floor(100000000 + Math.random() * 899999999)}`;
    r = await req("POST", "/api/sellers/register", {
      body: {
        name: "E2E Seller",
        shopName: "E2E Shop",
        mobile: sellerMobile,
        email: "e2e-seller@example.com",
        password: "seller123",
      },
    });
    ok("seller register", r.status === 200 || r.status === 201, JSON.stringify(r.data));

    // KYC gate: the ADMIN approves the seller (product-submission gate).
    r = await req("GET", "/api/admin/sellers", { token: adminToken });
    const flowSeller = (r.data?.sellers || []).find((s) => s.mobile === sellerMobile);
    r = await req("PUT", `/api/admin/sellers/${flowSeller?.id}/kyc`, {
      token: adminToken,
      body: { kycStatus: "Approved" },
    });
    ok("seller KYC approved by admin", r.status === 200, JSON.stringify(r.data));

    r = await req("POST", "/api/sellers/login", {
      body: { mobile: sellerMobile, password: "seller123" },
    });
    const sellerToken = r.data?.token;
    ok("seller login (by mobile)", Boolean(sellerToken), JSON.stringify(r.data));

    // Product create + admin approve.
    r = await req("POST", "/api/sellers/products", {
      token: sellerToken,
      body: {
        name: "E2E Delivery Widget",
        category: "Gadgets",
        price: "₹499",
        image: "https://cdn.example.com/e2e.jpg",
        shortDetails: "E2E test product",
      },
    });
    ok("product created", r.status === 201, JSON.stringify(r.data));
    const productId = r.data?.product?.id;

    r = await req("PUT", `/api/admin/products/${productId}/approve`, { token: adminToken });
    ok("product approved", r.status === 200 && r.data?.success, JSON.stringify(r.data));

    // Customer register + login + place order.
    const customerMobile = `8${Math.floor(100000000 + Math.random() * 899999999)}`;
    r = await req("POST", "/api/customers/register", {
      body: {
        name: "E2E Buyer",
        mobile: customerMobile,
        email: "e2e-buyer@example.com",
        password: "buyer123",
      },
    });
    ok("customer register", r.status === 201, JSON.stringify(r.data));

    r = await req("POST", "/api/customers/login", {
      body: { mobile: customerMobile, password: "buyer123" },
    });
    const customerToken = r.data?.token;
    ok("customer login (by mobile)", Boolean(customerToken), JSON.stringify(r.data));

    r = await req("POST", "/api/orders", {
      token: customerToken,
      body: {
        items: [{ productId, quantity: 1, price: "₹1" }],
        address: "789 Buyer Street, Andheri West, Near E2E Landmark",
        phone: customerMobile,
        paymentMethod: "COD",
      },
    });
    ok("order placed", r.status === 201, JSON.stringify(r.data));
    const orderId = r.data?.order?.id || r.data?.orderId;

    console.log("\n— E2E: seller handoff");

    r = await req("PUT", `/api/sellers/orders/${orderId}/status`, {
      token: sellerToken,
      body: { status: "Ready for Pickup" },
    });
    ok("seller marks Ready for Pickup", r.status === 200 && r.data?.success, JSON.stringify(r.data));

    console.log("\n— E2E: admin assigns delivery partner");

    r = await req("POST", "/api/admin/delivery/partners", {
      token: adminToken,
      body: {
        name: "E2E Partner",
        username: `e2epartner${Date.now().toString().slice(-6)}`,
        password: "partner123",
        mobile: `7${Math.floor(100000000 + Math.random() * 899999999)}`,
        city: "Mumbai",
      },
    });
    ok("delivery partner created", r.status === 201 && r.data?.success, JSON.stringify(r.data));
    const partner = r.data?.partner;

    r = await req("POST", `/api/admin/delivery/orders/${orderId}/assign`, {
      token: adminToken,
      body: { partnerId: partner.id },
    });
    ok("order assigned to partner", r.status === 200 && r.data?.success, JSON.stringify(r.data));
    const deliveryOtp = r.data?.deliveryOtp;
    ok("assignment returns one-time OTP to admin", /^\d{6}$/.test(String(deliveryOtp || "")));

    // OTP must never leak into buyer/seller/public shapes.
    r = await req("GET", "/api/customer/orders", { token: customerToken });
    const buyerOrders = r.data?.orders || [];
    const buyerOrder = buyerOrders.find((o) => String(o.id) === String(orderId));
    ok("buyer sees deliveryStatus after assignment", buyerOrder?.deliveryStatus === "Assigned");
    ok("buyer response has NO deliveryOtpHash", !("deliveryOtpHash" in (buyerOrder || {})));
    ok("buyer response has NO deliveryOtp", !("deliveryOtp" in (buyerOrder || {})));

    r = await req("GET", "/api/sellers/orders", { token: sellerToken });
    const sellerOrder = (r.data?.orders || []).find((o) => String(o.id) === String(orderId));
    ok("seller sees delivery status + partner name", Boolean(sellerOrder?.deliveryStatus) && Boolean(sellerOrder?.deliveryPartnerName));
    ok("seller response has NO deliveryOtpHash", !("deliveryOtpHash" in (sellerOrder || {})));

    console.log("\n— E2E: partner executes delivery");

    r = await req("POST", "/api/delivery/login", {
      body: { username: partner.username, password: "partner123" },
    });
    const partnerToken = r.data?.token;
    ok("partner login", Boolean(partnerToken), JSON.stringify(r.data));

    r = await req("GET", "/api/delivery/dashboard", { token: partnerToken });
    ok("partner dashboard shows assignment", r.data?.counts?.assigned >= 1, JSON.stringify(r.data?.counts));

    r = await req("PUT", `/api/delivery/orders/${orderId}/accept-pickup`, { token: partnerToken });
    ok("partner accepts pickup", r.status === 200 && r.data?.order?.deliveryStatus === "Pickup Pending");

    r = await req("PUT", `/api/delivery/orders/${orderId}/picked-up`, { token: partnerToken });
    ok("partner marks Picked Up", r.status === 200 && r.data?.order?.deliveryStatus === "Picked Up");

    r = await req("PUT", `/api/delivery/orders/${orderId}/start-delivery`, { token: partnerToken });
    ok("partner marks Out for Delivery", r.status === 200 && r.data?.order?.deliveryStatus === "Out for Delivery");

    // Wrong OTP must fail.
    r = await req("PUT", `/api/delivery/orders/${orderId}/deliver`, {
      token: partnerToken,
      body: { otp: "000000" },
    });
    ok("wrong OTP rejected", r.status === 401 || r.status === 400, JSON.stringify(r.data));

    r = await req("PUT", `/api/delivery/orders/${orderId}/deliver`, {
      token: partnerToken,
      body: { otp: deliveryOtp },
    });
    ok("correct OTP delivers", r.status === 200 && r.data?.order?.deliveryStatus === "Delivered", JSON.stringify(r.data));

    console.log("\n— E2E: buyer sees final status");

    r = await req("GET", "/api/customer/orders", { token: customerToken });
    const deliveredOrder = (r.data?.orders || []).find((o) => String(o.id) === String(orderId));
    ok("buyer sees Delivered", deliveredOrder?.deliveryStatus === "Delivered" || deliveredOrder?.status === "Delivered");
    ok("delivered buyer response has NO OTP data", !("deliveryOtpHash" in (deliveredOrder || {})) && !("deliveryOtp" in (deliveredOrder || {})));

    console.log("\n— E2E: failure/return path (second order)");

    r = await req("POST", "/api/orders", {
      token: customerToken,
      body: {
        items: [{ productId, quantity: 1, price: "₹1" }],
        address: "789 Buyer Street, Andheri West, Near E2E Landmark",
        phone: customerMobile,
        paymentMethod: "COD",
      },
    });
    const orderId2 = r.data?.order?.id || r.data?.orderId;
    ok("second order placed", r.status === 201 && Boolean(orderId2));

    r = await req("PUT", `/api/sellers/orders/${orderId2}/status`, {
      token: sellerToken,
      body: { status: "Ready for Pickup" },
    });
    ok("second order Ready for Pickup", r.status === 200);

    r = await req("POST", `/api/admin/delivery/orders/${orderId2}/assign`, {
      token: adminToken,
      body: { partnerId: partner.id },
    });
    const otp2 = r.data?.deliveryOtp;

    r = await req("PUT", `/api/delivery/orders/${orderId2}/accept-pickup`, { token: partnerToken });
    r = await req("PUT", `/api/delivery/orders/${orderId2}/picked-up`, { token: partnerToken });
    r = await req("PUT", `/api/delivery/orders/${orderId2}/start-delivery`, { token: partnerToken });

    r = await req("PUT", `/api/delivery/orders/${orderId2}/failed`, {
      token: partnerToken,
      body: { reason: "Customer unavailable", details: "E2E failure path" },
    });
    ok("partner marks Delivery Failed", r.status === 200 && r.data?.order?.deliveryStatus === "Delivery Failed");
    ok("failure reason + retry count recorded", r.data?.order?.deliveryRetryCount >= 1);

    r = await req("PUT", `/api/delivery/orders/${orderId2}/retry`, { token: partnerToken });
    ok("partner retries (back to Out for Delivery)", r.status === 200 && r.data?.order?.deliveryStatus === "Out for Delivery");

    r = await req("PUT", `/api/delivery/orders/${orderId2}/failed`, {
      token: partnerToken,
      body: { reason: "Customer unavailable" },
    });
    r = await req("PUT", `/api/delivery/orders/${orderId2}/return-to-seller`, { token: partnerToken });
    ok("return-to-seller started", r.status === 200 && r.data?.order?.deliveryStatus === "Return to Seller");

    r = await req("PUT", `/api/delivery/orders/${orderId2}/returned`, { token: partnerToken });
    ok("returned to seller (terminal)", r.status === 200 && r.data?.order?.deliveryStatus === "Returned to Seller");

    r = await req("GET", "/api/customer/orders", { token: customerToken });
    const returnedOrder = (r.data?.orders || []).find((o) => String(o.id) === String(orderId2));
    ok("buyer sees Returned to Seller", returnedOrder?.deliveryStatus === "Returned to Seller" || returnedOrder?.status === "Returned");

    console.log("\n— E2E: partner isolation");

    r = await req("POST", "/api/admin/delivery/partners", {
      token: adminToken,
      body: {
        name: "E2E Partner Two",
        username: `e2epartner2${Date.now().toString().slice(-6)}`,
        password: "partner234",
        mobile: `7${Math.floor(100000000 + Math.random() * 899999999)}`,
        city: "Pune",
      },
    });
    const partner2 = r.data?.partner;

    r = await req("POST", "/api/delivery/login", {
      body: { username: partner2.username, password: "partner234" },
    });
    const partner2Token = r.data?.token;

    r = await req("GET", `/api/delivery/orders/${orderId}`, { token: partner2Token });
    ok("second partner CANNOT open first partner's order", r.status === 404, `status=${r.status}`);

    r = await req("GET", "/api/delivery/orders", { token: partner2Token });
    ok("second partner sees zero orders", (r.data?.orders || []).length === 0);

    console.log("\n— E2E: partner SELF-REGISTRATION flow");

    // Partner registers themselves through the public endpoint.
    const selfMobile = `6${Math.floor(100000000 + Math.random() * 899999999)}`;
    r = await req("POST", "/api/delivery/register", {
      body: {
        name: "Self Registered Partner",
        mobile: selfMobile,
        email: "self@example.com",
        address: "5 Self Reg Street",
        city: "Jaipur",
        state: "Rajasthan",
        pincode: "302001",
        kycIdType: "Aadhaar",
        kycIdNumber: "123456789012",
        kycDocumentRef: "doc-ref-e2e",
        vehicleType: "Bike",
        vehicleNumber: "RJ14AB1234",
        drivingLicence: "RJ-DL-12345",
        emergencyContact: `6${Math.floor(100000000 + Math.random() * 899999999)}`,
        bankAccountName: "Self Partner",
        bankAccountNumber: "1234567890",
        bankIfscCode: "SBIN0001234",
        upiId: "self@upi",
        password: "selfpass1",
        confirmPassword: "selfpass1",
      },
    });
    ok("self-registration accepted", r.status === 201 && Boolean(r.data?.partnerCode), JSON.stringify(r.data));

    // Pending partner CANNOT log in yet.
    r = await req("POST", "/api/delivery/login", {
      body: { username: `dp${selfMobile}`, password: "selfpass1" },
    });
    ok("pending partner login BLOCKED with approval message", r.status === 403 && /awaiting Super Admin approval/i.test(r.data?.message || ""), JSON.stringify(r.data));

    // Duplicate self-registration is rejected.
    r = await req("POST", "/api/delivery/register", {
      body: {
        name: "Duplicate Partner",
        mobile: selfMobile,
        password: "whatever1",
        confirmPassword: "whatever1",
      },
    });
    ok("duplicate mobile registration rejected", r.status === 409);

    // Find the pending partner in the admin list.
    r = await req("GET", "/api/admin/delivery/partners", { token: adminToken });
    const pendingPartner = (r.data?.partners || []).find((p) => p.registrationSource === "self" && (p.kycStatus || "Pending") === "Pending");
    ok("pending registration visible in admin queue", Boolean(pendingPartner));

    // A MANAGER cannot approve a self-registered partner.
    r = await req("POST", "/api/admin/staff", {
      token: adminToken,
      body: { name: "E2E Manager", username: `e2emgr${Date.now().toString().slice(-6)}`, password: "managerpw1", role: "manager" },
    });
    ok("manager staff account created", r.status === 200 || r.status === 201, JSON.stringify(r.data));

    r = await req("POST", "/api/staff/login", {
      body: { username: r.data?.staff?.username || "", password: "managerpw1" },
    });
    const managerToken = r.data?.token;
    ok("manager login", Boolean(managerToken));

    r = await req("PUT", `/api/admin/delivery/partners/${pendingPartner?.id}/kyc`, { token: managerToken, body: {} }).catch(() => ({ status: 0, data: null }));
    // (PUT /kyc route does not exist — managers hit the normal partner PUT instead.)
    r = await req("PUT", `/api/admin/delivery/partners/${pendingPartner?.id}`, {
      token: managerToken,
      body: { kycStatus: "Verified" },
    });
    ok("manager CANNOT approve self-registration (403)", r.status === 403, `status=${r.status}`);

    // SUPER ADMIN approves → partner becomes active + verified.
    r = await req("PUT", `/api/admin/delivery/partners/${pendingPartner?.id}`, {
      token: adminToken,
      body: { kycStatus: "Verified" },
    });
    ok("super admin approves self-registration", r.status === 200 && r.data?.partner?.status === "active", JSON.stringify(r.data));

    // Approved partner can now log in.
    r = await req("POST", "/api/delivery/login", {
      body: { username: `dp${selfMobile}`, password: "selfpass1" },
    });
    const selfToken = r.data?.token;
    ok("approved partner can log in", Boolean(selfToken), JSON.stringify(r.data));

    // Admin assigns a fresh order to the approved partner; partner sees it.
    r = await req("POST", "/api/orders", {
      token: customerToken,
      body: {
        items: [{ productId, quantity: 1, price: "₹1" }],
        address: "789 Buyer Street, Andheri West, Near E2E Landmark",
        phone: customerMobile,
        paymentMethod: "COD",
      },
    });
    const orderId3 = r.data?.order?.id;
    r = await req("PUT", `/api/sellers/orders/${orderId3}/status`, { token: sellerToken, body: { status: "Ready for Pickup" } });
    r = await req("POST", `/api/admin/delivery/orders/${orderId3}/assign`, { token: adminToken, body: { partnerId: pendingPartner?.id } });
    ok("approved partner receives assignment", r.status === 200, JSON.stringify(r.data));

    r = await req("GET", "/api/delivery/orders", { token: selfToken });
    ok("approved partner sees own assigned order", (r.data?.orders || []).some((o) => String(o.id) === String(orderId3)));

    // REJECT path: second self-registration, then rejection with reason.
    const selfMobile2 = `6${Math.floor(100000000 + Math.random() * 899999999)}`;
    r = await req("POST", "/api/delivery/register", {
      body: {
        name: "Rejected Partner",
        mobile: selfMobile2,
        password: "rejectpass1",
        confirmPassword: "rejectpass1",
      },
    });
    ok("second self-registration accepted", r.status === 201);

    r = await req("GET", "/api/admin/delivery/partners", { token: adminToken });
    const pending2 = (r.data?.partners || []).find((p) => p.registrationSource === "self" && p.mobile === selfMobile2);

    r = await req("PUT", `/api/admin/delivery/partners/${pending2?.id}`, {
      token: adminToken,
      body: { kycStatus: "Rejected", kycReviewNote: "Documents incomplete" },
    });
    ok("super admin rejects with reason", r.status === 200 && r.data?.partner?.kycStatus === "Rejected");

    r = await req("POST", "/api/delivery/login", {
      body: { username: `dp${selfMobile2}`, password: "rejectpass1" },
    });
    ok("rejected partner login blocked WITH reason shown", r.status === 403 && /Documents incomplete/i.test(r.data?.message || ""), JSON.stringify(r.data));
  } catch (error) {
    failed += 1;
    console.log(`  ✗ E2E run error: ${error.message}`);
    if (backendLogs) {
      console.log("\n— backend logs (tail) —");
      console.log(backendLogs.split("\n").slice(-25).join("\n"));
    }
  } finally {
    child.kill("SIGTERM");
  }

  console.log(`\n===========================================`);
  console.log(`E2E DELIVERY: ${passed} passed, ${failed} failed`);
  console.log(`===========================================`);

  rmSync(TMP_DIR, { recursive: true, force: true });
  process.exit(failed === 0 ? 0 : 1);
}

main();
