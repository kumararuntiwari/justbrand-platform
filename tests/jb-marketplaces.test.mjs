// =====================================================
// JUSTBRAND — Amazon / Flipkart / Meesho / GlowRoad connectors
// =====================================================
// Spawns the REAL backend on a random port with a THROWAWAY database and
// a LOCAL fake provider server (no production/marketplace contact).
// Verifies:
//   • admin marketplace app credentials are encrypted at rest and never
//     returned (only hints / booleans)
//   • Amazon SP-API: LWA OAuth state → callback → encrypted refresh
//     token, SigV4-signed listings call, token refresh on expiry, 401
//     retry, approval gate, sync, margin applied once, stock failure
//     safety, live checkout re-check
//   • Flipkart: client_credentials token, listing search + SKU details,
//     token refresh on 401
//   • Meesho: API access required (no fake "working" integration), bulk
//     import fallback still available
//   • GlowRoad: API-key connector, key encrypted, unverified status,
//     disconnect clears credentials
//   • seller isolation, admin enable/disable, schedule, import limits
//
// Run: node tests/jb-marketplaces.test.mjs
// =====================================================

import { spawn } from "node:child_process";
import http from "node:http";
import { rmSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { onboardGstSeller } from "./support/mandatory-gst.js";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const DB_DIR = path.join(REPO_ROOT, "tests", ".tmp", "jb-marketplaces-db");
const PORT = Number(process.env.JB_TEST_PORT) || 4900 + Math.floor(Math.random() * 150);
const BASE = `http://127.0.0.1:${PORT}`;

const AMZ_CLIENT = "amz-client-id";
const AMZ_SECRET = "amz-client-secret";
const AWS_KEY = "AKIATESTKEY";
const AWS_SECRET = "aws-secret-key-value";
const GLOW_KEY = "glowroad-key-9876";

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

// ---------- fake marketplace provider ----------
let amazonAccessToken = "Atza|amazon-access-1";
let amazonRefreshCalls = 0;
let amazonCatalog = [
  {
    sku: "AMZ-1",
    summaries: [{ itemName: "Amazon Test Product", status: ["BUYABLE"], productType: "Electronics" }],
    attributes: {
      purchasable_offer: [{ our_price: [{ schedule: [{ value_with_tax: 1000 }] }] }],
      fulfillment_availability: [{ quantity: 5 }],
      main_product_image_locator: [{ media_location: "https://img.example.com/amz1.jpg" }],
      list_price: [{ value_with_tax: 1400 }],
    },
  },
  {
    sku: "AMZ-2",
    summaries: [{ itemName: "Amazon Zero Stock", status: ["BUYABLE"], productType: "Grocery" }],
    attributes: {
      purchasable_offer: [{ our_price: [{ schedule: [{ value_with_tax: 500 }] }] }],
      fulfillment_availability: [{ quantity: 0 }],
      main_product_image_locator: [{ media_location: "https://img.example.com/amz2.jpg" }],
    },
  },
];

let flipkartToken = "fk-token-1";
let flipkartTokenCalls = 0;
let flipkartListings = [
  {
    sku: "FK-1",
    product_name: "Flipkart Test Product",
    vertical: "Fashion",
    status: "ACTIVE",
    product_image_url: "https://img.example.com/fk1.jpg",
  },
];
let flipkartAttrs = { selling_price: "800", mrp: "1000", stock_count: "4", listing_status: "ACTIVE" };

let glowProducts = [
  {
    sku: "GLOW-1",
    name: "GlowRoad Test Product",
    category: "Home",
    price: 300,
    stock: 3,
    images: ["https://img.example.com/glow1.jpg"],
    status: "ACTIVE",
  },
];

let failMode = false;
let sawSigV4 = false;
let sawGlowKey = null;
let lastAmazonAccessToken = null;

const provider = http.createServer(async (req, res) => {
  const url = new URL(req.url, "http://localhost");
  const send = (status, payload) => {
    res.writeHead(status, { "content-type": "application/json" });
    res.end(JSON.stringify(payload));
  };

  let body = "";
  for await (const chunk of req) body += chunk;

  if (failMode) return send(500, { errors: [{ message: "provider down" }] });

  // LWA token endpoint (Amazon)
  if (url.pathname === "/auth/o2/token") {
    const params = new URLSearchParams(body);
    if (params.get("client_id") !== AMZ_CLIENT || params.get("client_secret") !== AMZ_SECRET) {
      return send(401, { error: "invalid_client", error_description: "bad LWA credentials" });
    }

    if (params.get("grant_type") === "authorization_code") {
      if (params.get("code") !== "amz-auth-code") return send(400, { error: "invalid_grant" });
      amazonAccessToken = "Atza|amazon-access-1";
      return send(200, {
        access_token: amazonAccessToken,
        refresh_token: "Atzr|amazon-refresh-1",
        expires_in: 3600,
        token_type: "bearer",
      });
    }

    if (params.get("grant_type") === "refresh_token") {
      if (params.get("refresh_token") !== "Atzr|amazon-refresh-1") {
        return send(400, { error: "invalid_grant" });
      }
      amazonRefreshCalls++;
      amazonAccessToken = `Atza|amazon-access-${amazonRefreshCalls + 1}`;
      return send(200, {
        access_token: amazonAccessToken,
        expires_in: 3600,
        token_type: "bearer",
      });
    }

    return send(400, { error: "unsupported_grant_type" });
  }

  // Amazon SP-API listings
  if (url.pathname.startsWith("/listings/2021-08-01/items/")) {
    const auth = String(req.headers.authorization || "");
    if (!auth.startsWith("AWS4-HMAC-SHA256 Credential=" + AWS_KEY + "/")) {
      return send(403, { errors: [{ message: "invalid AWS signature" }] });
    }
    if (req.headers["x-amz-access-token"] !== amazonAccessToken) {
      return send(401, { errors: [{ message: "invalid access token" }] });
    }
    sawSigV4 = true;
    lastAmazonAccessToken = req.headers["x-amz-access-token"];
    return send(200, { items: amazonCatalog, pagination: {} });
  }

  // Flipkart token endpoint
  if (url.pathname === "/oauth-service/oauth/token") {
    flipkartTokenCalls++;
    const basic = Buffer.from(`fk-app-id:fk-app-secret`).toString("base64");
    if (req.headers.authorization !== `Basic ${basic}`) {
      return send(401, { error: "invalid_client" });
    }
    return send(200, { access_token: flipkartToken, expires_in: 3600 });
  }

  // Flipkart listing search
  if (url.pathname === "/listings/v3/search") {
    if (req.headers.authorization !== `Bearer ${flipkartToken}`) {
      return send(401, { error: "unauthorized" });
    }
    return send(200, { totalListingsCount: flipkartListings.length, listingData: flipkartListings });
  }

  // Flipkart SKU listing details
  if (url.pathname.startsWith("/sellers/skus/")) {
    if (req.headers.authorization !== `Bearer ${flipkartToken}`) {
      return send(401, { error: "unauthorized" });
    }
    return send(200, {
      listingId: "LST1",
      skuId: decodeURIComponent(url.pathname.split("/")[3]),
      attributeValues: flipkartAttrs,
    });
  }

  // GlowRoad API-key endpoint
  if (url.pathname === "/glowroad/products") {
    sawGlowKey = req.headers["x-api-key"] || null;
    if (sawGlowKey !== GLOW_KEY) return send(401, { message: "invalid api key" });
    return send(200, { data: { products: glowProducts } });
  }

  return send(404, { message: "not found" });
});

await new Promise((resolve) => provider.listen(0, "127.0.0.1", resolve));
const PROVIDER_BASE = `http://127.0.0.1:${provider.address().port}`;

// ---------- backend ----------
try {
  if ((await fetch(`${BASE}/api/health`)).ok) {
    console.error(`PORT ${PORT} already serving — aborting`);
    provider.close();
    process.exit(4);
  }
} catch {}

const be = spawn(process.execPath, [path.join(REPO_ROOT, "backend", "server.js")], {
  cwd: DB_DIR,
  env: {
    ...process.env,
    PORT: String(PORT),
    JWT_SECRET: "jb-marketplace-test-secret",
    JB_CREDENTIAL_KEY: "jb-marketplace-credential-key",
    JB_CHECKOUT_REFRESH_TTL_MS: "0",
  },
  stdio: ["ignore", "pipe", "pipe"],
});
let beErr = "";
be.stderr.on("data", (d) => (beErr = (beErr + d.toString()).slice(-3000)));

const watchdog = setTimeout(() => {
  console.error("WATCHDOG TIMEOUT");
  try { be.kill("SIGKILL"); } catch {}
  try { provider.close(); } catch {}
  process.exit(2);
}, 150000);

function shutdown(code) {
  clearTimeout(watchdog);
  try { be.kill("SIGKILL"); } catch {}
  try { provider.close(); } catch {}
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
ok("backend boots with marketplace connectors", true);

const requireFromBackend = createRequire(path.join(REPO_ROOT, "backend", "db.js"));
const Database = requireFromBackend("better-sqlite3");
const rawDb = new Database(path.join(DB_DIR, "justbrand.db"), { readonly: true });

// ---------- accounts ----------
const staff = await api("POST", "/api/staff/login", {
  body: { username: "superadmin", password: "JustBrand@2026" },
});
const superTok = staff.data?.token;
ok("superadmin login", Boolean(superTok));

async function makeSeller(suffix, mobile) {
  const reg = await api("POST", "/api/sellers/register", {
    body: {
      name: `Market Seller ${suffix}`,
      shopName: `Market Shop ${suffix}`,
      mobile,
      email: `market${suffix}@x.com`,
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

const sellerA = await makeSeller("a", "9833300001");
const sellerB = await makeSeller("b", "9833300002");
ok("two approved sellers", Boolean(sellerA.token && sellerB.token));

await api("POST", "/api/customers/register", {
  body: { name: "Market Buyer", mobile: "9833300009", email: "mb@x.com", password: "buyer123" },
});
const customer = await api("POST", "/api/customers/login", {
  body: { mobile: "9833300009", password: "buyer123" },
});
const customerTok = customer.data?.token;
ok("customer ready", Boolean(customerTok));

// =====================================================
// 1. ADMIN PROVIDER CONFIG + ENCRYPTION
// =====================================================
console.log("\n# provider configuration");

const initialProviders = await api("GET", "/api/admin/marketplaces", { token: superTok });
ok("providers listed", initialProviders.data?.providers?.length === 4);
ok("Meesho is flagged API access required", initialProviders.data.providers.find((p) => p.key === "meesho")?.apiAccessRequired === true);
ok("GlowRoad is flagged unverified", initialProviders.data.providers.find((p) => p.key === "glowroad")?.verification === "unverified_partner");

const amazonApp = await api("PUT", "/api/admin/marketplaces/providers/amazon", {
  token: superTok,
  body: {
    enabled: true,
    credentials: {
      lwaClientId: AMZ_CLIENT,
      lwaClientSecret: AMZ_SECRET,
      awsAccessKeyId: AWS_KEY,
      awsSecretAccessKey: AWS_SECRET,
      lwaTokenUrl: `${PROVIDER_BASE}/auth/o2/token`,
      authorizeBaseUrl: `${PROVIDER_BASE}/apps/authorize/consent`,
    },
  },
});
ok("Amazon app credentials saved", amazonApp.status === 200 && amazonApp.data?.provider?.appConfigured === true, amazonApp.data);

const serialized = JSON.stringify(amazonApp.data);
ok("secrets are never returned to the client", !serialized.includes(AMZ_SECRET) && !serialized.includes(AWS_SECRET));

const rawAppRow = rawDb
  .prepare(`SELECT credentialsEnc FROM marketplace_providers WHERE provider = 'amazon'`)
  .get();
ok(
  "Amazon app credentials are AES-GCM encrypted at rest",
  Boolean(rawAppRow?.credentialsEnc?.startsWith("v1:")) &&
    !String(rawAppRow?.credentialsEnc).includes(AMZ_SECRET)
);

const flipkartApp = await api("PUT", "/api/admin/marketplaces/providers/flipkart", {
  token: superTok,
  body: {
    enabled: true,
    credentials: {
      flipkartAppId: "fk-app-id",
      flipkartAppSecret: "fk-app-secret",
      flipkartTokenUrl: `${PROVIDER_BASE}/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api`,
    },
  },
});
ok("Flipkart app credentials saved", flipkartApp.data?.provider?.appConfigured === true);

await api("PUT", "/api/admin/marketplaces/providers/glowroad", {
  token: superTok,
  body: { enabled: true },
});
ok("GlowRoad provider enabled", true);

const globalMargin = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "global", marginType: "percent", marginValue: 20 },
});
ok("global 20% margin configured for fallback providers", globalMargin.status === 200);

// =====================================================
// 2. AMAZON — CONFIG, OAUTH, TOKENS
// =====================================================
console.log("\n# Amazon SP-API");

const amazonSave = await api("PUT", "/api/sellers/marketplaces/amazon", {
  token: sellerA.token,
  body: {
    accountLabel: "Amazon India",
    externalSellerId: "A1SELLER",
    marketplaceId: "A21KJY",
    region: "na",
    baseUrl: PROVIDER_BASE,
    autoSync: true,
    syncFrequencyMinutes: 1440,
  },
});
const amazonId = amazonSave.data?.integration?.id;
ok("Amazon integration saved as Pending Approval", amazonSave.data?.integration?.status === "Pending Approval", amazonSave.data);
ok("Amazon has no mock access token before OAuth", amazonSave.data?.integration?.hasAccessToken === false);

const connect = await api("POST", "/api/sellers/marketplaces/amazon/connect", { token: sellerA.token });
ok(
  "Amazon connect returns the official authorize URL",
  connect.status === 200 && connect.data?.authorizeUrl?.includes("application_id=" + AMZ_CLIENT),
  connect.data
);
const authorizeUrl = new URL(connect.data.authorizeUrl);
const state = authorizeUrl.searchParams.get("state");
ok("OAuth state is generated", Boolean(state));

const badCallback = await fetch(`${BASE}/api/sellers/marketplaces/amazon/callback?state=bad&code=x`).then((r) => r.json());
ok("invalid OAuth state rejected", badCallback.success === false);

const callback = await fetch(
  `${BASE}/api/sellers/marketplaces/amazon/callback?state=${encodeURIComponent(state)}&code=amz-auth-code`
).then((r) => r.json());
ok("Amazon callback exchanges the code", callback.success === true, callback);

const amazonAfterCallback = (await api("GET", "/api/sellers/marketplaces", { token: sellerA.token })).data.providers.find(
  (p) => p.key === "amazon"
).integration;
ok("refresh token stored (boolean only)", amazonAfterCallback?.hasRefreshToken === true);
ok("access token stored with expiry", Boolean(amazonAfterCallback?.tokenExpiresAt));
ok("no secret/token leaked in the seller payload", !JSON.stringify(amazonAfterCallback).includes("Atzr|") && !JSON.stringify(amazonAfterCallback).includes("Atza|"));

const rawAmazon = rawDb
  .prepare(`SELECT credentialsEnc, accessTokenEnc FROM marketplace_integrations WHERE id = ?`)
  .get(amazonId);
ok(
  "Amazon refresh + access tokens encrypted at rest",
  rawAmazon?.credentialsEnc?.startsWith("v1:") &&
    rawAmazon?.accessTokenEnc?.startsWith("v1:") &&
    !String(rawAmazon.credentialsEnc).includes("Atzr|") &&
    !String(rawAmazon.accessTokenEnc).includes("Atza|")
);

const syncBeforeApproval = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
ok(
  "sync blocked until admin approval",
  syncBeforeApproval.status === 403 && syncBeforeApproval.data?.code === "INTEGRATION_NOT_APPROVED"
);

// =====================================================
// 3. MARGIN RULE (marketplace scope) + APPROVAL + SYNC
// =====================================================
console.log("\n# marketplace margin + sync");

const marginRule = await api("PUT", "/api/admin/margins", {
  token: superTok,
  body: { scopeType: "marketplace", scopeId: amazonId, marginType: "percent", marginValue: 10 },
});
ok("marketplace margin rule saved", marginRule.status === 200 && marginRule.data?.rule?.scopeKey === `marketplace:${amazonId}`, marginRule.data);

const approve = await api("POST", `/api/admin/marketplaces/${amazonId}/approve`, { token: superTok });
ok("admin approves Amazon connection", approve.status === 200, approve.data);

const sync1 = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
ok("Amazon sync succeeds", sync1.data?.result?.status === "success", sync1.data);
ok("Amazon listings created Pending products", sync1.data?.result?.created === 2, sync1.data?.result);
ok("listings call was SigV4 signed", sawSigV4 === true);
ok("Amazon access token was used", lastAmazonAccessToken === amazonAccessToken);

const productsA = (await api("GET", "/api/admin/products", { token: superTok })).data.products;
const amz1 = productsA.find((p) => p.sku === "AMZ-1");
const amz2 = productsA.find((p) => p.sku === "AMZ-2");

ok("Amazon product is Pending (approval gate kept)", amz1?.status === "Pending");
ok("marketplace margin: ₹1,000 + 10% = ₹1,100", Number(amz1?.price) === 1100, amz1?.price);
ok("source price kept separately", Number(amz1?.supplierPrice) === 1000);
ok("zero stock listing is out of stock", amz2?.inStock === false && Number(amz2?.stock) === 0);

const sync2 = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
const amz1Again = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find((p) => p.sku === "AMZ-1");
ok("re-sync does not compound markup", Number(amz1Again?.price) === 1100, amz1Again?.price);
ok("second sync updates instead of duplicating", sync2.data?.result?.created === 0 && sync2.data?.result?.updated === 2);

// Import limit applies to marketplace sync too.
await api("PUT", "/api/admin/import-settings", { token: superTok, body: { maxSyncItems: 1 } });
const limited = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
ok("admin import limit caps marketplace sync", limited.data?.result?.fetched === 1, limited.data?.result?.fetched);
await api("PUT", "/api/admin/import-settings", { token: superTok, body: { maxSyncItems: 500 } });

// =====================================================
// 4. TOKEN REFRESH + API FAILURE SAFETY
// =====================================================
console.log("\n# token refresh + failure safety");

const refreshBefore = amazonRefreshCalls;
rawDb.close();
const writeDb = new Database(path.join(DB_DIR, "justbrand.db"));
writeDb
  .prepare(`UPDATE marketplace_integrations SET tokenExpiresAt = ? WHERE id = ?`)
  .run(new Date(Date.now() - 60_000).toISOString(), amazonId);
writeDb.close();

const refreshSync = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
ok("expired access token is refreshed with the stored refresh token", amazonRefreshCalls > refreshBefore, {
  before: refreshBefore,
  after: amazonRefreshCalls,
});
ok("sync succeeds after token refresh", refreshSync.data?.result?.status === "success");

// Approve the product so the buyer flow is reachable.
await api("PUT", `/api/admin/products/${amz1.id}/approve`, { token: superTok });

const publicProduct = (await fetch(`${BASE}/api/products`).then((r) => r.json())).find((p) => p.id === amz1.id);
ok("buyer payload hides source price + markup", publicProduct && !("supplierPrice" in publicProduct) && !("markupAmount" in publicProduct));
ok("buyer sees the approved Amazon product in stock", publicProduct?.inStock === true);

failMode = true;
const failedSync = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
ok("API failure produces a failed sync", failedSync.data?.result?.status === "failed", failedSync.data?.result);
ok("failed sync schedules a retry", failedSync.data?.result?.retryScheduled === true);

const afterFail = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find((p) => p.sku === "AMZ-1");
ok("failed marketplace sync marks stock unverified", afterFail?.stockUnverified === true);

const publicAfterFail = (await fetch(`${BASE}/api/products`).then((r) => r.json())).find((p) => p.id === amz1.id);
ok("unverified marketplace stock is not shown as available", publicAfterFail?.inStock === false);

const blockedOrder = await api("POST", "/api/orders", {
  token: customerTok,
  body: {
    items: [{ productId: amz1.id, quantity: 1 }],
    address: "12 Test Street, Andheri West, Mumbai",
    phone: "9833300009",
    city: "Mumbai",
    state: "Maharashtra",
    pincode: "400053",
  },
});
ok(
  "order refused while marketplace stock is unconfirmed",
  blockedOrder.status === 409 && blockedOrder.data?.code === "STOCK_UNVERIFIED",
  blockedOrder.data
);

failMode = false;
const recovered = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerA.token });
ok("recovery sync succeeds", recovered.data?.result?.status === "success");
const afterRecover = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find((p) => p.sku === "AMZ-1");
ok("successful sync clears unverified stock", afterRecover?.stockUnverified === false);

// =====================================================
// 5. FLIPKART
// =====================================================
console.log("\n# Flipkart");

const fkSave = await api("PUT", "/api/sellers/marketplaces/flipkart", {
  token: sellerA.token,
  body: {
    accountLabel: "Flipkart Seller",
    externalSellerId: "FKSELLER",
    baseUrl: PROVIDER_BASE,
    autoSync: true,
  },
});
const fkId = fkSave.data?.integration?.id;
ok("Flipkart integration saved", fkSave.data?.integration?.status === "Pending Approval");

const fkConnect = await api("POST", "/api/sellers/marketplaces/flipkart/connect", { token: sellerA.token });
ok("Flipkart token generated server-side", fkConnect.status === 200 && Boolean(fkConnect.data?.tokenPreview), fkConnect.data);
ok("Flipkart token preview is masked", !JSON.stringify(fkConnect.data).includes("fk-token-1"));

await api("POST", `/api/admin/marketplaces/${fkId}/approve`, { token: superTok });

const fkSync = await api("POST", "/api/sellers/marketplaces/flipkart/sync", { token: sellerA.token });
ok("Flipkart sync succeeds", fkSync.data?.result?.status === "success", fkSync.data);
ok("Flipkart listing imported", fkSync.data?.result?.created === 1);

const fkProduct = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find((p) => p.sku === "FK-1");
ok("Flipkart global margin applied (₹800 + 20% = ₹960)", Number(fkProduct?.price) === 960, fkProduct?.price);
ok("Flipkart stock synced", Number(fkProduct?.stock) === 4);

// Force the access token to be rejected → connector refreshes once and retries.
const fkDb = new Database(path.join(DB_DIR, "justbrand.db"));
fkDb.prepare(`UPDATE marketplace_integrations SET tokenExpiresAt = ? WHERE id = ?`).run(
  new Date(Date.now() + 3600_000).toISOString(),
  fkId
);
fkDb.close();
flipkartToken = "fk-token-2";
const tokenCallsBefore = flipkartTokenCalls;

const fkRetry = await api("POST", "/api/sellers/marketplaces/flipkart/sync", { token: sellerA.token });
ok("Flipkart 401 triggers a token refresh and retry", fkRetry.data?.result?.status === "success" && flipkartTokenCalls > tokenCallsBefore, {
  status: fkRetry.data?.result?.status,
  calls: flipkartTokenCalls - tokenCallsBefore,
});

// =====================================================
// 6. GLOWROAD
// =====================================================
console.log("\n# GlowRoad");

const glowSave = await api("PUT", "/api/sellers/marketplaces/glowroad", {
  token: sellerA.token,
  body: {
    accountLabel: "GlowRoad Shop",
    baseUrl: `${PROVIDER_BASE}/glowroad`,
    listingsPath: "/products",
    apiKey: GLOW_KEY,
    autoSync: true,
  },
});
const glowId = glowSave.data?.integration?.id;
ok("GlowRoad API-key connector saved", glowSave.data?.integration?.status === "Pending Approval");
ok("GlowRoad key returned only as a hint", glowSave.data?.integration?.apiKeyHint === "••••9876" && !JSON.stringify(glowSave.data).includes(GLOW_KEY));

const glowDb = new Database(path.join(DB_DIR, "justbrand.db"), { readonly: true });
const glowRow = glowDb.prepare(`SELECT credentialsEnc FROM marketplace_integrations WHERE id = ?`).get(glowId);
glowDb.close();
ok("GlowRoad API key encrypted at rest", glowRow?.credentialsEnc?.startsWith("v1:") && !String(glowRow.credentialsEnc).includes(GLOW_KEY));

const glowConnect = await api("POST", "/api/sellers/marketplaces/glowroad/connect", { token: sellerA.token });
ok("GlowRoad connect tests the endpoint + key", glowConnect.status === 200 && sawGlowKey === GLOW_KEY, glowConnect.data);
ok("GlowRoad stays marked unverified", Boolean(glowConnect.data?.message?.match(/UNVERIFIED/i)));

await api("POST", `/api/admin/marketplaces/${glowId}/approve`, { token: superTok });
const glowSync = await api("POST", "/api/sellers/marketplaces/glowroad/sync", { token: sellerA.token });
ok("GlowRoad sync succeeds against the authorized endpoint", glowSync.data?.result?.status === "success", glowSync.data);
const glowProduct = (await api("GET", "/api/admin/products", { token: superTok })).data.products.find((p) => p.sku === "GLOW-1");
ok("GlowRoad product priced with the global margin", Number(glowProduct?.price) === 360, glowProduct?.price);

// =====================================================
// 7. MEESHO — API ACCESS REQUIRED
// =====================================================
console.log("\n# Meesho");

const meeshoSave = await api("PUT", "/api/sellers/marketplaces/meesho", {
  token: sellerA.token,
  body: { accountLabel: "Meesho" },
});
ok("Meesho cannot be connected as an API", meeshoSave.status === 409 && meeshoSave.data?.code === "API_ACCESS_REQUIRED");

const meeshoConnect = await api("POST", "/api/sellers/marketplaces/meesho/connect", { token: sellerA.token });
ok("Meesho connect explains API access is required", meeshoConnect.status === 409 && /bulk CSV/i.test(meeshoConnect.data?.message || ""));

const meeshoSync = await api("POST", "/api/sellers/marketplaces/meesho/sync", { token: sellerA.token });
ok("Meesho sync is never faked", meeshoSync.status >= 400);

const providerList = (await api("GET", "/api/sellers/marketplaces", { token: sellerA.token })).data.providers;
ok(
  "seller UI sees Meesho as apiAccessRequired",
  providerList.find((p) => p.key === "meesho")?.apiAccessRequired === true &&
    providerList.find((p) => p.key === "meesho")?.supportsSync === false
);

// Authorized bulk import fallback still works.
const templateRes = await fetch(`${BASE}/api/sellers/imports/template?format=csv`, {
  headers: { Authorization: `Bearer ${sellerA.token}` },
});
ok("authorized bulk CSV import fallback is available", templateRes.status === 200);

// =====================================================
// 8. ADMIN CONTROLS + ISOLATION
// =====================================================
console.log("\n# admin controls + isolation");

const adminList = await api("GET", "/api/admin/marketplaces", { token: superTok });
ok("admin sees integrations with seller names", adminList.data?.integrations?.some((row) => row.sellerName && row.provider === "amazon"));
ok("admin sees sync errors / status", adminList.data.integrations.every((row) => "lastSyncStatus" in row));

const disable = await api("PUT", "/api/admin/marketplaces/providers/flipkart", {
  token: superTok,
  body: { enabled: false },
});
ok("admin can disable a marketplace globally", disable.data?.provider?.enabled === false);

const disabledSync = await api("POST", "/api/sellers/marketplaces/flipkart/sync", { token: sellerA.token });
ok(
  "sync blocked while the marketplace is disabled",
  disabledSync.status === 403 && disabledSync.data?.code === "PROVIDER_DISABLED",
  disabledSync.data
);

await api("PUT", "/api/admin/marketplaces/providers/flipkart", { token: superTok, body: { enabled: true } });

const toggle = await api("POST", `/api/admin/marketplaces/${fkId}/toggle`, {
  token: superTok,
  body: { disabled: true },
});
ok("admin can disable one seller's connection", toggle.data?.integration?.adminDisabled === true);
const toggledSync = await api("POST", "/api/sellers/marketplaces/flipkart/sync", { token: sellerA.token });
ok("disabled connection cannot sync", toggledSync.data?.code === "INTEGRATION_DISABLED");
await api("POST", `/api/admin/marketplaces/${fkId}/toggle`, { token: superTok, body: { disabled: false } });

const sellerBList = await api("GET", "/api/sellers/marketplaces", { token: sellerB.token });
ok(
  "seller B sees no marketplace connection of seller A",
  sellerBList.data.providers.every((p) => !p.integration)
);
const sellerBSync = await api("POST", "/api/sellers/marketplaces/amazon/sync", { token: sellerB.token });
ok("seller B cannot sync seller A's Amazon connection", sellerBSync.status === 404);

const adminRuns = await api("GET", "/api/admin/marketplace-sync-runs", { token: superTok });
ok("admin sync history includes runs + errors", Array.isArray(adminRuns.data?.runs) && adminRuns.data.runs.length >= 3);

const sellerRuns = await api("GET", "/api/sellers/marketplaces/amazon/runs", { token: sellerA.token });
ok("seller sees only its own sync runs", sellerRuns.data?.runs?.every((run) => run.provider === "amazon"));

const marginPreview = await api("POST", "/api/admin/margins/preview", {
  token: superTok,
  body: { supplierPrice: 1000, category: "Electronics" },
});
ok("marketplace margin rules integrate with the existing preview", marginPreview.status === 200);

// =====================================================
// 9. SCHEDULE DEFAULTS
// =====================================================
console.log("\n# schedule");

const settings = (await api("GET", "/api/admin/import-settings", { token: superTok })).data.settings;
ok("default schedule 00:00 Asia/Kolkata still in place", settings.scheduleTime === "00:00" && settings.scheduleTimezone === "Asia/Kolkata");

const amazonRow = (await api("GET", "/api/admin/marketplaces", { token: superTok })).data.integrations.find(
  (row) => row.id === amazonId
);
const nextAt = new Date(amazonRow?.nextSyncAt || 0);
ok(
  "marketplace next run is 00:00 IST (18:30 UTC)",
  nextAt.getUTCHours() === 18 && nextAt.getUTCMinutes() === 30,
  amazonRow?.nextSyncAt
);

await api("PUT", "/api/admin/import-settings", { token: superTok, body: { scheduleTime: "21:30" } });
const amazonRow2 = (await api("GET", "/api/admin/marketplaces", { token: superTok })).data.integrations.find(
  (row) => row.id === amazonId
);
const nextAt2 = new Date(amazonRow2?.nextSyncAt || 0);
ok(
  "admin schedule change applies to marketplace sync (21:30 IST = 16:00 UTC)",
  nextAt2.getUTCHours() === 16 && nextAt2.getUTCMinutes() === 0,
  amazonRow2?.nextSyncAt
);

// =====================================================
// 10. DISCONNECT
// =====================================================
console.log("\n# disconnect");

const disconnect = await api("DELETE", "/api/sellers/marketplaces/glowroad", { token: sellerA.token });
ok("seller can disconnect a marketplace", disconnect.status === 200 && disconnect.data?.integration?.status === "Disconnected");
ok("disconnect clears stored credentials/tokens", disconnect.data?.integration?.hasCredentials === false && disconnect.data?.integration?.hasAccessToken === false);

const afterDisconnect = await api("POST", "/api/sellers/marketplaces/glowroad/sync", { token: sellerA.token });
ok("disconnected marketplace cannot sync", afterDisconnect.status === 403 || afterDisconnect.status === 404);

const productsStillThere = (await api("GET", "/api/admin/products", { token: superTok })).data.products.some(
  (p) => p.sku === "GLOW-1"
);
ok("disconnect keeps existing products in the catalog", productsStillThere);

const sellerBDisconnect = await api("DELETE", "/api/sellers/marketplaces/amazon", { token: sellerB.token });
ok("seller B cannot disconnect seller A's integration", sellerBDisconnect.status === 404);

shutdown(failed === 0 ? 0 : 1);
