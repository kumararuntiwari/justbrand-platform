// =====================================================
// JUSTBRAND — PAN-INDIA COURIER NETWORK VERIFICATION
// =====================================================
// Starts a LOCAL fake Shiprocket HTTP server and points the REAL backend
// adapter at it with test-only credentials. No real Shiprocket or other
// courier is contacted and no paid shipment is created.
//
// Covers:
//   - live adapter auth, serviceability, rate comparison and ETA
//   - multi-seller order groups and one shipment per seller
//   - Shiprocket order/shipment, AWB, label, manifest, pickup
//   - tracking refresh, signed/authenticated webhook + idempotency
//   - NDR/RTO/cancellation state
//   - manual partner honesty (India Post etc.)
//   - booking failure is reported honestly (no fake AWB)
//   - order totals/GST/payment/commission are unchanged
// =====================================================

import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(REPO_ROOT, "tests", ".tmp", "jb-courier-network-db");
const PORT = Number(process.env.JB_COURIER_TEST_PORT) || 4722;
const BASE = `http://127.0.0.1:${PORT}`;
const SECRET = "jb-courier-test-secret-local-only";
const WEBHOOK_SECRET = "jb-test-webhook-token-not-real";
const FAKE_SHIPROCKET_PASSWORD = "fake-shiprocket-password-not-real";

let passed = 0;
let failed = 0;
const failures = [];
const fakeCalls = [];

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

function json(res, status, body) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

// ---------- fake Shiprocket ----------
let shipmentCounter = 4000;
const fake = createServer(async (req, res) => {
  let raw = "";
  for await (const chunk of req) raw += chunk;
  let body = null;
  try {
    body = raw ? JSON.parse(raw) : null;
  } catch {
    body = raw;
  }

  fakeCalls.push({ method: req.method, path: req.url, body });
  const url = new URL(req.url, "http://localhost");
  const pathname = url.pathname;

  if (pathname === "/v1/external/auth/login") {
    if (body?.email === "api@test.local" && body?.password === FAKE_SHIPROCKET_PASSWORD) {
      return json(res, 200, { token: "fake-bearer-token" });
    }
    return json(res, 401, { message: "bad credentials" });
  }

  if (req.headers.authorization !== "Bearer fake-bearer-token") {
    return json(res, 401, { message: "missing bearer token" });
  }

  if (pathname.startsWith("/v1/external/courier/serviceability")) {
    if (url.searchParams.get("pickup_postcode") !== "226001") {
      return json(res, 200, { data: { available_courier_companies: [] } });
    }
    return json(res, 200, {
      data: {
        available_courier_companies: [
          {
            courier_company_id: 22,
            courier_name: "Mock Express",
            rate: 55,
            cod_charges: 5,
            estimated_delivery_days: 3,
            etd: "2026-11-15",
            rating: 4.5,
          },
          {
            courier_company_id: 33,
            courier_name: "Mock Surface",
            rate: 70,
            cod_charges: 5,
            estimated_delivery_days: 5,
            etd: "2026-11-17",
            rating: 4.1,
          },
        ],
      },
    });
  }

  if (pathname === "/v1/external/orders/create/adhoc") {
    if (String(body?.billing_address || "").startsWith("FAIL")) {
      return json(res, 422, { message: "simulated address rejection" });
    }
    shipmentCounter += 1;
    return json(res, 200, {
      order_id: 9000 + shipmentCounter,
      shipment_id: shipmentCounter,
      status: "NEW",
    });
  }

  if (pathname === "/v1/external/courier/assign/awb") {
    const awb = `SRTEST${shipmentCounter}`;
    return json(res, 200, {
      awb_code: awb,
      courier_name: "Mock Express",
      response: { data: { awb_code: awb, courier_name: "Mock Express" } },
    });
  }

  if (pathname === "/v1/external/courier/generate/label") {
    return json(res, 200, { label_url: "https://labels.test.local/label.pdf" });
  }

  if (pathname === "/v1/external/manifests/generate") {
    return json(res, 200, { manifest_url: "https://labels.test.local/manifest.pdf" });
  }

  if (pathname === "/v1/external/courier/generate/pickup") {
    return json(res, 200, {
      success: true,
      pickup_token_number: "PU-MOCK-1",
      pickup_scheduled_date: "2026-11-10",
      message: "Pickup generated",
    });
  }

  if (pathname.startsWith("/v1/external/courier/track/awb/")) {
    return json(res, 200, {
      tracking_data: {
        track_status: "IN TRANSIT",
        shipment_track: [
          {
            awb_code: decodeURIComponent(pathname.split("/").pop()),
            current_status: "IN TRANSIT",
            courier_name: "Mock Express",
            edd: "2026-11-15",
          },
        ],
        shipment_track_activities: [
          {
            date: "2026-11-10 10:00:00",
            status: "X-UCI",
            activity: "Manifested",
            location: "Lucknow",
            "sr-status-label": "MANIFEST GENERATED",
          },
          {
            date: "2026-11-11 12:00:00",
            status: "IT",
            activity: "In transit",
            location: "Kanpur",
            "sr-status-label": "IN TRANSIT",
          },
        ],
      },
    });
  }

  if (pathname === "/v1/external/orders/cancel" || pathname === "/v1/external/shipments/cancel") {
    return json(res, 200, { success: true, message: "cancelled" });
  }

  if (pathname.startsWith("/v1/external/ndr/") && pathname.endsWith("/action")) {
    return json(res, 200, { success: true, message: `NDR ${body?.action} accepted` });
  }

  return json(res, 404, { message: `unhandled fake path ${pathname}` });
});

