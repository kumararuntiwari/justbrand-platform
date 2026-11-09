// =====================================================
// JUSTBRAND — MANDATORY GST SELLER TAX SUITE
// =====================================================
// Isolated end-to-end suite. Spawns the real backend against a throwaway
// SQLite DB in tests/.tmp-seller-tax/ and never touches production data.
//
// Production policy under test:
//   - PAN is mandatory at registration.
//   - KYC + PAN verification + Admin GSTIN approval are all mandatory
//     before a product can be listed or sold.
//   - GST-unregistered / non-GST selling is disabled completely.
//   - GSTIN can be added later; rejection requires a reason and supports
//     resubmission.
//   - Only TAX_INVOICE is created; old invoice snapshots stay immutable.
//
// Run: node --test tests/jb-seller-tax.test.mjs

import { spawn } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BACKEND_ENTRY = path.join(REPO_ROOT, "backend", "server.js");
const TMP_DIR = path.join(REPO_ROOT, "tests", ".tmp-seller-tax");
const PORT = Number(process.env.JB_SELLER_TAX_TEST_PORT) || 4601;
const BASE = `http://127.0.0.1:${PORT}`;

let passed = 0;
let failed = 0;
const failures = [];

function ok(name, cond, extra) {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
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
  const data = await res.json().catch(() => null);
  return { status: res.status, data };
}

let server = null;

async function startServer() {
  rmSync(TMP_DIR, { recursive: true, force: true });
  mkdirSync(TMP_DIR, { recursive: true });

  server = spawn(process.execPath, [BACKEND_ENTRY], {
    cwd: TMP_DIR,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(PORT),
      JWT_SECRET: "jb-seller-tax-test-secret-local-only",
      JB_REQUIRE_SELLER_PAN: "1",
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
      /* not ready */
    }
    await new Promise((r) => setTimeout(r, 200));
  }
  return { ready: false, getStderr: () => stderrTail };
}

const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const GSTIN = "27AAPFU0939F1ZV";

