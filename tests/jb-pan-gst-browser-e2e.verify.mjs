// =====================================================
// JustBrand — MANDATORY GST seller → product → order
// Four-panel REAL BROWSER E2E (isolated preview only)
// =====================================================
// Flow:
//   Seller register (PAN mandatory, no GST) → Admin KYC + PAN
//   → unregistered selling is visibly disabled / endpoint refuses
//   → product submission blocked before GST → Seller submits GSTIN
//   → Admin rejects with reason + audit → Seller sees reason/resubmits
//   → Admin approves GST → Seller product → Admin product approval
//   → Buyer order #1 → TAX_INVOICE → Buyer order #2
//   → old invoice/order unchanged → Delivery login sees assigned order.
//
// Never contacts production, Hostinger, DNS, env or deployment.

import { chromium } from "playwright";

const strip = (value) => String(value || "").replace(/\/$/, "");

const BUYER = strip(process.env.BUYER_URL || "http://127.0.0.1:8034");
const DELIVERY = strip(process.env.DELIVERY_URL || "http://127.0.0.1:8035");
const SELLER = strip(process.env.SELLER_URL || "http://127.0.0.1:8036");
const ADMIN = strip(process.env.ADMIN_URL || "http://127.0.0.1:8037");

const suffix = `${Date.now().toString(36)}${Math.floor(Math.random() * 90 + 10)}`.slice(-8);
const sellerName = `GST Audit Seller ${suffix}`;
const shopName = `GST Audit Shop ${suffix}`;
const sellerEmail = `gst.audit.${suffix}@example.com`;
const sellerMobile = `97${String(Date.now()).slice(-8)}`;
const sellerPassword = "AuditPass@2026";
const panNumber = `ABCPE${String(Math.floor(1000 + Math.random() * 8999))}Q`;
const gstin = "27AAPFU0939F1ZV";
const productName = `GST Audit Product ${suffix}`;
const buyerName = `GST Audit Buyer ${suffix}`;
const buyerMobile = `96${String(Date.now() + 17).slice(-8)}`;
const buyerPassword = "BuyerPass@2026";
const deliveryName = `GST Audit Rider ${suffix}`;
const deliveryMobile = `95${String(Date.now() + 31).slice(-8)}`;
const deliveryPassword = "RiderPass@2026";
const gstRejectionReason = `GSTIN proof mismatch — audit ${suffix}`;

const results = [];
let failures = 0;

function check(name, condition, detail = "") {
  const pass = Boolean(condition);
  results.push({ name, pass, detail: pass ? undefined : detail });
  if (!pass) failures += 1;
  console.log(`${pass ? "PASS" : "FAIL"}  ${name}${pass || !detail ? "" : ` :: ${detail}`}`);
}

async function until(fn, label, timeout = 20000) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`Timed out waiting for ${label}${lastError ? `: ${lastError.message}` : ""}`);
}

async function apiJson(base, path, { token, method = "GET", body } = {}) {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`${method} ${path} → ${response.status}: ${data.message || "request failed"}`);
  }
  return data;
}

async function apiStatus(base, path) {
  const response = await fetch(`${base}${path}`);
  return response.status;
}

const browser = await chromium.launch({ headless: true });
let sellerPage;
let adminPage;
let buyerPage;
let deliveryPage;