await new Promise((resolve) => fake.listen(0, "127.0.0.1", resolve));
const fakePort = fake.address().port;
const fakeBase = `http://127.0.0.1:${fakePort}`;
console.log(`fake Shiprocket listening on ${fakeBase}`);

// ---------- isolated backend ----------
rmSync(DB_DIR, { recursive: true, force: true });
mkdirSync(DB_DIR, { recursive: true });

const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: SECRET,
    SHIPROCKET_BASE_URL: fakeBase,
    SHIPROCKET_EMAIL: "api@test.local",
    SHIPROCKET_PASSWORD: FAKE_SHIPROCKET_PASSWORD,
    COURIER_LIVE_ENABLED: "1",
    SHIPROCKET_WEBHOOK_TOKEN: WEBHOOK_SECRET,
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let beErr = "";
be.stderr.on("data", (chunk) => {
  beErr = (beErr + chunk.toString()).slice(-4000);
});

const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT");
  try {
    be.kill("SIGTERM");
  } catch {}
  process.exit(2);
}, 150000);

process.on("uncaughtException", (error) => {
  console.error(error?.stack || error);
  try {
    be.kill("SIGTERM");
  } catch {}
  process.exit(1);
});

async function api(method, endpoint, { token, body, headers } = {}) {
  const response = await fetch(BASE + endpoint, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(headers || {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => null);
  return { status: response.status, data };
}

let up = false;
for (let i = 0; i < 100 && !up && be.exitCode === null; i++) {
  try {
    up = (await fetch(`${BASE}/api/health`)).ok;
  } catch {}
  if (!up) await new Promise((resolve) => setTimeout(resolve, 200));
}
if (!up || be.exitCode !== null) {
  console.error(`BACKEND NOT USABLE (up=${up}, exit=${be.exitCode})\n${beErr}`);
  try {
    be.kill("SIGTERM");
  } catch {}
  await new Promise((resolve) => fake.close(resolve));
  process.exit(3);
}

const login = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const staff = login.data?.token;
ok("backend boots and superadmin logs in", Boolean(staff));

// ---------- sellers + products ----------
async function makeSeller({ name, shopName, mobile, email }) {
  const reg = await api("POST", "/api/sellers/register", {
    body: { name, shopName, mobile, email, password: "seller123" },
  });
  const sellerId = reg.data?.seller?.id;
  await api("PUT", `/api/admin/sellers/${sellerId}/kyc`, {
    token: staff,
    body: { kycStatus: "Approved" },
  });
  const sellerLogin = await api("POST", "/api/sellers/login", {
    body: { mobile, password: "seller123" },
  });
  const sellerToken = sellerLogin.data?.token;
  const tax = await onboardGstSeller(api, { sellerToken, staffToken: staff });
  const product = await api("POST", "/api/sellers/products", {
    token: sellerToken,
    body: {
      name: `${shopName} Product`,
      category: "Fashion",
      price: "₹500",
      images: ["https://cdn.example.com/courier.jpg"],
    },
  });
  const productId = product.data?.product?.id;
  await api("PUT", `/api/admin/products/${productId}/approve`, { token: staff });
  return { sellerId, sellerToken, productId, tax };
}

const sellerA = await makeSeller({
  name: "Courier Seller A",
  shopName: "Shop A",
  mobile: "9876501111",
  email: "seller-a@test.local",
});
const sellerB = await makeSeller({
  name: "Courier Seller B",
  shopName: "Shop B",
  mobile: "9876502222",
  email: "seller-b@test.local",
});
ok(
  "two GST-ready sellers and approved products seeded",
  Boolean(sellerA.productId && sellerB.productId && sellerA.tax?.ok && sellerB.tax?.ok),
  { a: sellerA.tax, b: sellerB.tax }
);

// Save distinct seller pickup addresses for multi-seller booking.
await api("PUT", "/api/sellers/courier/pickup", {
  token: sellerA.sellerToken,
  body: {
    contactName: "Seller A",
    phone: "9876501111",
    address: "1 Seller A Warehouse, Lucknow",
    city: "Lucknow",
    state: "Uttar Pradesh",
    pincode: "226001",
    providerLocationName: "Primary",
  },
});
await api("PUT", "/api/sellers/courier/pickup", {
  token: sellerB.sellerToken,
  body: {
    contactName: "Seller B",
    phone: "9876502222",
    address: "2 Seller B Warehouse, Lucknow",
    city: "Lucknow",
    state: "Uttar Pradesh",
    pincode: "226001",
    providerLocationName: "Primary",
  },
});

await api("POST", "/api/customers/register", {
  body: { name: "Courier Buyer", mobile: "9876503333", email: "buyer@test.local", password: "buyer1234" },
});
const buyerLogin = await api("POST", "/api/customers/login", {
  body: { mobile: "9876503333", password: "buyer1234" },
});
const buyer = buyerLogin.data?.token;

const quote = await api("POST", "/api/orders/quote", {
  token: buyer,
  body: {
    items: [
      { productId: sellerA.productId, quantity: 1 },
      { productId: sellerB.productId, quantity: 1 },
    ],
    state: "Uttar Pradesh",
    deliveryMethod: "Standard",
  },
});
const orderRes = await api("POST", "/api/orders", {
  token: buyer,
  body: {
    items: [
      { productId: sellerA.productId, quantity: 1 },
      { productId: sellerB.productId, quantity: 1 },
    ],
    address: "12 Multi Seller Lane, Lucknow",
    phone: "9876503333",
    state: "Uttar Pradesh",
    city: "Lucknow",
    pincode: "226001",
    paymentMethod: "COD",
    clientGrandTotal: quote.data?.quote?.grandTotal,
  },
});
const orderId = orderRes.data?.order?.id;
const totalBefore = Number(orderRes.data?.order?.totalAmount);
const chargesBefore = orderRes.data?.order?.chargesJson;
ok("multi-seller COD order placed", orderRes.status === 201 && Boolean(orderId), orderRes.data);

// ---------- partner status / rules ----------
const partnerList = await api("GET", "/api/admin/courier-partners", { token: staff });
const partners = partnerList.data?.partners || [];
const shiprocket = partners.find((partner) => partner.code === "SHIPROCKET");
const indiaPost = partners.find((partner) => partner.code === "INDIA_POST");
const delhivery = partners.find((partner) => partner.code === "DELHIVERY");
const xpressbees = partners.find((partner) => partner.code === "XPRESSBEES");
ok(
  "all six partner adapters are seeded",
  Boolean(shiprocket && indiaPost && delhivery && xpressbees && partners.find((p) => p.code === "EKART") && partners.find((p) => p.code === "DTDC")),
  partners.map((p) => p.code)
);
ok(
  "Shiprocket reports live mode with env-only credentials",
  shiprocket?.apiStatus?.mode === "live" && shiprocket?.apiStatus?.configured === true,
  shiprocket?.apiStatus
);
ok(
  "India Post is honestly Manual / Not Configured",
  indiaPost?.apiStatus?.mode === "manual" && indiaPost?.apiStatus?.hasApi === false,
  indiaPost?.apiStatus
);
ok(
  "India Post contractual onboarding requirements are recorded",
  (indiaPost?.apiStatus?.onboarding?.requirements || []).some((item) => /customer id/i.test(item)) &&
    (indiaPost?.apiStatus?.onboarding?.requirements || []).some((item) => /contract/i.test(item)),
  indiaPost?.apiStatus?.onboarding
);

await api("PUT", `/api/admin/courier-partners/${shiprocket.id}`, {
  token: staff,
  body: {
    enabled: true,
    codAvailable: true,
    serviceablePincodes: ["226001"],
    baseRate: 40,
    perKgRate: 20,
    codCharge: 5,
    pickupLocation: "Primary",
    pickupPincode: "226001",
    maxWeightKg: 20,
    maxCodAmount: 50000,
  },
});
const statusAfter = await api("GET", "/api/admin/courier/api-status", { token: staff });
const statusText = JSON.stringify(statusAfter.data);
ok("API status never returns secret values", !statusText.includes(FAKE_SHIPROCKET_PASSWORD) && !statusText.includes(WEBHOOK_SECRET));
const testConnection = await api("POST", `/api/admin/courier/api/test/${shiprocket.id}`, { token: staff });
ok("live Shiprocket authentication test passes", testConnection.data?.result?.ok === true, testConnection.data);

// ---------- buyer serviceability ----------
const service = await api("POST", "/api/courier/serviceability", {
  body: { pincode: "226001", weightKg: 0.5, cod: true, declaredValue: 500 },
});
ok(
  "public PIN serviceability returns live Shiprocket rates",
  service.status === 200 &&
    service.data?.serviceable === true &&
    service.data?.quotes?.some((row) => row.source === "shiprocket_live"),
  service.data
);
ok(
  "best courier is the cheapest live option with ETA",
  service.data?.recommended?.courierCompanyId === "22" &&
    Number(service.data?.recommended?.rate) === 55 &&
    service.data?.recommended?.estimatedDeliveryDays === 3,
  service.data?.recommended
);
ok(
  "public serviceability response leaks no credentials",
  !JSON.stringify(service.data).includes(FAKE_SHIPROCKET_PASSWORD) &&
    !JSON.stringify(service.data).includes(WEBHOOK_SECRET)
);

// ---------- multi-seller groups ----------
const groupsRes = await api("GET", `/api/admin/orders/${orderId}/shipment-groups`, { token: staff });
const groups = groupsRes.data?.groups || [];
ok(
  "multi-seller order is split into two seller groups",
  groups.length === 2 &&
    groups[0].sellerId !== groups[1].sellerId &&
    groups.every((group) => group.pickup?.pincode === "226001"),
  groups.map((group) => ({ seller: group.sellerName, pickup: group.pickup }))
);

const quoteGroup = await api("POST", `/api/admin/orders/${orderId}/shipments/quote`, {
  token: staff,
  body: {
    sellerId: groups[0].sellerId,
    package: { weightKg: 0.7, length: 12, breadth: 10, height: 6 },
  },
});
ok(
  "admin rate comparison uses live Shiprocket option for the seller group",
  quoteGroup.status === 200 &&
    quoteGroup.data?.recommended?.partnerCode === "SHIPROCKET" &&
    quoteGroup.data?.recommended?.source === "shiprocket_live",
  quoteGroup.data
);

// ---------- live bookings ----------
const bookA = await api("POST", `/api/admin/orders/${orderId}/shipments`, {
  token: staff,
  body: {
    sellerId: groups[0].sellerId,
    courierPartnerId: shiprocket.id,
    courierCompanyId: "22",
    package: { weightKg: 0.7, length: 12, breadth: 10, height: 6 },
    rate: 55,
    estimatedDeliveryDays: 3,
    estimatedDeliveryDate: "2026-11-15",
    requestPickup: true,
    generateLabel: true,
  },
});
const shipmentA = bookA.data?.shipment;
if (bookA.status !== 201 && beErr) console.error("BOOKING BACKEND STDERR:\n" + beErr);
ok(
  "live Shiprocket shipment A creates AWB + label + manifest + pickup",
  bookA.status === 201 &&
    shipmentA?.mode === "live" &&
    /^SRTEST/.test(shipmentA?.awbNumber || "") &&
    Boolean(shipmentA?.labelUrl) &&
    Boolean(shipmentA?.manifestUrl) &&
    Boolean(shipmentA?.pickupToken),
  bookA.data
);
ok(
  "booking response exposes no credentials",
  !JSON.stringify(bookA.data).includes(FAKE_SHIPROCKET_PASSWORD) &&
    !JSON.stringify(bookA.data).includes(WEBHOOK_SECRET)
);

const bookB = await api("POST", `/api/admin/orders/${orderId}/shipments`, {
  token: staff,
  body: {
    sellerId: groups[1].sellerId,
    courierPartnerId: shiprocket.id,
    courierCompanyId: "22",
    package: { weightKg: 0.7, length: 12, breadth: 10, height: 6 },
    rate: 55,
    requestPickup: false,
    generateLabel: false,
  },
});
ok(
  "second seller gets a separate live shipment/AWB",
  bookB.status === 201 &&
    bookB.data?.shipment?.sellerId === groups[1].sellerId &&
    bookB.data?.shipment?.awbNumber !== shipmentA?.awbNumber,
  bookB.data
);

const duplicate = await api("POST", `/api/admin/orders/${orderId}/shipments`, {
  token: staff,
  body: {
    sellerId: groups[0].sellerId,
    courierPartnerId: shiprocket.id,
    courierCompanyId: "22",
    package: { weightKg: 0.7 },
  },
});
ok("duplicate active shipment is rejected", duplicate.status === 409, duplicate.status);

const adminOrderAfter = (await api("GET", "/api/admin/orders", { token: staff })).data?.orders?.find(
  (order) => order.id === orderId
);
ok(
  "courier bookings did NOT change totals/payment/order status",
  Number(adminOrderAfter?.totalAmount) === totalBefore &&
    adminOrderAfter?.paymentStatus === "Pending" &&
    adminOrderAfter?.chargesJson === chargesBefore &&
    adminOrderAfter?.status === "Pending",
  {
    total: adminOrderAfter?.totalAmount,
    payment: adminOrderAfter?.paymentStatus,
    status: adminOrderAfter?.status,
  }
);

const buyerOrders = await api("GET", "/api/customer/orders", { token: buyer });
const buyerOrder = buyerOrders.data?.orders?.find((order) => order.id === orderId);
ok(
  "buyer sees both couriers, AWBs, ETA and seller-wise shipments",
  buyerOrder?.courierTracking?.shipments?.length === 2 &&
    buyerOrder.courierTracking.shipments.every((row) => row.awbNumber && row.courierStatus) &&
    buyerOrder.courierTracking.shipments.every((row) => row.estimatedDeliveryDate || row.estimatedDeliveryDays),
  buyerOrder?.courierTracking
);
ok(
  "buyer tracking does not expose provider ids, pickup contact or secrets",
  !JSON.stringify(buyerOrder?.courierTracking).includes("providerShipmentId") &&
    !JSON.stringify(buyerOrder?.courierTracking).includes(FAKE_SHIPROCKET_PASSWORD) &&
    !JSON.stringify(buyerOrder?.courierTracking).includes("9876501111")
);

// ---------- shipment actions ----------
const track = await api("POST", `/api/admin/courier/shipments/${shipmentA?.id || 0}/action`, {
  token: staff,
  body: { action: "track" },
});
ok(
  "live tracking refresh appends real scan history",
  track.status === 200 &&
    track.data?.shipment?.courierStatus === "In Transit" &&
    track.data?.shipment?.history?.some((entry) => entry.status === "IN TRANSIT"),
  track.data
);

const label = await api("POST", `/api/admin/courier/shipments/${shipmentA?.id || 0}/action`, {
  token: staff,
  body: { action: "label" },
});
ok("live label action returns a label URL", label.status === 200 && Boolean(label.data?.shipment?.labelUrl), label.data);

const manifest = await api("POST", `/api/admin/courier/shipments/${shipmentA?.id || 0}/action`, {
  token: staff,
  body: { action: "manifest" },
});
ok("live manifest action returns a manifest URL", manifest.status === 200 && Boolean(manifest.data?.shipment?.manifestUrl), manifest.data);

const pickup = await api("POST", `/api/admin/courier/shipments/${shipmentA?.id || 0}/action`, {
  token: staff,
  body: { action: "pickup" },
});
ok("live pickup request returns a pickup token", pickup.status === 200 && Boolean(pickup.data?.shipment?.pickupToken), pickup.data);

const ndr = await api("POST", `/api/admin/courier/shipments/${shipmentA?.id || 0}/action`, {
  token: staff,
  body: { action: "ndr", ndrAction: "reattempt", remarks: "Customer unreachable" },
});
ok("NDR reattempt is recorded", ndr.status === 200 && ndr.data?.shipment?.ndrStatus === "reattempt", ndr.data);

const rto = await api("POST", `/api/admin/courier/shipments/${bookB.data?.shipment?.id || 0}/action`, {
  token: staff,
  body: { action: "rto" },
});
ok("RTO action updates shipment state", rto.status === 200 && rto.data?.shipment?.rtoStatus === "RTO Initiated", rto.data);

const buyerAfterRto = (await api("GET", "/api/customer/orders", { token: buyer })).data?.orders?.find(
  (order) => order.id === orderId
);
const rtoShipment = buyerAfterRto?.courierTracking?.shipments?.find(
  (row) => row.awbNumber === bookB.data?.shipment?.awbNumber
);
ok(
  "buyer sees return/RTO tracking for the affected shipment",
  rtoShipment?.returnStatus === "RTO Initiated",
  rtoShipment
);

const cancel = await api("POST", `/api/admin/courier/shipments/${bookB.data?.shipment?.id || 0}/action`, {
  token: staff,
  body: { action: "cancel" },
});
ok("cancellation updates shipment state", cancel.status === 200 && cancel.data?.shipment?.courierStatus === "Cancelled", cancel.data);

// ---------- webhook ----------
const webhookBody = {
  awb: shipmentA?.awbNumber || "NONE",
  courier_name: "Mock Express",
  current_status: "DELIVERED",
  current_timestamp: "2026-11-12 12:00:00",
  sr_order_id: 9000,
  scans: [
    {
      date: "2026-11-12 12:00:00",
      status: "DEL",
      activity: "Delivered to buyer",
      location: "Lucknow",
      "sr-status-label": "DELIVERED",
    },
  ],
};
const badWebhook = await api("POST", "/api/courier/webhook/shiprocket", {
  body: webhookBody,
  headers: { "x-api-key": "wrong-token" },
});
ok("webhook rejects an invalid token", badWebhook.status === 401, badWebhook.status);

const webhook = await api("POST", "/api/courier/webhook/shiprocket", {
  body: webhookBody,
  headers: { "x-api-key": WEBHOOK_SECRET },
});
ok("signed Shiprocket webhook updates the shipment", webhook.status === 200 && webhook.data?.matched === true, webhook.data);

const webhookAgain = await api("POST", "/api/courier/webhook/shiprocket", {
  body: webhookBody,
  headers: { "x-api-key": WEBHOOK_SECRET },
});
ok("duplicate webhook is idempotent", webhookAgain.status === 200 && webhookAgain.data?.duplicate === true, webhookAgain.data);

const buyerAfterWebhook = (await api("GET", "/api/customer/orders", { token: buyer })).data?.orders?.find(
  (order) => order.id === orderId
);
const deliveredShipment = buyerAfterWebhook?.courierTracking?.shipments?.find(
  (row) => row.awbNumber === shipmentA.awbNumber
);
ok(
  "buyer tracking shows the delivered webhook state",
  deliveredShipment?.courierStatus === "Delivered",
  deliveredShipment
);

// ---------- manual partner booking ----------
await api("PUT", `/api/admin/courier-partners/${indiaPost.id}`, {
  token: staff,
  body: {
    enabled: true,
    codAvailable: true,
    serviceablePincodes: ["226001"],
    baseRate: 30,
    perKgRate: 10,
    codCharge: 5,
  },
});
const order2Quote = await api("POST", "/api/orders/quote", {
  token: buyer,
  body: {
    items: [{ productId: sellerA.productId, quantity: 1 }],
    state: "Uttar Pradesh",
    deliveryMethod: "Standard",
  },
});
const order2Res = await api("POST", "/api/orders", {
  token: buyer,
  body: {
    items: [{ productId: sellerA.productId, quantity: 1 }],
    address: "13 Manual Lane, Lucknow",
    phone: "9876503333",
    state: "Uttar Pradesh",
    city: "Lucknow",
    pincode: "226001",
    paymentMethod: "COD",
    clientGrandTotal: order2Quote.data?.quote?.grandTotal,
  },
});
const order2 = order2Res.data?.order?.id;
const groups2 = (await api("GET", `/api/admin/orders/${order2}/shipment-groups`, { token: staff })).data?.groups || [];
const manualQuote = await api("POST", `/api/admin/orders/${order2}/shipments/quote`, {
  token: staff,
  body: { sellerId: groups2[0]?.sellerId, package: { weightKg: 1 } },
});
const manualOption = (manualQuote.data?.quotes || []).find((row) => row.partnerCode === "INDIA_POST");
ok(
  "manual partner produces a clearly labelled configured estimate",
  manualOption?.source === "configured_rule" && manualOption?.mode === "manual",
  manualOption
);
const manualBook = await api("POST", `/api/admin/orders/${order2}/shipments`, {
  token: staff,
  body: {
    sellerId: groups2[0]?.sellerId,
    courierPartnerId: indiaPost.id,
    package: { weightKg: 1, length: 10, breadth: 10, height: 5 },
    awbNumber: "IP-MANUAL-123",
    shippingLabelRef: "IP-LBL-1",
  },
});
ok(
  "manual India Post booking records the real AWB without a fake API call",
  manualBook.status === 201 &&
    manualBook.data?.shipment?.mode === "manual" &&
    manualBook.data?.shipment?.awbNumber === "IP-MANUAL-123",
  manualBook.data
);

// ---------- seller scoping ----------
const sellerGroups = await api("GET", `/api/sellers/orders/${orderId}/shipment-groups`, {
  token: sellerA.sellerToken,
});
ok(
  "seller sees only its own shipment group",
  sellerGroups.status === 200 &&
    sellerGroups.data?.groups?.length === 1 &&
    sellerGroups.data.groups[0].sellerId === sellerA.sellerId,
  sellerGroups.data
);
const sellerQuote = await api("POST", `/api/sellers/orders/${order2}/shipments/quote`, {
  token: sellerA.sellerToken,
  body: { package: { weightKg: 1 } },
});
ok("seller can compare courier options for own items", sellerQuote.status === 200 && Boolean(sellerQuote.data?.recommended), sellerQuote.data);
const sellerAdmin = await api("GET", `/api/admin/courier/shipments`, { token: sellerA.sellerToken });
ok("seller token cannot read the admin shipment list", sellerAdmin.status === 403, sellerAdmin.status);

// ---------- failure scenario ----------
const failQuote = await api("POST", "/api/orders/quote", {
  token: buyer,
  body: {
    items: [{ productId: sellerA.productId, quantity: 1 }],
    state: "Uttar Pradesh",
    deliveryMethod: "Standard",
  },
});
const failOrderRes = await api("POST", "/api/orders", {
  token: buyer,
  body: {
    items: [{ productId: sellerA.productId, quantity: 1 }],
    address: "FAIL address for simulated courier rejection, Lucknow",
    phone: "9876503333",
    state: "Uttar Pradesh",
    city: "Lucknow",
    pincode: "226001",
    paymentMethod: "COD",
    clientGrandTotal: failQuote.data?.quote?.grandTotal,
  },
});
const failOrder = failOrderRes.data?.order?.id;
const failGroups = (await api("GET", `/api/admin/orders/${failOrder}/shipment-groups`, { token: staff })).data?.groups || [];
const failBook = await api("POST", `/api/admin/orders/${failOrder}/shipments`, {
  token: staff,
  body: {
    sellerId: failGroups[0]?.sellerId,
    courierPartnerId: shiprocket.id,
    courierCompanyId: "22",
    package: { weightKg: 0.5 },
  },
});
ok(
  "live booking failure is returned honestly with no fake AWB",
  failBook.status === 502 && /rejection|failed|address/i.test(failBook.data?.message || ""),
  failBook.data
);
const failShipments = await api("GET", `/api/admin/courier/shipments?orderId=${failOrder}`, { token: staff });
ok("failed booking created no shipment row", (failShipments.data?.shipments || []).length === 0, failShipments.data);

// ---------- summary ----------
console.log(`\n${passed} passed, ${failed} failed`);
if (failed) console.log("Failures:\n - " + failures.join("\n - "));
console.log(`fake Shiprocket calls: ${fakeCalls.length}`);
if (failed && beErr) console.error("BACKEND STDERR (tail):\n" + beErr);
clearTimeout(watchdog);
be.kill("SIGTERM");
await new Promise((resolve) => fake.close(resolve));
process.exit(failed ? 1 : 0);