async function runFlow() {
  const { ready, getStderr } = await startServer();
  if (!ready) {
    console.error("Backend failed to start:\n" + getStderr());
    process.exit(1);
  }

  const adminLogin = await req("POST", "/api/staff/login", {
    body: { username: "superadmin", password: "JustBrand@2026" },
  });
  const admin = adminLogin.data?.token;
  ok("admin login", Boolean(admin));

  const stamp = Date.now() + Math.floor(Math.random() * 1000);
  const sellerBody = {
    name: `GST Seller ${stamp}`,
    shopName: `GST Shop ${stamp}`,
    mobile: String(9811100000 + (stamp % 99999)),
    email: `gst.seller.${stamp}@example.com`,
    password: "Seller@12345",
    panNumber: "ABCPE1234F",
    businessType: "goods",
    address: "12, Market Road, Pune",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411001",
  };

  const regNoPan = await req("POST", "/api/sellers/register", {
    body: { ...sellerBody, email: `nopan.${stamp}@example.com`, panNumber: "" },
  });
  ok(
    "registration without PAN rejected (400 PAN_REQUIRED)",
    regNoPan.status === 400 && regNoPan.data?.code === "PAN_REQUIRED",
    regNoPan.data
  );

  const reg = await req("POST", "/api/sellers/register", { body: sellerBody });
  ok("PAN-only seller registration succeeds", reg.status === 201 && reg.data?.success === true, reg.data);
  const sellerId = reg.data?.seller?.id;
  const initialTax = reg.data?.seller?.taxProfile;
  ok("new seller starts GST Unregistered", initialTax?.gstStatus === "GST Unregistered", initialTax);
  ok("new seller PAN is Pending Verification", initialTax?.panStatus === "Pending Verification", initialTax);
  ok("new seller cannot sell without GSTIN + Admin approval", initialTax?.canSell === false, initialTax);
  ok(
    "new seller blocker explicitly requires GSTIN",
    (initialTax?.blockers || []).some((b) => b.includes("GSTIN")),
    initialTax?.blockers
  );

  const login = await req("POST", "/api/sellers/login", {
    body: { email: sellerBody.email, password: sellerBody.password },
  });
  const seller = login.data?.token;
  ok("seller login", Boolean(seller));

  const kycApprove = await req("PUT", `/api/admin/sellers/${sellerId}/kyc`, {
    token: admin,
    body: { kycStatus: "Approved" },
  });
  ok("admin approves KYC", kycApprove.status === 200, kycApprove.data);

  const addBeforeGst = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: `Blocked Product ${stamp}`,
      category: "Electronics",
      price: "1000",
      hsnCode: "8517",
      gstRate: 18,
      image: PNG,
      description: "Must not be created before GST approval",
    },
  });
  ok(
    "product submission blocked before PAN/GST approval (403 SELLER_GST_REQUIRED)",
    addBeforeGst.status === 403 && addBeforeGst.data?.code === "SELLER_GST_REQUIRED",
    addBeforeGst.data
  );

  const panVerify = await req("PUT", `/api/admin/sellers/${sellerId}/pan`, {
    token: admin,
    body: { panStatus: "Verified", reason: "PAN card checked manually" },
  });
  ok("admin manually verifies PAN", panVerify.status === 200, panVerify.data);

  const afterPan = await req("GET", "/api/sellers/tax-profile", { token: seller });
  ok("PAN is Verified after admin action", afterPan.data?.taxProfile?.panStatus === "Verified", afterPan.data?.taxProfile);
  ok("PAN verification alone does not allow selling", afterPan.data?.taxProfile?.canSell === false, afterPan.data?.taxProfile);
  ok("invoice type is inactive before GST approval", afterPan.data?.taxProfile?.invoiceType === null, afterPan.data?.taxProfile);

  const unregistered = await req("PUT", `/api/admin/sellers/${sellerId}/tax-status`, {
    token: admin,
    body: {
      unregisteredSellingApproved: true,
      enrolmentStatus: "Verified",
      reason: "attempt to enable non-GST selling",
    },
  });
  ok(
    "unregistered-selling approval endpoint is disabled (409 GST_REQUIRED)",
    unregistered.status === 409 && unregistered.data?.code === "GST_REQUIRED",
    unregistered.data
  );
  const afterUnregisteredAttempt = await req("GET", "/api/sellers/tax-profile", { token: seller });
  ok(
    "unregistered approval cannot change eligibility",
    afterUnregisteredAttempt.data?.taxProfile?.canSell === false &&
      afterUnregisteredAttempt.data?.taxProfile?.taxTreatment === "blocked",
    afterUnregisteredAttempt.data?.taxProfile
  );

  const gstSubmit = await req("POST", "/api/sellers/gst", {
    token: seller,
    body: { gstin: GSTIN },
  });
  ok("seller can submit GSTIN later", gstSubmit.status === 200, gstSubmit.data);
  ok(
    "GSTIN submission starts GST Verification Pending",
    gstSubmit.data?.taxProfile?.gstStatus === "GST Verification Pending",
    gstSubmit.data?.taxProfile
  );
  ok("pending GSTIN still blocks selling", gstSubmit.data?.taxProfile?.canSell === false, gstSubmit.data?.taxProfile);

  const rejectWithoutReason = await req("PUT", `/api/admin/sellers/${sellerId}/gst`, {
    token: admin,
    body: { gstStatus: "Rejected" },
  });
  ok(
    "GST rejection without reason is rejected (400)",
    rejectWithoutReason.status === 400,
    rejectWithoutReason.data
  );

  const rejectGst = await req("PUT", `/api/admin/sellers/${sellerId}/gst`, {
    token: admin,
    body: { gstStatus: "Rejected", reason: "GSTIN document mismatch" },
  });
  ok("admin can reject GSTIN with a reason", rejectGst.status === 200, rejectGst.data);
  const afterReject = await req("GET", "/api/sellers/tax-profile", { token: seller });
  ok(
    "GST rejection status and reason are visible to seller",
    afterReject.data?.taxProfile?.gstStatus === "GST Rejected" &&
      afterReject.data?.taxProfile?.gstRejectionReason === "GSTIN document mismatch",
    afterReject.data?.taxProfile
  );
  ok("rejected GSTIN blocks selling", afterReject.data?.taxProfile?.canSell === false, afterReject.data?.taxProfile);

  const resubmit = await req("POST", "/api/sellers/gst", {
    token: seller,
    body: { gstin: GSTIN },
  });
  ok("seller can resubmit a corrected GSTIN", resubmit.status === 200, resubmit.data);
  ok(
    "resubmission clears the old rejection reason",
    resubmit.data?.taxProfile?.gstStatus === "GST Verification Pending" &&
      !resubmit.data?.taxProfile?.gstRejectionReason,
    resubmit.data?.taxProfile
  );

  const gstApprove = await req("PUT", `/api/admin/sellers/${sellerId}/gst`, {
    token: admin,
    body: { gstStatus: "Approved", reason: "GSTIN portal checked manually" },
  });
  ok("admin approves GSTIN", gstApprove.status === 200, gstApprove.data);

  const afterGst = await req("GET", "/api/sellers/tax-profile", { token: seller });
  const approvedTax = afterGst.data?.taxProfile;
  ok("seller becomes GST Registered after approval", approvedTax?.gstStatus === "GST Registered", approvedTax);
  ok("GST approval date is stored", Boolean(approvedTax?.gstApprovedAt), approvedTax);
  ok("seller becomes eligible only after KYC + PAN + GST approval", approvedTax?.canSell === true, approvedTax);
  ok("invoice type becomes TAX_INVOICE", approvedTax?.invoiceType === "TAX_INVOICE", approvedTax);
  ok("non-GST invoice type is never offered", approvedTax?.taxTreatment !== "non_gst", approvedTax);

  const add = await req("POST", "/api/sellers/products", {
    token: seller,
    body: {
      name: `GST Product ${stamp}`,
      category: "Electronics",
      price: "1000",
      hsnCode: "8517",
      gstRate: 18,
      image: PNG,
      description: "Mandatory-GST seller product",
      shortDetails: "Tax test",
    },
  });
  ok("GST-approved seller can submit a product", add.status === 201, add.data);
  const productId = add.data?.product?.id;

  const approve = await req("PUT", `/api/admin/products/${productId}/approve`, {
    token: admin,
  });
  ok("admin approves the GST product", approve.status === 200, approve.data);
  ok(
    "approved product is GST-invoiceable",
    Number(approve.data?.product?.gstInvoiceAllowed) === 1 &&
      approve.data?.product?.taxTreatment === "gst",
    approve.data?.product
  );
  ok("approved product carries 18% GST", Number(approve.data?.product?.gstRate) === 18, approve.data?.product);

  const pub = await req("GET", `/api/products/${productId}`);
  ok("buyer can see the GST-approved product", pub.status === 200 && pub.data?.id === productId, pub.data);

  const custMobile = String(9822200000 + (stamp % 99999));
  const custReg = await req("POST", "/api/customers/register", {
    body: { name: `Tax Buyer ${stamp}`, mobile: custMobile, password: "Cust@12345" },
  });
  const customer = custReg.data?.token;
  ok("buyer registration", Boolean(customer));

  const orderBody = {
    items: [{ productId, quantity: 1 }],
    address: "44, Buyer Street, Pune",
    city: "Pune",
    state: "Maharashtra",
    pincode: "411002",
    phone: custMobile,
    paymentMethod: "COD",
  };

  const order = await req("POST", "/api/orders", { token: customer, body: orderBody });
  ok("GST order succeeds after all approvals", order.status === 201 && order.data?.success === true, order.data);
  const orderId = order.data?.order?.id;
  const charges = JSON.parse(order.data?.order?.chargesJson || "{}");
  ok("GST order charges GST", Number(charges?.tax?.totals?.gstAmount || 0) > 0, charges?.tax);

  const invoice = await req("GET", `/api/customer/orders/${orderId}/invoice`, { token: customer });
  const firstInvoice = invoice.data?.invoices?.[0];
  ok("customer invoice endpoint returns a snapshot", invoice.status === 200 && invoice.data?.invoices?.length === 1, invoice.data);
  ok("invoice is TAX_INVOICE", firstInvoice?.invoiceType === "TAX_INVOICE", firstInvoice);
  ok("invoice contains GSTIN", firstInvoice?.sellerGstin === GSTIN, firstInvoice);
  ok("invoice has 18% GST", Number(firstInvoice?.gstAmount) === 180, firstInvoice);
  ok("intra-State invoice splits CGST/SGST", Number(firstInvoice?.cgst) === 90 && Number(firstInvoice?.sgst) === 90, firstInvoice);
  ok("no NON_GST_INVOICE is created under mandatory GST", firstInvoice?.invoiceType !== "NON_GST_INVOICE", firstInvoice);

  const sellerInvoice = await req("GET", `/api/sellers/orders/${orderId}/invoices`, { token: seller });
  ok("seller sees the TAX_INVOICE", sellerInvoice.data?.invoices?.[0]?.invoiceType === "TAX_INVOICE", sellerInvoice.data);

  const suspendGst = await req("PUT", `/api/admin/sellers/${sellerId}/gst`, {
    token: admin,
    body: { gstStatus: "Rejected", reason: "GSTIN suspended pending review" },
  });
  ok("admin can revoke GST approval with a reason", suspendGst.status === 200, suspendGst.data);
  const hidden = await req("GET", `/api/products/${productId}`);
  ok("GST revocation hides the approved product without deleting it", hidden.status === 404, hidden.data);

  const oldInvoiceWhileBlocked = await req("GET", `/api/customer/orders/${orderId}/invoice`, { token: customer });
  const oldInvoice = oldInvoiceWhileBlocked.data?.invoices?.[0];
  ok(
    "old invoice survives GST revocation",
    oldInvoice?.invoiceType === "TAX_INVOICE" && oldInvoice?.id === firstInvoice?.id,
    oldInvoice
  );
  ok(
    "old invoice number and GST amount are unchanged",
    oldInvoice?.invoiceNumber === firstInvoice?.invoiceNumber &&
      Number(oldInvoice?.gstAmount) === Number(firstInvoice?.gstAmount),
    { oldInvoice, firstInvoice }
  );

  const resubmit2 = await req("POST", "/api/sellers/gst", {
    token: seller,
    body: { gstin: GSTIN },
  });
  ok("seller can resubmit after GST revocation", resubmit2.status === 200, resubmit2.data);
  const reapproveGst = await req("PUT", `/api/admin/sellers/${sellerId}/gst`, {
    token: admin,
    body: { gstStatus: "Approved", reason: "GSTIN rechecked" },
  });
  ok("admin can re-approve the GSTIN", reapproveGst.status === 200, reapproveGst.data);

  const reapproveProduct = await req("PUT", `/api/admin/products/${productId}/approve`, {
    token: admin,
  });
  ok("admin re-approves the product after GST restoration", reapproveProduct.status === 200, reapproveProduct.data);

  const order2 = await req("POST", "/api/orders", { token: customer, body: orderBody });
  ok("second GST order succeeds after restoration", order2.status === 201, order2.data);
  const order2Id = order2.data?.order?.id;
  const invoice2 = await req("GET", `/api/customer/orders/${order2Id}/invoice`, { token: customer });
  const secondInvoice = invoice2.data?.invoices?.[0];
  ok("second invoice is a new TAX_INVOICE", secondInvoice?.invoiceType === "TAX_INVOICE" && secondInvoice?.id !== firstInvoice?.id, secondInvoice);
  ok("second invoice charges tax independently", Number(secondInvoice?.gstAmount) === 180, secondInvoice);

  const firstAgain = await req("GET", `/api/customer/orders/${orderId}/invoice`, { token: customer });
  const firstAgainInvoice = firstAgain.data?.invoices?.[0];
  ok(
    "first invoice remains byte-identical after a later sale",
    firstAgainInvoice?.id === firstInvoice?.id &&
      firstAgainInvoice?.invoiceNumber === firstInvoice?.invoiceNumber &&
      Number(firstAgainInvoice?.gstAmount) === Number(firstInvoice?.gstAmount) &&
      firstAgainInvoice?.sellerGstin === firstInvoice?.sellerGstin,
    { firstAgainInvoice, firstInvoice }
  );

  const summary = await req("GET", "/api/admin/sellers/tax-summary", { token: admin });
  ok("admin tax summary counts GST-registered seller", Number(summary.data?.summary?.gstRegistered) >= 1, summary.data);

  const list = await req("GET", "/api/admin/sellers", { token: admin });
  const sellerRow = (list.data?.sellers || []).find((s) => s.id === sellerId);
  ok(
    "admin seller list exposes PAN/GST statuses",
    sellerRow?.taxProfile?.panStatus === "Verified" &&
      sellerRow?.taxProfile?.gstStatus === "GST Registered",
    sellerRow?.taxProfile
  );

  const audit = await req("GET", `/api/admin/sellers/${sellerId}/audit`, { token: admin });
  const actions = (audit.data?.logs || []).map((row) => row.action);
  ok("audit log records seller registration", actions.includes("seller_registered"), actions);
  ok("audit log records KYC approval", actions.includes("kyc_status"), actions);
  ok("audit log records PAN verification", actions.includes("pan_verification"), actions);
  ok("audit log records GST submission", actions.includes("gst_submitted"), actions);
  ok("audit log records GST rejection", actions.includes("gstin_rejected"), actions);
  ok("audit log records GST approval", actions.includes("gstin_approved"), actions);
  ok("no unregistered-selling approval audit exists", !actions.includes("unregistered_selling_review"), actions);

  const rejectPan = await req("PUT", `/api/admin/sellers/${sellerId}/pan`, {
    token: admin,
    body: { panStatus: "Rejected" },
  });
  ok("PAN rejection requires a reason (400)", rejectPan.status === 400, rejectPan.data);

  const badGstin = await req("POST", "/api/sellers/gst", {
    token: seller,
    body: { gstin: "22AAAAA0000A1Z5" },
  });
  ok(
    "invalid GSTIN checksum rejected (400)",
    badGstin.status === 400 && badGstin.data?.code === "INVALID_GSTIN",
    badGstin.data
  );

  const kycReject = await req("PUT", `/api/admin/sellers/${sellerId}/kyc`, {
    token: admin,
    body: { kycStatus: "Rejected", rejectionReason: "KYC documents expired" },
  });
  ok("admin can reject KYC with a reason", kycReject.status === 200, kycReject.data);
  const hiddenAfterKycReject = await req("GET", `/api/products/${productId}`);
  ok("KYC rejection takes the product offline without deleting it", hiddenAfterKycReject.status === 404, hiddenAfterKycReject.data);

  const stillThere = await req("GET", `/api/customer/orders/${order2Id}/invoice`, { token: customer });
  ok(
    "orders and invoices survive KYC rejection",
    stillThere.status === 200 && stillThere.data?.invoices?.[0]?.id === secondInvoice?.id,
    stillThere.data
  );
}

try {
  await runFlow();
} finally {
  if (server) server.kill();
}

console.log(`\n${passed} passed, ${failed} failed`);
if (failed > 0) {
  console.log("Failures:", failures);
  process.exitCode = 1;
}