try {
  const sellerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const adminContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const buyerContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const deliveryContext = await browser.newContext({ viewport: { width: 1440, height: 1000 } });

  sellerPage = await sellerContext.newPage();
  adminPage = await adminContext.newPage();
  buyerPage = await buyerContext.newPage();
  deliveryPage = await deliveryContext.newPage();

  for (const page of [sellerPage, buyerPage, deliveryPage]) {
    page.on("dialog", async (dialog) => dialog.accept());
  }

  let adminPromptAnswer = "";
  adminPage.on("dialog", async (dialog) => {
    if (dialog.type() === "prompt") await dialog.accept(adminPromptAnswer);
    else await dialog.accept();
  });

  // =====================================================
  // 1. SELLER REGISTER — PAN ONLY, NON-GST FIELDS REMOVED
  // =====================================================
  await sellerPage.goto(SELLER, { waitUntil: "domcontentloaded" });
  await sellerPage.getByRole("button", { name: /Create Seller Account/i }).click();
  await sellerPage.locator('input[name="sellerName"]').waitFor({ timeout: 20000 });
  check(
    "Seller registration requires PAN",
    await sellerPage.locator('input[name="panNumber"]').isVisible()
  );
  check(
    "Unregistered/GST-portal route inputs are removed from registration",
    (await sellerPage.locator('input[name="enrolmentNumber"]').count()) === 0 &&
      (await sellerPage.locator('input[name="turnoverBelowThreshold"]').count()) === 0
  );
  check(
    "Registration copy says GSTIN is required before selling",
    (await sellerPage.locator("body").innerText()).includes("GSTIN may be added now or later")
  );

  await sellerPage.locator('input[name="sellerName"]').fill(sellerName);
  await sellerPage.locator('input[name="shopName"]').fill(shopName);
  await sellerPage.locator('input[name="mobile"]').fill(sellerMobile);
  await sellerPage.locator('input[name="email"]').fill(sellerEmail);
  await sellerPage.locator('input[name="password"]').fill(sellerPassword);
  await sellerPage.locator('input[name="confirmPassword"]').fill(sellerPassword);
  await sellerPage.locator('input[name="panNumber"]').fill(panNumber);
  await sellerPage.locator('select[name="businessType"]').selectOption("goods");
  await sellerPage.locator('textarea[name="address"]').fill("12 Audit Market, MG Road");
  await sellerPage.locator('input[name="city"]').fill("Mumbai");
  await sellerPage.locator('input[name="state"]').fill("Maharashtra");
  await sellerPage.locator('input[name="pincode"]').fill("400001");
  await sellerPage.getByRole("button", { name: /Create Seller Account/i }).click();
  await sellerPage.locator('input[placeholder="Enter mobile or email"]').waitFor({ timeout: 20000 });
  check("Seller registered successfully with PAN-only profile", true);

  // =====================================================
  // 2. DELIVERY SELF-REGISTRATION
  // =====================================================
  await deliveryPage.goto(DELIVERY, { waitUntil: "domcontentloaded" });
  await deliveryPage.getByRole("button", { name: /Create Delivery Partner Account/i }).click();
  await deliveryPage.locator('input[placeholder="Your full name"]').fill(deliveryName);
  await deliveryPage.locator('input[placeholder="10-digit mobile number"]').fill(deliveryMobile);
  await deliveryPage.locator('input[placeholder="City"]').fill("Mumbai");
  await deliveryPage.locator('input[placeholder="State"]').fill("Maharashtra");
  await deliveryPage.locator('input[placeholder="Minimum 6 characters"]').fill(deliveryPassword);
  await deliveryPage.locator('input[placeholder="Re-enter password"]').fill(deliveryPassword);
  await deliveryPage.getByRole("button", { name: /Submit Registration/i }).click();
  await deliveryPage.getByText("Registration Submitted", { exact: false }).waitFor({ timeout: 20000 });
  check(
    "Delivery self-registration submitted and pending Super Admin approval",
    (await deliveryPage.locator("body").innerText()).includes("Pending Super Admin Approval")
  );

  // =====================================================
  // 3. ADMIN LOGIN + KYC + PAN
  // =====================================================
  await adminPage.goto(ADMIN, { waitUntil: "domcontentloaded" });
  await adminPage.locator('input[placeholder="Enter username"]').fill("superadmin");
  await adminPage.locator('input[placeholder="Enter password"]').fill("JustBrand@2026");
  await adminPage.locator('button[type="submit"]').click();
  const adminSellersNav = adminPage.locator("button").filter({ hasText: "🏪 Sellers" }).first();
  await adminSellersNav.waitFor({ timeout: 30000 });
  check("Admin login via real UI", true);

  const sellerSearch = adminPage.locator(
    'input[placeholder="Search sellers by name, shop, mobile, email or code…"]'
  );
  const sellerRow = () => adminPage.locator("tbody tr").filter({ hasText: sellerName }).first();

  async function openSellerDrawer() {
    await adminSellersNav.click();
    await sellerSearch.waitFor({ timeout: 20000 });
    await sellerSearch.fill(sellerName);
    await until(async () => (await sellerRow().innerText()).includes(sellerName), "admin seller row");
    await sellerRow().getByRole("button", { name: "View" }).click();
    const drawer = adminPage.locator(".drawer");
    await until(async () => /PAN \/ GST CONTROLS/i.test(await drawer.innerText()), "seller drawer");
    return drawer;
  }

  async function closeDrawer(drawer) {
    await drawer.locator(".drawer-head button").click();
  }

  await adminSellersNav.click();
  await sellerSearch.waitFor({ timeout: 20000 });
  await sellerSearch.fill(sellerName);
  await until(async () => (await sellerRow().innerText()).includes(sellerName), "admin seller row");
  const kycResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/sellers\/\d+\/kyc$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await sellerRow().getByRole("button", { name: "KYC ✓" }).click();
  check("Admin KYC approval API returned OK", (await kycResponse).ok());
  await until(async () => (await sellerRow().innerText()).includes("Approved"), "KYC Approved row");

  let drawer = await openSellerDrawer();
  const panResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/sellers\/\d+\/pan$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await drawer.getByRole("button", { name: "PAN ✓" }).click();
  check("Admin PAN verification API returned OK", (await panResponse).ok());
  await until(async () => (await drawer.innerText()).includes("Verified"), "PAN verified in drawer");

  const drawerAfterPan = await drawer.innerText();
  check(
    "Admin drawer shows unregistered selling disabled",
    drawerAfterPan.includes("Unregistered selling: Disabled by policy")
  );
  check(
    "No button exists to approve unregistered selling",
    (await drawer.getByRole("button", { name: /approve unregistered selling/i }).count()) === 0
  );
  check(
    "Drawer shows selling blocked after PAN without GST",
    drawerAfterPan.includes("Can sell: No") && drawerAfterPan.includes("GSTIN required")
  );
  check(
    "Audit log shows KYC and PAN actions but no unregistered-selling approval",
    drawerAfterPan.includes("kyc_status") &&
      drawerAfterPan.includes("pan_verification") &&
      !drawerAfterPan.includes("unregistered_selling_review")
  );
  await closeDrawer(drawer);

  const adminToken = await adminPage.evaluate(() => localStorage.getItem("justbrand_staff_token"));
  const sellersData = await apiJson(ADMIN, "/api/admin/sellers?limit=200", { token: adminToken });
  const sellerRecord = (sellersData.sellers || []).find(
    (seller) => seller.name === sellerName && seller.shopName === shopName
  );
  check("Admin API resolves the newly registered seller", Boolean(sellerRecord), sellerRecord);
  check(
    "Server tax profile blocks selling before GST",
    sellerRecord?.taxProfile?.panStatus === "Verified" &&
      sellerRecord?.taxProfile?.canSell === false &&
      sellerRecord?.taxProfile?.taxTreatment === "blocked",
    sellerRecord?.taxProfile
  );

  const unregisteredAttempt = await fetch(
    `${ADMIN}/api/admin/sellers/${sellerRecord.id}/tax-status`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({ unregisteredSellingApproved: true }),
    }
  );
  check(
    "Unregistered-selling approval endpoint is disabled (409)",
    unregisteredAttempt.status === 409
  );

  // =====================================================
  // 4. SELLER LOGIN + PRODUCT BLOCK + GST REJECTION / RESUBMISSION
  // =====================================================
  await sellerPage.locator('input[placeholder="Enter mobile or email"]').fill(sellerEmail);
  await sellerPage.locator('input[placeholder="Enter password"]').fill(sellerPassword);
  await sellerPage.getByRole("button", { name: /Login to Seller Account/i }).click();
  await sellerPage.getByText("Add Product", { exact: true }).first().waitFor({ timeout: 30000 });
  check("Seller login after Admin KYC/PAN approval", true);

  await sellerPage.getByText("Add Product", { exact: true }).first().click();
  await sellerPage.locator('input[name="name"]').waitFor({ timeout: 20000 });
  const preGstText = await until(async () => {
    const text = await sellerPage.locator("body").innerText();
    return text.includes("Selling Disabled") ? text : "";
  }, "pre-GST selling disabled banner");
  check("Seller UI blocks product listing before GST approval", preGstText.includes("Selling Disabled"));
  check(
    "Product submit button is disabled before GST approval",
    await sellerPage.getByRole("button", { name: /KYC \+ PAN \+ GST Approval Required/ }).isDisabled()
  );

  await sellerPage.goto(SELLER, { waitUntil: "domcontentloaded" });
  await sellerPage.getByRole("button", { name: /🪪\s*KYC \/ Documents/ }).first().click();
  const gstAddForm = sellerPage
    .locator("form")
    .filter({ has: sellerPage.getByRole("button", { name: "Submit GSTIN" }) });
  const gstInput = gstAddForm.locator('input[placeholder="22AAAAA0000A1Z5"]');
  await gstInput.waitFor({ timeout: 20000 });
  await gstInput.fill(gstin);
  await until(async () => (await gstInput.inputValue()) === gstin, "GSTIN input committed");
  await sellerPage.waitForTimeout(300);
  await sellerPage.getByRole("button", { name: "Submit GSTIN" }).click();
  const pendingText = await until(async () => {
    const text = await sellerPage.locator("body").innerText();
    return text.includes("GST Verification Pending") && text.includes("remain blocked")
      ? text
      : "";
  }, "seller GST verification pending");
  check("Seller submits GSTIN; listing stays blocked while Admin verifies", pendingText.includes("remain blocked"));

  drawer = await openSellerDrawer();
  adminPromptAnswer = gstRejectionReason;
  const gstRejectResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/sellers\/\d+\/gst$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await drawer.getByRole("button", { name: "GSTIN ✗" }).click();
  check("Admin rejects GSTIN with a reason", (await gstRejectResponse).ok());
  const rejectedText = await until(async () => {
    const text = await drawer.innerText();
    return text.includes(`GST rejection reason: ${gstRejectionReason}`) &&
      text.includes("gstin_rejected")
      ? text
      : "";
  }, "GST rejection reason + audit in drawer");
  check("Admin browser displays the GST rejection reason", rejectedText.includes(gstRejectionReason));
  check(
    "Audit log records the GSTIN rejection with the reason",
    rejectedText.includes("gstin_rejected") && rejectedText.includes(gstRejectionReason)
  );
  await closeDrawer(drawer);

  await sellerPage.reload({ waitUntil: "domcontentloaded" });
  await sellerPage.getByRole("button", { name: /🪪\s*KYC \/ Documents/ }).first().click();
  const rejectedSellerText = await until(async () => {
    const text = await sellerPage.locator("body").innerText();
    return text.includes(gstRejectionReason) ? text : "";
  }, "seller GST rejection reason");
  check("Seller sees the Admin GST rejection reason", rejectedSellerText.includes(gstRejectionReason));

  const resubmitForm = sellerPage
    .locator("form")
    .filter({ has: sellerPage.getByRole("button", { name: "Submit GSTIN" }) });
  const resubmitGst = resubmitForm.locator('input[placeholder="22AAAAA0000A1Z5"]');
  await resubmitGst.fill(gstin);
  await until(async () => (await resubmitGst.inputValue()) === gstin, "GSTIN resubmission committed");
  await sellerPage.waitForTimeout(300);
  await sellerPage.getByRole("button", { name: "Submit GSTIN" }).click();
  await until(
    async () => (await sellerPage.locator("body").innerText()).includes("GST Verification Pending"),
    "seller GST resubmission pending"
  );
  check("Seller resubmits GSTIN after rejection", true);

  drawer = await openSellerDrawer();
  const gstApproveResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/sellers\/\d+\/gst$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await drawer.getByRole("button", { name: "GSTIN ✓" }).click();
  check("Admin approves resubmitted GSTIN", (await gstApproveResponse).ok());
  const approvedTaxText = await until(async () => {
    const text = await drawer.innerText();
    return text.includes("GST Registered") && text.includes("Can sell: Yes") ? text : "";
  }, "GST approved tax profile");
  check("Admin drawer shows GST Registered and Can sell: Yes", approvedTaxText.includes("Can sell: Yes"));
  check(
    "Audit log contains both rejection and approval actions",
    approvedTaxText.includes("gstin_rejected") && approvedTaxText.includes("gstin_approved")
  );
  await closeDrawer(drawer);
  await sellerPage.goto(SELLER, { waitUntil: "domcontentloaded" });

  const auditApi = await apiJson(ADMIN, `/api/admin/sellers/${sellerRecord.id}/audit`, {
    token: adminToken,
  });
  const auditActions = (auditApi.logs || []).map((entry) => entry.action);
  const rejectionAudit = (auditApi.logs || []).find(
    (entry) => entry.action === "gstin_rejected" && entry.note === gstRejectionReason
  );
  check(
    "Audit API has KYC, PAN, GST rejection and GST approval — no unregistered approval",
    ["kyc_status", "pan_verification", "gstin_rejected", "gstin_approved"].every((action) =>
      auditActions.includes(action)
    ) && !auditActions.includes("unregistered_selling_review"),
    auditActions
  );
  check("Audit API stores the GST rejection reason", Boolean(rejectionAudit), rejectionAudit);

  // =====================================================
  // 5. SELLER PRODUCT + ADMIN APPROVAL
  // =====================================================
  await sellerPage.getByText("Add Product", { exact: true }).first().click();
  await sellerPage.locator('input[name="name"]').waitFor({ timeout: 20000 });
  await until(
    async () =>
      (await sellerPage.getByRole("button", { name: /Submit Product/i }).isDisabled()) === false,
    "product submit enabled after GST approval"
  );
  await sellerPage.locator('input[name="name"]').fill(productName);
  await sellerPage.locator('input[name="category"]').fill("Electronics");
  await sellerPage.locator('input[name="sku"]').fill(`GSTAUD-${suffix}`);
  await sellerPage.locator('input[name="price"]').fill("999");
  await sellerPage.locator('input[name="comparePrice"]').fill("1499");
  await sellerPage.locator('input[name="hsnCode"]').fill("8517");
  await until(
    async () => (await sellerPage.locator('select[name="gstRate"]').inputValue()) === "18",
    "admin-verified GST mapping"
  );
  await sellerPage.locator('input[name="stock"]').fill("20");
  await sellerPage.locator('textarea[name="shortDetails"]').fill("Mandatory GST audit product");
  await sellerPage.locator('textarea[name="description"]').fill("Mandatory GST audit product description");
  const pngPixel = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
    "base64"
  );
  await sellerPage.locator('input[type="file"]').first().setInputFiles({
    name: "audit-product.png",
    mimeType: "image/png",
    buffer: pngPixel,
  });
  await until(
    async () => (await sellerPage.locator('img[alt^="Product "]').count()) > 0,
    "product image uploaded"
  );
  const productResponse = sellerPage.waitForResponse(
    (response) =>
      new URL(response.url()).pathname === "/api/sellers/products" &&
      response.request().method() === "POST"
  );
  await sellerPage.getByRole("button", { name: "Submit Product" }).click();
  const productData = await (await productResponse).json();
  check("GST-approved seller submits product for Admin approval", productData.success === true, productData);

  const sellerToken = await sellerPage.evaluate(() => localStorage.getItem("justbrand_seller_token"));
  const sellerProducts = await apiJson(SELLER, "/api/sellers/products", { token: sellerToken });
  const product = (sellerProducts.products || []).find((item) => item.name === productName);
  check("Product is listed under the GST-approved seller", Boolean(product), product);

  await adminPage.reload({ waitUntil: "domcontentloaded" });
  await adminPage.locator("button").filter({ hasText: "🏷️ Products" }).first().click();
  const productCard = () =>
    adminPage.locator(".product-card").filter({ hasText: productName }).first();
  await until(async () => (await productCard().count()) > 0, "pending product card");
  const approveProductResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/products\/\d+\/approve$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await productCard().getByRole("button", { name: /Approve/i }).click();
  check("Admin approves the GST product", (await approveProductResponse).ok());

  // =====================================================
  // 6. BUYER + TWO REAL CHECKOUTS
  // =====================================================
  await buyerPage.goto(BUYER, { waitUntil: "domcontentloaded" });
  await buyerPage.locator(".jb-header-action").filter({ hasText: "Account" }).first().click();
  await buyerPage.getByRole("button", { name: "Register", exact: true }).click();
  await buyerPage.locator('input[placeholder="Enter your full name"]').fill(buyerName);
  await buyerPage.locator('input[placeholder="10-digit mobile number"]').fill(buyerMobile);
  await buyerPage.locator('input[placeholder="you@example.com"]').fill(`buyer.${suffix}@example.com`);
  await buyerPage.locator('input[placeholder="At least 6 characters"]').fill(buyerPassword);
  await buyerPage.getByRole("button", { name: /Create Account/i }).click();
  await buyerPage.waitForFunction(
    () => Boolean(localStorage.getItem("justbrand_customer_token")),
    null,
    { timeout: 30000 }
  );
  check("Buyer registers and signs in through the browser", true);

  async function placeOrder() {
    await buyerPage.goto(`${BUYER}/product/${product.id}`, { waitUntil: "domcontentloaded" });
    await buyerPage.getByRole("button", { name: "Add to cart", exact: true }).click();
    await buyerPage.locator(".jb-cart-btn").click();
    await buyerPage.getByRole("button", { name: /Proceed to Checkout/ }).click();
    await buyerPage.locator('textarea[placeholder="House no, street, area, landmark"]').fill("44 Audit Street, Andheri");
    await buyerPage.locator('input[placeholder="City"]').fill("Mumbai");
    await buyerPage.locator('input[placeholder="State"]').fill("Maharashtra");
    await buyerPage.locator('input[placeholder="6-digit PIN"]').fill("400053");
    await buyerPage.locator('input[placeholder="you@example.com"]').fill(`buyer.${suffix}@example.com`);
    await buyerPage.locator('input[placeholder="10-digit mobile number"]').fill(buyerMobile);
    const responsePromise = buyerPage.waitForResponse(
      (response) =>
        new URL(response.url()).pathname === "/api/orders" &&
        response.request().method() === "POST"
    );
    await buyerPage.getByRole("button", { name: /Place Order/ }).click();
    const response = await responsePromise;
    const data = await response.json();
    if (!response.ok || !data.order) {
      throw new Error(`Order failed: ${response.status()} ${data.message || ""}`);
    }
    await buyerPage.getByText("Order Placed!", { exact: true }).waitFor({ timeout: 20000 });
    return data.order;
  }

  const order1 = await placeOrder();
  check("Buyer checkout completes order #1", Boolean(order1?.id && order1?.orderNumber), order1);
  const buyerToken = await buyerPage.evaluate(() =>
    localStorage.getItem("justbrand_customer_token")
  );

  const invoiceResponse1 = await apiJson(SELLER, `/api/sellers/orders/${order1.id}/invoices`, {
    token: sellerToken,
  });
  const invoice1 = invoiceResponse1.invoices?.[0];
  check("Order #1 creates a TAX_INVOICE", invoice1?.invoiceType === "TAX_INVOICE", invoice1);
  check(
    "Order #1 invoice has GSTIN and positive GST",
    invoice1?.sellerGstin === gstin && Number(invoice1?.gstAmount) > 0,
    invoice1
  );
  check(
    "Order #1 is never a NON_GST_INVOICE",
    invoice1?.invoiceType !== "NON_GST_INVOICE",
    invoice1
  );

  const order1Snapshot = {
    id: order1.id,
    orderNumber: order1.orderNumber,
    totalAmount: order1.totalAmount,
    chargesJson: order1.chargesJson,
    paymentMethod: order1.paymentMethod,
    createdAt: order1.createdAt,
  };
  const invoices1Snapshot = JSON.stringify(invoiceResponse1.invoices);

  const order2 = await placeOrder();
  check("Buyer checkout completes order #2", Boolean(order2?.id && order2?.orderNumber), order2);

  const invoiceResponse2 = await apiJson(SELLER, `/api/sellers/orders/${order2.id}/invoices`, {
    token: sellerToken,
  });
  const invoice2 = invoiceResponse2.invoices?.[0];
  check(
    "Order #2 creates a separate TAX_INVOICE",
    invoice2?.invoiceType === "TAX_INVOICE" &&
      invoice2?.invoiceNumber !== invoice1?.invoiceNumber,
    invoice2
  );
  check(
    "Order #2 invoice carries GSTIN and positive GST",
    invoice2?.sellerGstin === gstin && Number(invoice2?.gstAmount) > 0,
    invoice2
  );

  const invoices1After = await apiJson(SELLER, `/api/sellers/orders/${order1.id}/invoices`, {
    token: sellerToken,
  });
  check(
    "Order #1 invoice snapshot is byte-for-byte unchanged after order #2",
    JSON.stringify(invoices1After.invoices) === invoices1Snapshot
  );

  const customerOrders = await apiJson(BUYER, "/api/customer/orders", { token: buyerToken });
  const order1After = (customerOrders.orders || []).find((order) => order.id === order1.id);
  check(
    "Old order #1 totals/charges/payment/timestamp are immutable",
    order1After &&
      order1After.totalAmount === order1Snapshot.totalAmount &&
      order1After.chargesJson === order1Snapshot.chargesJson &&
      order1After.paymentMethod === order1Snapshot.paymentMethod &&
      order1After.createdAt === order1Snapshot.createdAt,
    { before: order1Snapshot, after: order1After }
  );

  await sellerPage.goto(SELLER, { waitUntil: "domcontentloaded" });
  await sellerPage.getByRole("button", { name: /🛒\s*Orders/ }).first().click();
  await until(
    async () => (await sellerPage.locator("body").innerText()).includes(`#${order2.id}`),
    "seller order #2 card"
  );
  const orderCard2 = sellerPage
    .locator("div")
    .filter({ hasText: `#${order2.id}` })
    .filter({ has: sellerPage.getByRole("button", { name: /View Order/ }) })
    .last();
  await orderCard2.getByRole("button", { name: /View Order/ }).click();
  const orderDetails2 = await until(async () => {
    const text = await sellerPage.locator("body").innerText();
    return text.includes("GST tax invoice") && text.includes(gstin) ? text : "";
  }, "seller GST invoice snapshot");
  check(
    "Seller browser shows a GST tax invoice with GSTIN",
    orderDetails2.includes("GST tax invoice") && orderDetails2.includes(gstin)
  );
  await sellerPage.getByRole("button", { name: "Close" }).click().catch(() => {});

  // =====================================================
  // 7. DELIVERY PARTNER APPROVAL + ASSIGNMENT
  // =====================================================
  await adminPage.getByRole("button", { name: "🛵 Delivery", exact: true }).click();
  await adminPage.getByRole("button", { name: "🤝 Partners", exact: true }).click();
  const pendingApprovals = adminPage
    .getByText(/Pending Registrations/)
    .locator("xpath=../..");
  const partnerCard = () =>
    pendingApprovals
      .getByText(deliveryName)
      .locator("xpath=ancestor::div[.//button][1]");
  await until(async () => (await partnerCard().count()) > 0, "pending delivery partner card");
  const partnerResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/delivery\/partners\/\d+$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "PUT"
  );
  await partnerCard().getByRole("button", { name: "✓ Approve" }).click();
  check("Admin approves self-registered delivery partner", (await partnerResponse).ok());

  const partnersData = await apiJson(ADMIN, "/api/admin/delivery/partners", { token: adminToken });
  const partnerRecord = (partnersData.partners || []).find((partner) => partner.name === deliveryName);
  check("Delivery partner appears in Admin after self-registration", Boolean(partnerRecord), partnerRecord);

  await adminPage.getByRole("button", { name: /Assign Delivery/i }).click();
  await adminPage.locator('input[placeholder="Search unassigned orders…"]').fill(order2.orderNumber);
  const assignCard = () =>
    adminPage
      .locator("div")
      .filter({ hasText: order2.orderNumber })
      .filter({ has: adminPage.getByRole("button", { name: "Assign", exact: true }) })
      .last();
  await until(async () => (await assignCard().count()) > 0, "unassigned order card");
  await assignCard().locator("select").selectOption(String(partnerRecord.id));
  const assignResponse = adminPage.waitForResponse(
    (response) =>
      /\/api\/admin\/delivery\/orders\/\d+\/assign$/.test(new URL(response.url()).pathname) &&
      response.request().method() === "POST"
  );
  await assignCard().getByRole("button", { name: "Assign", exact: true }).click();
  check("Admin assigns order #2 to the new delivery partner", (await assignResponse).ok());

  await deliveryPage.getByRole("button", { name: "Back to Login" }).click();
  await deliveryPage.locator('input[placeholder="e.g. 98765 43210 or DP-XXXX"]').fill(deliveryMobile);
  await deliveryPage.locator('input[placeholder="Your password"]').fill(deliveryPassword);
  await deliveryPage.getByRole("button", { name: "Login", exact: true }).click();
  const assignedNav = deliveryPage.getByRole("button", { name: /Assigned Deliveries/ }).first();
  await assignedNav.waitFor({ timeout: 30000 });
  check("Approved delivery partner logs in through the browser", true);
  await assignedNav.click();
  const deliveryOrderText = await until(async () => {
    const text = await deliveryPage.locator("body").innerText();
    return text.includes(order2.orderNumber) ? text : "";
  }, "assigned order in delivery panel");
  check(
    "Delivery panel shows the Admin-assigned seller order",
    deliveryOrderText.includes(order2.orderNumber)
  );

  // =====================================================
  // 8. FINAL POLICY CHECK — KYC REJECTION HIDES, DOES NOT DELETE
  // =====================================================
  const kycRejectResponse = await fetch(
    `${ADMIN}/api/admin/sellers/${sellerRecord.id}/kyc`,
    {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${adminToken}`,
      },
      body: JSON.stringify({
        kycStatus: "Rejected",
        rejectionReason: "KYC documents expired — audit",
      }),
    }
  );
  check("Admin rejects KYC with a reason", kycRejectResponse.ok);

  const hiddenStatus = await apiStatus(BUYER, `/api/products/${product.id}`);
  check("KYC rejection removes the product from the public marketplace", hiddenStatus === 404, hiddenStatus);

  const invoiceAfterKyc = await apiJson(SELLER, `/api/sellers/orders/${order1.id}/invoices`, {
    token: sellerToken,
  });
  check(
    "KYC rejection does not delete or rewrite old invoices",
    JSON.stringify(invoiceAfterKyc.invoices) === invoices1Snapshot
  );

  // =====================================================
  // SUMMARY
  // =====================================================
  console.log(
    JSON.stringify(
      {
        ok: failures === 0,
        checks: results.length,
        passed: results.filter((row) => row.pass).length,
        failed: failures,
        seller: { id: sellerRecord?.id, name: sellerName, pan: panNumber, gstin },
        product: { id: product?.id, name: productName },
        order1: {
          id: order1.id,
          number: order1.orderNumber,
          invoice: invoice1?.invoiceNumber,
          type: invoice1?.invoiceType,
        },
        order2: {
          id: order2.id,
          number: order2.orderNumber,
          invoice: invoice2?.invoiceNumber,
          type: invoice2?.invoiceType,
        },
        deliveryPartner: { id: partnerRecord?.id, name: deliveryName },
        failures: results.filter((row) => !row.pass),
      },
      null,
      2
    )
  );
} catch (error) {
  console.error(`E2E ABORTED: ${error.stack || error.message}`);
  for (const [name, page] of [
    ["seller", sellerPage],
    ["admin", adminPage],
    ["buyer", buyerPage],
    ["delivery", deliveryPage],
  ]) {
    if (!page) continue;
    try {
      const text = (await page.locator("body").innerText()).slice(0, 1200);
      console.error(`\n--- ${name.toUpperCase()} PAGE TEXT ---\n${text}`);
    } catch {
      // page may be closed
    }
  }
  failures += 1;
} finally {
  await browser.close();
}

if (failures > 0) {
  console.error(`\n${failures} failure(s); ${results.filter((r) => r.pass).length}/${results.length} checks passed.`);
  process.exit(1);
}
console.log(`\nALL ${results.length} CHECKS PASSED`);
