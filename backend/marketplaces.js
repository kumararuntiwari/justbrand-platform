// =====================================================
// JUSTBRAND — MARKETPLACE CONNECTORS
// =====================================================
// Amazon SP-API, Flipkart Seller API, Meesho and GlowRoad.
//
// HONESTY RULES ENFORCED HERE:
//   • Amazon uses the OFFICIAL Selling Partner API (LWA OAuth + AWS
//     SigV4). Flipkart uses the OFFICIAL Seller API (client_credentials
//     token + documented listing endpoints). Both need real app
//     credentials + seller authorization, so they are reported as
//     "credentials required" until that exists — never as a demo.
//   • Meesho has NO public self-serve seller API. It is shown as
//     "API access required" and only the authorized bulk CSV/XLSX
//     import path is offered.
//   • GlowRoad has no public developer API either. Its connector is an
//     API-KEY connector that stays UNVERIFIED until GlowRoad issues a
//     key + endpoint.
//
// REUSE (no parallel business rules):
//   • credentials/tokens are AES-256-GCM encrypted with the SAME helper
//     as supplier integrations, and never returned to the client.
//   • pricing reuses the admin Profit Margin rules + the existing
//     calculateCustomerPricing (GST / platform / delivery exactly once).
//   • products are created Pending, SKU uniqueness and seller ownership
//     stay enforced, stock 0 = out of stock, failed API = unverified
//     stock (not sellable), schedule = admin's 00:00 IST default.

import express from "express";
import crypto from "node:crypto";

import db from "./db.js";
import { requireAuth, requireRole, requireType } from "./auth.js";
import {
  resolveProductGst,
  calculateCustomerPricing,
  validateProductImages,
} from "./business.js";
import {
  encryptSecret,
  decryptSecret,
  secretHint,
  computeMarkup,
  resolveMarginRule,
  computeNextSyncAt,
  getImportSettings,
  onScheduleChanged,
} from "./seller-imports.js";

export const marketplacesRouter = express.Router();

const MAX_RESPONSE_BYTES = 8 * 1024 * 1024;
const FETCH_TIMEOUT_MS = 20000;
const MAX_PAGES = 10;
const OAUTH_STATE_TTL_MS = 15 * 60 * 1000;

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function parsePrice(value) {
  const text = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseStock(value) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return { ok: true, unset: true };
  }
  const n = Number(value);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return { ok: false, message: "Stock must be a whole number of 0 or more." };
  }
  return { ok: true, stock: n };
}

function pickPath(source, path) {
  if (!path) return undefined;
  let current = source;
  for (const segment of String(path).split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) current = current[Number(segment)];
    else current = current[segment];
  }
  return current;
}

function splitImages(value) {
  if (Array.isArray(value)) return value.map((entry) => clean(entry)).filter(Boolean);
  return String(value ?? "")
    .split(/[|,\n]/)
    .map((entry) => clean(entry))
    .filter(Boolean);
}

// =====================================================
// PROVIDERS
// =====================================================

const SPAPI_HOSTS = {
  na: "https://sellingpartnerapi-na.amazon.com",
  eu: "https://sellingpartnerapi-eu.amazon.com",
  fe: "https://sellingpartnerapi-fe.amazon.com",
};

const SPAPI_SIGNING_REGIONS = {
  na: "us-east-1",
  eu: "eu-west-1",
  fe: "us-west-2",
};

const PROVIDERS = {
  amazon: {
    key: "amazon",
    label: "Amazon",
    connectMode: "oauth",
    supportsSync: true,
    docsUrl: "https://developer-docs.amazon.com/sp-api/",
    notes:
      "Official Amazon Selling Partner API (SP-API). Admin configures the Login with Amazon app + AWS IAM credentials; the seller authorizes via Amazon OAuth. Until real credentials are entered the connector shows 'Credentials required' — it is not a mock.",
    appFields: [
      { key: "lwaClientId", label: "LWA Client ID", required: true },
      { key: "lwaClientSecret", label: "LWA Client Secret", required: true, secret: true },
      { key: "awsAccessKeyId", label: "AWS Access Key ID", required: true, secret: true },
      { key: "awsSecretAccessKey", label: "AWS Secret Access Key", required: true, secret: true },
      { key: "lwaTokenUrl", label: "LWA token URL", required: false, secret: true },
      { key: "authorizeBaseUrl", label: "Authorize base URL", required: false, secret: true },
      { key: "redirectUri", label: "OAuth redirect URI", required: false, secret: true },
    ],
    integrationFields: ["externalSellerId", "marketplaceId", "region", "baseUrl"],
  },
  flipkart: {
    key: "flipkart",
    label: "Flipkart",
    connectMode: "client_credentials",
    supportsSync: true,
    docsUrl: "https://seller.flipkart.com/api-docs",
    notes:
      "Official Flipkart Marketplace Seller API v3. Admin configures the Flipkart application (app id + secret); each seller enters their Flipkart Seller ID. Tokens are fetched server-side, encrypted and refreshed before expiry.",
    appFields: [
      { key: "flipkartAppId", label: "Flipkart Application ID", required: true },
      { key: "flipkartAppSecret", label: "Flipkart Application Secret", required: true, secret: true },
      { key: "flipkartTokenUrl", label: "Token URL", required: false, secret: true },
    ],
    integrationFields: ["externalSellerId", "baseUrl"],
  },
  meesho: {
    key: "meesho",
    label: "Meesho",
    connectMode: "none",
    supportsSync: false,
    apiAccessRequired: true,
    docsUrl: "https://supplier.meesho.com",
    notes:
      "Meesho has no public self-serve seller API and issues no seller API keys. Access is partner-gated. Use the authorized bulk CSV/XLSX import (Import Center → Bulk Upload) or request partner API access from Meesho — no scraping or password login is used here.",
    appFields: [],
    integrationFields: [],
  },
  glowroad: {
    key: "glowroad",
    label: "GlowRoad",
    connectMode: "api_key",
    supportsSync: true,
    unverified: true,
    docsUrl: "https://www.glowroad.com",
    notes:
      "GlowRoad does not publish a public developer API. This API-KEY connector works only with an endpoint + key issued by GlowRoad and stays UNVERIFIED until that access is tested with real credentials.",
    appFields: [],
    integrationFields: ["baseUrl", "listingsPath", "apiKeyHeader", "mapping"],
  },
};

function getProvider(key) {
  return PROVIDERS[clean(key).toLowerCase()] || null;
}

function providerList() {
  return Object.values(PROVIDERS);
}

function providerSupports(key) {
  const provider = getProvider(key);
  return Boolean(provider && provider.supportsSync);
}

// =====================================================
// TABLES (ADDITIVE)
// =====================================================

function addColumn(table, name, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
  if (!columns.includes(name)) {
    db.prepare(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`).run();
  }
}

function ensureMarketplaceTables() {
  addColumn("products", "marketplaceListingStatus", "TEXT");

  db.prepare(`
    CREATE TABLE IF NOT EXISTS marketplace_providers (
      provider TEXT PRIMARY KEY,
      enabled INTEGER NOT NULL DEFAULT 1,
      credentialsEnc TEXT,
      updatedAt TEXT,
      updatedBy TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS marketplace_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sellerId INTEGER NOT NULL,
      provider TEXT NOT NULL,
      accountLabel TEXT,
      externalSellerId TEXT,
      status TEXT NOT NULL DEFAULT 'Pending Approval',
      adminDisabled INTEGER NOT NULL DEFAULT 0,
      credentialsEnc TEXT,
      accessTokenEnc TEXT,
      tokenExpiresAt TEXT,
      tokenRefreshedAt TEXT,
      tokenError TEXT,
      baseUrl TEXT,
      region TEXT,
      marketplaceId TEXT,
      listingsPath TEXT,
      apiKeyHeader TEXT,
      mappingJson TEXT,
      pricingMode TEXT NOT NULL DEFAULT 'apply_markup',
      autoSync INTEGER NOT NULL DEFAULT 1,
      syncFrequencyMinutes INTEGER NOT NULL DEFAULT 1440,
      nextSyncAt TEXT,
      syncRetryCount INTEGER NOT NULL DEFAULT 0,
      connectionStatus TEXT NOT NULL DEFAULT 'Untested',
      lastTestedAt TEXT,
      lastTestError TEXT,
      lastSyncAt TEXT,
      lastSuccessfulSyncAt TEXT,
      lastSyncStatus TEXT,
      lastSyncError TEXT,
      lastImportedCount INTEGER NOT NULL DEFAULT 0,
      totalImportedCount INTEGER NOT NULL DEFAULT 0,
      rejectionReason TEXT,
      disconnectedAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT,
      UNIQUE (sellerId, provider)
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS marketplace_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integrationId INTEGER NOT NULL,
      sellerId INTEGER NOT NULL,
      provider TEXT NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'running',
      fetched INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      inactive INTEGER NOT NULL DEFAULT 0,
      errorsJson TEXT,
      startedAt TEXT NOT NULL,
      finishedAt TEXT
    )
  `).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_marketplace_runs_seller
     ON marketplace_sync_runs (sellerId, id DESC)`
  ).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS marketplace_oauth_states (
      state TEXT PRIMARY KEY,
      sellerId INTEGER NOT NULL,
      provider TEXT NOT NULL,
      returnTo TEXT,
      createdAt TEXT NOT NULL,
      expiresAt TEXT NOT NULL
    )
  `).run();

  const insertProvider = db.prepare(
    `INSERT OR IGNORE INTO marketplace_providers (provider, enabled, updatedAt) VALUES (?, ?, ?)`
  );
  for (const provider of providerList()) {
    insertProvider.run(provider.key, provider.key === "meesho" ? 0 : 1, now());
  }
}

// =====================================================
// APP CREDENTIALS (ADMIN) — ENCRYPTED
// =====================================================

function providerRow(provider) {
  return db.prepare(`SELECT * FROM marketplace_providers WHERE provider = ?`).get(provider);
}

function readAppCredentials(provider) {
  const row = providerRow(provider);
  let data = {};
  if (row?.credentialsEnc) {
    try {
      data = JSON.parse(decryptSecret(row.credentialsEnc) || "{}") || {};
    } catch {
      data = {};
    }
  }

  const definition = getProvider(provider);
  const required = (definition?.appFields || []).filter((field) => field.required);
  const configured = required.every((field) => clean(data[field.key]));

  return { data, enabled: row ? Boolean(row.enabled) : provider !== "meesho", configured };
}

function publicProviderConfig(provider) {
  const definition = getProvider(provider);
  const state = readAppCredentials(provider);

  return {
    key: definition.key,
    label: definition.label,
    enabled: state.enabled,
    appConfigured: state.configured,
    appFields:
      definition.appFields.length === 0
        ? []
        : definition.appFields.map((field) => {
            const value = clean(state.data[field.key]);
            return {
              key: field.key,
              label: field.label,
              required: Boolean(field.required),
              secret: Boolean(field.secret),
              hasValue: Boolean(value),
              hint: value ? (field.secret ? secretHint(value) : value) : null,
            };
          }),
    verification:
      definition.unverified || definition.apiAccessRequired
        ? "unverified_partner"
        : "official_api",
    apiAccessRequired: Boolean(definition.apiAccessRequired),
    supportsSync: Boolean(definition.supportsSync),
    connectMode: definition.connectMode,
    docsUrl: definition.docsUrl,
    notes: definition.notes,
  };
}

// =====================================================
// PUBLIC SHAPES
// =====================================================

function publicIntegration(row) {
  if (!row) return null;
  const provider = getProvider(row.provider);
  const app = readAppCredentials(row.provider);

  return {
    id: row.id,
    provider: row.provider,
    providerLabel: provider?.label || row.provider,
    accountLabel: row.accountLabel || "",
    externalSellerId: row.externalSellerId || "",
    status: row.status,
    adminDisabled: Boolean(row.adminDisabled),
    rejectionReason: row.rejectionReason || null,
    baseUrl: row.baseUrl || "",
    region: row.region || "na",
    marketplaceId: row.marketplaceId || "",
    listingsPath: row.listingsPath || "",
    apiKeyHeader: row.apiKeyHeader || "X-API-Key",
    hasCredentials: Boolean(row.credentialsEnc),
    apiKeyHint: (() => {
      try {
        const decoded = JSON.parse(decryptSecret(row.credentialsEnc) || "{}");
        return decoded.apiKey ? secretHint(decoded.apiKey) : null;
      } catch {
        return null;
      }
    })(),
    hasRefreshToken: (() => {
      try {
        return Boolean(JSON.parse(decryptSecret(row.credentialsEnc) || "{}").refreshToken);
      } catch {
        return false;
      }
    })(),
    hasAccessToken: Boolean(row.accessTokenEnc),
    tokenExpiresAt: row.tokenExpiresAt || null,
    tokenRefreshedAt: row.tokenRefreshedAt || null,
    tokenError: row.tokenError || null,
    pricingMode: row.pricingMode,
    autoSync: Boolean(row.autoSync),
    syncFrequencyMinutes: row.syncFrequencyMinutes,
    nextSyncAt: row.nextSyncAt || null,
    syncRetryCount: Number(row.syncRetryCount) || 0,
    connectionStatus: row.connectionStatus,
    lastTestedAt: row.lastTestedAt || null,
    lastTestError: row.lastTestError || null,
    lastSyncAt: row.lastSyncAt || null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt || null,
    lastSyncStatus: row.lastSyncStatus || null,
    lastSyncError: row.lastSyncError || null,
    lastImportedCount: Number(row.lastImportedCount) || 0,
    totalImportedCount: Number(row.totalImportedCount) || 0,
    appConfigured: app.configured,
    providerSupportsSync: Boolean(provider?.supportsSync),
    apiAccessRequired: Boolean(provider?.apiAccessRequired),
    providerEnabled: app.enabled,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
    disconnectedAt: row.disconnectedAt || null,
  };
}

// =====================================================
// SCHEDULING
// =====================================================

function nextRunFor(integration, settings = getImportSettings()) {
  const frequencyMinutes =
    settings.scheduleMode === "seller"
      ? Math.max(settings.minSyncFrequencyMinutes, Number(integration.syncFrequencyMinutes) || 1440)
      : Math.max(settings.minSyncFrequencyMinutes, Number(settings.scheduleFrequencyMinutes) || 1440);

  return computeNextSyncAt({
    frequencyMinutes,
    scheduleTime: settings.scheduleTime,
    scheduleTimezone: settings.scheduleTimezone,
  });
}

function refreshNextSyncAt(integrationId = null) {
  const rows = integrationId
    ? db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).all(integrationId)
    : db
        .prepare(
          `SELECT * FROM marketplace_integrations WHERE status = 'Approved' AND autoSync = 1 AND adminDisabled = 0`
        )
        .all();

  const write = db.prepare(`UPDATE marketplace_integrations SET nextSyncAt = ? WHERE id = ?`);

  for (const row of rows) {
    if (row.status !== "Approved" || !row.autoSync || row.adminDisabled) {
      write.run(null, row.id);
    } else {
      write.run(nextRunFor(row), row.id);
    }
  }
}

// =====================================================
// HTTP + TOKENS
// =====================================================

async function httpJson(url, { method = "GET", headers = {}, body = null } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === null ? undefined : body,
      redirect: "error",
      signal: controller.signal,
    });

    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) throw new Error("Marketplace response is too large.");

    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    if (!response.ok) {
      const detail =
        data?.errors?.[0]?.message ||
        data?.error_description ||
        data?.message ||
        (typeof data?.error === "string" ? data.error : null) ||
        `Marketplace API returned HTTP ${response.status}`;
      const error = new Error(String(detail).slice(0, 300));
      error.status = response.status;
      error.data = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Marketplace API timed out after 20 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function saveToken(integration, { accessToken, expiresAt, refreshToken }) {
  const patch = {
    accessTokenEnc: accessToken ? encryptSecret(accessToken) : integration.accessTokenEnc,
    tokenExpiresAt: expiresAt || null,
    tokenRefreshedAt: now(),
    tokenError: null,
  };

  let credentialsEnc = integration.credentialsEnc || null;
  if (refreshToken) {
    let existing = {};
    try {
      existing = JSON.parse(decryptSecret(integration.credentialsEnc) || "{}") || {};
    } catch {
      existing = {};
    }
    credentialsEnc = encryptSecret(JSON.stringify({ ...existing, refreshToken: clean(refreshToken) }));
  }

  db.prepare(
    `UPDATE marketplace_integrations
     SET accessTokenEnc = ?, tokenExpiresAt = ?, tokenRefreshedAt = ?, tokenError = ?, credentialsEnc = ?, updatedAt = ?
     WHERE id = ?`
  ).run(
    patch.accessTokenEnc,
    patch.tokenExpiresAt,
    patch.tokenRefreshedAt,
    patch.tokenError,
    credentialsEnc,
    now(),
    integration.id
  );

  return { ...integration, ...patch, credentialsEnc };
}

async function amazonTokenRequest(app, params) {
  const url = clean(app.lwaTokenUrl) || "https://api.amazon.com/auth/o2/token";
  return httpJson(url, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded", Accept: "application/json" },
    body: new URLSearchParams(params).toString(),
  });
}

async function ensureAccessToken(integration, app, { force = false } = {}) {
  const expiresAt = integration.tokenExpiresAt ? Date.parse(integration.tokenExpiresAt) : 0;

  if (
    !force &&
    integration.accessTokenEnc &&
    Number.isFinite(expiresAt) &&
    expiresAt > Date.now() + 60 * 1000
  ) {
    return decryptSecret(integration.accessTokenEnc);
  }

  if (integration.provider === "amazon") {
    let refreshToken = "";
    try {
      refreshToken = JSON.parse(decryptSecret(integration.credentialsEnc) || "{}").refreshToken || "";
    } catch {
      refreshToken = "";
    }

    if (!refreshToken) {
      throw new Error("Amazon is not authorized yet. Use Connect Amazon to authorize the seller account.");
    }
    if (!app.configured) {
      throw new Error("Amazon app credentials are not configured by the admin.");
    }

    const data = await amazonTokenRequest(app.data, {
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: clean(app.data.lwaClientId),
      client_secret: clean(app.data.lwaClientSecret),
    });

    const accessToken = clean(data?.access_token);
    if (!accessToken) throw new Error("Amazon did not return an access token.");

    const updated = saveToken(integration, {
      accessToken,
      expiresAt: new Date(Date.now() + Math.max(60, Number(data.expires_in) || 3600) * 1000).toISOString(),
    });

    integration.accessTokenEnc = updated.accessTokenEnc;
    integration.tokenExpiresAt = updated.tokenExpiresAt;
    return accessToken;
  }

  if (integration.provider === "flipkart") {
    if (!app.configured) {
      throw new Error("Flipkart app credentials are not configured by the admin.");
    }

    const url =
      clean(app.data.flipkartTokenUrl) ||
      "https://api.flipkart.net/oauth-service/oauth/token?grant_type=client_credentials&scope=Seller_Api";
    const basic = Buffer.from(
      `${clean(app.data.flipkartAppId)}:${clean(app.data.flipkartAppSecret)}`
    ).toString("base64");

    const data = await httpJson(url, {
      method: "GET",
      headers: { Authorization: `Basic ${basic}`, Accept: "application/json" },
    });

    const accessToken = clean(data?.access_token);
    if (!accessToken) throw new Error("Flipkart did not return an access token.");

    const ttlSeconds = Number(data?.expires_in) > 0 ? Number(data.expires_in) : 50 * 24 * 3600;
    const updated = saveToken(integration, {
      accessToken,
      expiresAt: new Date(Date.now() + ttlSeconds * 1000).toISOString(),
    });

    integration.accessTokenEnc = updated.accessTokenEnc;
    integration.tokenExpiresAt = updated.tokenExpiresAt;
    return accessToken;
  }

  throw new Error("This marketplace connector does not use access tokens.");
}

// =====================================================
// AMAZON SIGV4
// =====================================================

function sha256Hex(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function hmac(key, value) {
  return crypto.createHmac("sha256", key).update(value).digest();
}

function amzTimestamp(date) {
  return date.toISOString().replace(/[:-]|\.\d{3}/g, "");
}

function signSpApi({ url, region, accessToken, accessKeyId, secretAccessKey }) {
  const parsed = new URL(url);
  const timestamp = amzTimestamp(new Date());
  const dateStamp = timestamp.slice(0, 8);

  const headers = {
    host: parsed.host,
    "x-amz-access-token": accessToken,
    "x-amz-date": timestamp,
  };

  const canonicalQuery = [...parsed.searchParams.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([key, value]) => `${encodeURIComponent(key)}=${encodeURIComponent(value)}`)
    .join("&");

  const sortedHeaderNames = Object.keys(headers).sort();
  const canonicalHeaders = sortedHeaderNames
    .map((key) => `${key}:${String(headers[key]).trim()}\n`)
    .join("");
  const signedHeaders = sortedHeaderNames.join(";");

  const canonicalRequest = [
    "GET",
    parsed.pathname,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    sha256Hex(""),
  ].join("\n");

  const scope = `${dateStamp}/${region}/execute-api/aws4_request`;
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    timestamp,
    scope,
    sha256Hex(canonicalRequest),
  ].join("\n");

  const signingKey = hmac(
    hmac(hmac(hmac(`AWS4${secretAccessKey}`, dateStamp), region), "execute-api"),
    "aws4_request"
  );
  const signature = crypto.createHmac("sha256", signingKey).update(stringToSign).digest("hex");

  return {
    "x-amz-access-token": accessToken,
    "x-amz-date": timestamp,
    authorization: `AWS4-HMAC-SHA256 Credential=${accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
  };
}

// =====================================================
// FETCHERS
// =====================================================

function normalizeAmazonItem(item) {
  const summary = (Array.isArray(item.summaries) && item.summaries[0]) || {};
  const attributes = item.attributes || {};
  const statuses = Array.isArray(summary.status) ? summary.status : [];

  const image = attributes.main_product_image_locator?.[0]?.media_location || "";
  const price =
    attributes.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value_with_tax ??
    attributes.purchasable_offer?.[0]?.our_price?.[0]?.schedule?.[0]?.value ??
    "";

  return {
    sku: clean(item.sku),
    name: clean(summary.itemName || attributes.item_name?.[0]?.value || item.sku),
    category: clean(summary.productType || attributes.product_type?.[0]?.value || "Amazon"),
    price,
    comparePrice: attributes.list_price?.[0]?.value_with_tax ?? "",
    stock:
      attributes.fulfillment_availability?.[0]?.quantity === undefined
        ? ""
        : attributes.fulfillment_availability[0].quantity,
    images: image ? [image] : [],
    description: clean(attributes.product_description?.[0]?.value).slice(0, 5000),
    hsnCode: clean(attributes.hsn_code?.[0]?.value).slice(0, 20),
    listingStatus: statuses.length === 0 || statuses.includes("BUYABLE") ? "ACTIVE" : "INACTIVE",
  };
}

async function fetchAmazonItems(integration, app, maxItems) {
  if (!integration.externalSellerId) throw new Error("Amazon Seller ID is required.");
  if (!integration.marketplaceId) throw new Error("Amazon Marketplace ID is required.");

  const region = ["na", "eu", "fe"].includes(clean(integration.region)) ? clean(integration.region) : "na";
  const base = clean(integration.baseUrl) || SPAPI_HOSTS[region];
  const signingRegion = SPAPI_SIGNING_REGIONS[region];
  const items = [];
  let pageToken = null;

  for (let page = 0; page < MAX_PAGES && items.length < maxItems; page++) {
    const url = new URL(
      `${base.replace(/\/$/, "")}/listings/2021-08-01/items/${encodeURIComponent(
        integration.externalSellerId
      )}`
    );
    url.searchParams.set("marketplaceIds", integration.marketplaceId);
    url.searchParams.set("includedData", "summaries,attributes");
    url.searchParams.set("pageSize", "50");
    if (pageToken) url.searchParams.set("pageToken", pageToken);

    const request = async () => {
      const token = await ensureAccessToken(integration, app);
      const headers = signSpApi({
        url: url.toString(),
        region: signingRegion,
        accessToken: token,
        accessKeyId: clean(app.data.awsAccessKeyId),
        secretAccessKey: clean(app.data.awsSecretAccessKey),
      });
      return httpJson(url.toString(), { headers });
    };

    let data;
    try {
      data = await request();
    } catch (error) {
      if (error.status === 401 || error.status === 403) {
        await ensureAccessToken(integration, app, { force: true });
        data = await request();
      } else {
        throw error;
      }
    }

    const pageItems = Array.isArray(data?.items) ? data.items : [];
    for (const item of pageItems) {
      if (items.length >= maxItems) break;
      items.push(normalizeAmazonItem(item));
    }

    pageToken = data?.pagination?.nextToken || data?.nextToken || null;
    if (!pageToken) break;
  }

  return items;
}

async function fetchFlipkartItems(integration, app, maxItems) {
  if (!integration.externalSellerId) throw new Error("Flipkart Seller ID is required.");

  const base = (clean(integration.baseUrl) || "https://api.flipkart.net").replace(/\/$/, "");
  const token = await ensureAccessToken(integration, app);

  const authorized = async (url, options = {}) => {
    try {
      return await httpJson(url, {
        ...options,
        headers: {
          Accept: "application/json",
          ...(options.headers || {}),
          Authorization: `Bearer ${await ensureAccessToken(integration, app)}`,
        },
      });
    } catch (error) {
      if (error.status === 401) {
        await ensureAccessToken(integration, app, { force: true });
        return httpJson(url, {
          ...options,
          headers: {
            Accept: "application/json",
            ...(options.headers || {}),
            Authorization: `Bearer ${await ensureAccessToken(integration, app)}`,
          },
        });
      }
      throw error;
    }
  };

  const search = await authorized(`${base}/listings/v3/search`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filters: {}, page_id: null }),
  });

  const listings = search.listingData || search.listings || search.data || [];
  const items = [];

  for (const listing of Array.isArray(listings) ? listings : []) {
    if (items.length >= maxItems) break;
    const sku = clean(listing.sku || listing.sku_id || listing.skuId);
    if (!sku) continue;

    let attributes = listing.attributeValues || {};
    let status = clean(listing.status);

    try {
      const detail = await authorized(
        `${base}/sellers/skus/${encodeURIComponent(sku)}/listings`
      );
      attributes = detail?.attributeValues || attributes;
      status = clean(attributes.listing_status || status);
    } catch {
      // A single SKU detail failure must not fail the whole sync.
    }

    items.push({
      sku,
      name: clean(listing.product_name || listing.productName || sku),
      category: clean(listing.vertical || "Flipkart"),
      price: attributes.selling_price ?? "",
      comparePrice: attributes.mrp ?? "",
      stock: attributes.stock_count ?? "",
      images: listing.product_image_url ? [listing.product_image_url] : [],
      description: "",
      hsnCode: clean(listing.hsn || "").slice(0, 20),
      listingStatus: status.toUpperCase() === "INACTIVE" ? "INACTIVE" : "ACTIVE",
    });
  }

  return items;
}

const DEFAULT_GLOWROAD_MAPPING = {
  sku: "sku",
  name: "name",
  category: "category",
  price: "price",
  comparePrice: "compare_price",
  stock: "stock",
  description: "description",
  images: "images",
  listingStatus: "status",
};

function readMarketplaceMapping(json) {
  let parsed = {};
  try {
    parsed = JSON.parse(json || "{}");
  } catch {
    parsed = {};
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) parsed = {};

  const merged = { ...DEFAULT_GLOWROAD_MAPPING };
  for (const key of Object.keys(DEFAULT_GLOWROAD_MAPPING)) {
    if (typeof parsed[key] === "string" && parsed[key].trim()) merged[key] = parsed[key].trim();
  }
  return merged;
}

async function fetchGlowRoadItems(integration, maxItems) {
  if (!integration.baseUrl) throw new Error("GlowRoad API endpoint is required.");

  let apiKey = "";
  try {
    apiKey = clean(JSON.parse(decryptSecret(integration.credentialsEnc) || "{}").apiKey);
  } catch {
    apiKey = "";
  }
  if (!apiKey) throw new Error("GlowRoad API key is required.");

  const base = integration.baseUrl.replace(/\/$/, "");
  const path = clean(integration.listingsPath) || "/products";
  const url = /^https?:\/\//i.test(path) ? path : `${base}/${path.replace(/^\//, "")}`;
  const headerName = clean(integration.apiKeyHeader) || "X-API-Key";

  const data = await httpJson(url, {
    headers: { Accept: "application/json", [headerName]: apiKey },
  });

  const list = Array.isArray(data)
    ? data
    : data?.data?.products || data?.products || data?.items || data?.data || [];

  if (!Array.isArray(list)) {
    throw new Error("Could not find a product list in the GlowRoad response.");
  }

  const mapping = readMarketplaceMapping(integration.mappingJson);

  return list.slice(0, maxItems).map((entry) => ({
    sku: clean(pickPath(entry, mapping.sku)).slice(0, 64),
    name: clean(pickPath(entry, mapping.name)).slice(0, 200),
    category: clean(pickPath(entry, mapping.category)).slice(0, 120),
    price: clean(pickPath(entry, mapping.price)),
    comparePrice: clean(pickPath(entry, mapping.comparePrice)),
    stock: pickPath(entry, mapping.stock) ?? "",
    description: clean(pickPath(entry, mapping.description)).slice(0, 5000),
    images: splitImages(pickPath(entry, mapping.images)).slice(0, 6),
    hsnCode: "",
    listingStatus:
      clean(pickPath(entry, mapping.listingStatus)).toUpperCase() === "INACTIVE"
        ? "INACTIVE"
        : "ACTIVE",
  }));
}

async function fetchMarketplaceItems(integration, app, maxItems) {
  if (integration.provider === "amazon") return fetchAmazonItems(integration, app, maxItems);
  if (integration.provider === "flipkart") return fetchFlipkartItems(integration, app, maxItems);
  if (integration.provider === "glowroad") return fetchGlowRoadItems(integration, maxItems);

  const error = new Error(
    "Meesho does not provide a public seller API. Use the authorized bulk CSV/XLSX import instead."
  );
  error.code = "API_ACCESS_REQUIRED";
  throw error;
}

// =====================================================
// PRODUCT WRITES (same rules as supplier sync)
// =====================================================

function findSellerProductBySku(seller, sku) {
  const normalized = clean(sku).toLowerCase();
  if (!normalized) return null;

  return db
    .prepare(
      `SELECT * FROM products
       WHERE (sellerId = ? OR sellerId = ?)
         AND LOWER(COALESCE(sku, '')) = ?
       LIMIT 1`
    )
    .get(seller.sellerCode, String(seller.id), normalized);
}

function applyMarketplaceItem({ seller, integration, item, allowCreate = true }) {
  const sku = clean(item.sku);
  if (!sku) return { status: "failed", error: "Item has no SKU." };

  const price = parsePrice(item.price);
  if (price <= 0) return { status: "failed", error: `SKU ${sku}: invalid price.` };

  const stockInput = parseStock(item.stock);
  if (!stockInput.ok) return { status: "failed", error: `SKU ${sku}: ${stockInput.message}` };

  const existing = findSellerProductBySku(seller, sku);
  const category = clean(item.category) || existing?.category || "Uncategorised";
  const active = item.listingStatus !== "INACTIVE";

  const margin =
    integration.pricingMode === "listing_price"
      ? {
          supplierPrice: round2(price),
          markupType: null,
          markupValue: 0,
          markupAmount: 0,
          sellingPrice: round2(price),
        }
      : computeMarkup(
          price,
          resolveMarginRule({
            sellerId: seller.id,
            marketplaceId: integration.id,
            category,
          }).rule
        );

  if (!existing) {
    if (!allowCreate) return { status: "skipped", error: `SKU ${sku}: not in this seller's catalog.` };
    if (!clean(item.name)) return { status: "failed", error: `SKU ${sku}: product name is missing.` };

    const imageError = validateProductImages(item.images || []);
    if (imageError) return { status: "failed", error: `SKU ${sku}: ${imageError}` };

    const gst = resolveProductGst({ category, gstRate: 0, hsnCode: item.hsnCode || "", gstSource: null });
    const pricing = calculateCustomerPricing(margin.sellingPrice, gst.gstRate, gst.priceIncludesGst);
    const stock = stockInput.unset ? null : stockInput.stock;

    const result = db
      .prepare(
        `INSERT INTO products (
           sellerId, sellerName, sku, name, category, price, comparePrice,
           image, images, description, shortDetails, status, createdAt,
           hsnCode, gstRate, gstSource, deliveryCharge, platformCharge, mlmCommission,
           customerPrice, pricingUpdatedAt, stock, source, sourceRef,
           supplierPrice, markupType, markupValue, markupAmount, priceSource,
           stockVerifiedAt, stockUnverified, marketplaceListingStatus
         ) VALUES (
           @sellerId, @sellerName, @sku, @name, @category, @price, @comparePrice,
           @image, @images, @description, @shortDetails, 'Pending', @createdAt,
           @hsnCode, @gstRate, @gstSource, @deliveryCharge, @platformCharge, @mlmCommission,
           @customerPrice, @pricingUpdatedAt, @stock, 'marketplace_api', @sourceRef,
           @supplierPrice, @markupType, @markupValue, @markupAmount, 'marketplace',
           @stockVerifiedAt, @stockUnverified, @listingStatus
         )`
      )
      .run({
        sellerId: seller.sellerCode,
        sellerName: seller.name,
        sku,
        name: clean(item.name).slice(0, 200),
        category: category.slice(0, 120),
        price: String(margin.sellingPrice),
        comparePrice: clean(item.comparePrice) || null,
        image: (item.images || [])[0] || "",
        images: JSON.stringify((item.images || []).slice(0, 6)),
        description: clean(item.description).slice(0, 5000),
        shortDetails: "",
        createdAt: now(),
        hsnCode: clean(item.hsnCode).slice(0, 20),
        gstRate: gst.gstRate,
        gstSource: gst.source,
        deliveryCharge: pricing.deliveryCharge,
        platformCharge: pricing.platformCharge,
        mlmCommission: pricing.mlmCommission,
        customerPrice: pricing.customerPrice,
        pricingUpdatedAt: now(),
        stock,
        sourceRef: `marketplace:${integration.id}`,
        supplierPrice: margin.supplierPrice,
        markupType: margin.markupType,
        markupValue: margin.markupValue,
        markupAmount: margin.markupAmount,
        stockVerifiedAt: stockInput.unset ? null : now(),
        stockUnverified: active ? 0 : 1,
        listingStatus: item.listingStatus || "ACTIVE",
      });

    return { status: "created", productId: Number(result.lastInsertRowid) };
  }

  const gstForProduct = resolveProductGst({
    category,
    subCategory: existing.subCategory,
    gstRate: existing.gstSource === "product" ? existing.gstRate : 0,
    hsnCode: existing.hsnCode || item.hsnCode || "",
    gstSource: existing.gstSource === "product" ? "product" : null,
    gstType: existing.gstType,
    gstApproved: existing.gstApproved,
  });
  const pricing = calculateCustomerPricing(margin.sellingPrice, gstForProduct.gstRate, gstForProduct.priceIncludesGst);
  const stockProvided = !stockInput.unset;
  const stock = stockProvided ? stockInput.stock : existing.stock ?? null;

  db.prepare(
    `UPDATE products
     SET price = ?, comparePrice = ?, deliveryCharge = ?, platformCharge = ?,
         mlmCommission = ?, customerPrice = ?, pricingUpdatedAt = ?, stock = ?,
         supplierPrice = ?, markupType = ?, markupValue = ?, markupAmount = ?,
         priceSource = 'marketplace', stockVerifiedAt = ?, stockUnverified = ?,
         marketplaceListingStatus = ?
     WHERE id = ?`
  ).run(
    String(margin.sellingPrice),
    clean(item.comparePrice) || existing.comparePrice || null,
    pricing.deliveryCharge,
    pricing.platformCharge,
    pricing.mlmCommission,
    pricing.customerPrice,
    now(),
    stock,
    margin.supplierPrice,
    margin.markupType,
    margin.markupValue,
    margin.markupAmount,
    stockProvided ? now() : existing.stockVerifiedAt || null,
    active ? 0 : 1,
    item.listingStatus || "ACTIVE",
    existing.id
  );

  return { status: "updated", productId: existing.id };
}

// =====================================================
// SYNC RUN
// =====================================================

async function runMarketplaceSync(integration, trigger) {
  const provider = getProvider(integration.provider);
  if (!provider) throw new Error("Unknown marketplace provider.");
  if (!provider.supportsSync) {
    const error = new Error(
      "Meesho does not provide a public seller API. Use the authorized bulk CSV/XLSX import."
    );
    error.code = "API_ACCESS_REQUIRED";
    throw error;
  }

  const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(integration.sellerId);
  if (!seller) throw new Error("Seller not found for this marketplace.");

  const settings = getImportSettings();
  const app = readAppCredentials(integration.provider);

  const runResult = db
    .prepare(
      `INSERT INTO marketplace_sync_runs
         (integrationId, sellerId, provider, trigger, status, startedAt)
       VALUES (?, ?, ?, ?, 'running', ?)`
    )
    .run(integration.id, seller.id, integration.provider, trigger, now());

  const runId = Number(runResult.lastInsertRowid);
  const errors = [];
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;
  let inactive = 0;

  try {
    const items = await fetchMarketplaceItems(integration, app, settings.maxSyncItems);
    fetched = items.length;

    const apply = db.transaction(() => {
      for (const item of items) {
        const result = applyMarketplaceItem({ seller, integration, item });

        if (result.status === "created") created++;
        else if (result.status === "updated") {
          updated++;
          if (item.listingStatus === "INACTIVE") inactive++;
        } else if (result.status === "failed") {
          failed++;
          if (errors.length < 200) errors.push(result.error);
        } else skipped++;
      }
    });
    apply();

    const status = failed > 0 && created + updated === 0 ? "failed" : failed > 0 ? "partial" : "success";

    db.prepare(
      `UPDATE marketplace_sync_runs
       SET status = ?, fetched = ?, created = ?, updated = ?, skipped = ?, failed = ?,
           inactive = ?, errorsJson = ?, finishedAt = ?
       WHERE id = ?`
    ).run(status, fetched, created, updated, skipped, failed, inactive, JSON.stringify(errors), now(), runId);

    db.prepare(
      `UPDATE marketplace_integrations
       SET lastSyncAt = ?, lastSuccessfulSyncAt = ?, lastSyncStatus = ?, lastSyncError = ?,
           connectionStatus = 'Connected', lastTestedAt = ?, lastTestError = NULL,
           syncRetryCount = 0, nextSyncAt = ?, lastImportedCount = ?,
           totalImportedCount = totalImportedCount + ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      now(),
      now(),
      status,
      errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
      now(),
      nextRunFor(integration, settings),
      created + updated,
      created,
      now(),
      integration.id
    );

    return { runId, status, fetched, created, updated, skipped, failed, inactive, errors, retryScheduled: false };
  } catch (error) {
    const message = error.message || "Marketplace sync failed.";

    db.prepare(
      `UPDATE marketplace_sync_runs
       SET status = 'failed', fetched = ?, errorsJson = ?, finishedAt = ?
       WHERE id = ?`
    ).run(fetched, JSON.stringify([message]), now(), runId);

    // Fail closed: the marketplace did not confirm this catalog, so
    // existing stock is no longer shown as available.
    db.prepare(
      `UPDATE products SET stockUnverified = 1
       WHERE source = 'marketplace_api' AND sourceRef = ?`
    ).run(`marketplace:${integration.id}`);

    const retryCount = (Number(integration.syncRetryCount) || 0) + 1;
    const retryScheduled = retryCount <= (Number(settings.syncRetryLimit) || 0);
    const nextSyncAt = retryScheduled
      ? new Date(Date.now() + (Number(settings.syncRetryBackoffMinutes) || 15) * 60 * 1000).toISOString()
      : nextRunFor(integration, settings);

    db.prepare(
      `UPDATE marketplace_integrations
       SET lastSyncAt = ?, lastSyncStatus = 'failed', lastSyncError = ?,
           connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?,
           syncRetryCount = ?, nextSyncAt = ?, tokenError = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      now(),
      message,
      now(),
      message,
      retryCount,
      nextSyncAt,
      clean(error.code) === "TOKEN_ERROR" ? message : integration.tokenError || null,
      now(),
      integration.id
    );

    return {
      runId,
      status: "failed",
      fetched,
      created,
      updated,
      skipped,
      failed: failed || 1,
      inactive,
      errors: [message],
      retryScheduled,
      retryAt: retryScheduled ? nextSyncAt : null,
    };
  }
}

// =====================================================
// SELLER ROUTES
// =====================================================

function sellerForRequest(req) {
  return db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(req.user.sellerId);
}

function sellerIntegration(sellerId, provider) {
  return db
    .prepare(`SELECT * FROM marketplace_integrations WHERE sellerId = ? AND provider = ?`)
    .get(sellerId, provider);
}

marketplacesRouter.get(
  "/api/sellers/marketplaces",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = sellerForRequest(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });

      const rows = db
        .prepare(`SELECT * FROM marketplace_integrations WHERE sellerId = ? ORDER BY id DESC`)
        .all(seller.id);

      const providers = providerList().map((provider) => {
        const integration = rows.find((row) => row.provider === provider.key);
        const state = readAppCredentials(provider.key);
        return {
          ...publicProviderConfig(provider.key),
          connected: Boolean(integration && integration.status !== "Disconnected"),
          integration: publicIntegration(integration),
        };
      });

      res.json({ success: true, providers, settings: getImportSettings() });
    } catch (error) {
      console.error("SELLER MARKETPLACE LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load marketplace connections." });
    }
  }
);

marketplacesRouter.put(
  "/api/sellers/marketplaces/:provider",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = sellerForRequest(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });

      const provider = getProvider(req.params.provider);
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      if (!provider.supportsSync) {
        return res.status(409).json({
          success: false,
          code: "API_ACCESS_REQUIRED",
          message: `${provider.label} does not provide a public seller API. Use the authorized bulk CSV/XLSX import instead.`,
        });
      }

      const existing = sellerIntegration(seller.id, provider.key);
      const settings = getImportSettings();

      const accountLabel = clean(req.body.accountLabel).slice(0, 120);
      const externalSellerId = clean(req.body.externalSellerId).slice(0, 120);
      const marketplaceId = clean(req.body.marketplaceId).slice(0, 60);
      const region = ["na", "eu", "fe"].includes(clean(req.body.region))
        ? clean(req.body.region)
        : existing?.region || "na";
      const baseUrl = clean(req.body.baseUrl).slice(0, 300);
      const listingsPath = clean(req.body.listingsPath).slice(0, 300);
      const apiKeyHeader = clean(req.body.apiKeyHeader).slice(0, 60) || "X-API-Key";
      const apiKey = clean(req.body.apiKey);
      const pricingMode =
        clean(req.body.pricingMode) === "listing_price" ? "listing_price" : "apply_markup";

      const frequency = Number(req.body.syncFrequencyMinutes ?? existing?.syncFrequencyMinutes ?? 1440);
      if (
        !Number.isInteger(frequency) ||
        frequency < settings.minSyncFrequencyMinutes ||
        frequency > 10080
      ) {
        return res.status(400).json({
          success: false,
          message: `Sync frequency must be between ${settings.minSyncFrequencyMinutes} and 10080 minutes.`,
        });
      }

      if (provider.key === "amazon") {
        if (!externalSellerId) {
          return res.status(400).json({ success: false, message: "Amazon Seller ID is required." });
        }
        if (!marketplaceId) {
          return res.status(400).json({ success: false, message: "Amazon Marketplace ID is required." });
        }
      }

      if (provider.key === "flipkart" && !externalSellerId) {
        return res.status(400).json({ success: false, message: "Flipkart Seller ID is required." });
      }

      if (provider.key === "glowroad") {
        if (!baseUrl) {
          return res.status(400).json({ success: false, message: "GlowRoad API endpoint is required." });
        }
        if (!apiKey && !existing?.credentialsEnc) {
          return res.status(400).json({ success: false, message: "GlowRoad API key is required." });
        }
      }

      let mappingJson = existing?.mappingJson || null;
      if (req.body.mapping !== undefined) {
        let mapping = req.body.mapping;
        if (typeof mapping === "string") {
          try {
            mapping = mapping.trim() ? JSON.parse(mapping) : {};
          } catch {
            return res.status(400).json({ success: false, message: "Field mapping must be valid JSON." });
          }
        }
        if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
          return res.status(400).json({ success: false, message: "Field mapping must be a JSON object." });
        }
        mappingJson = JSON.stringify(mapping);
      }

      let credentialsEnc = existing?.credentialsEnc || null;
      if (apiKey) {
        let previous = {};
        try {
          previous = JSON.parse(decryptSecret(existing?.credentialsEnc) || "{}") || {};
        } catch {
          previous = {};
        }
        credentialsEnc = encryptSecret(JSON.stringify({ ...previous, apiKey }));
      }

      const identityChanged =
        !existing ||
        (provider.key === "amazon" && existing.externalSellerId !== externalSellerId) ||
        (provider.key === "flipkart" && existing.externalSellerId !== externalSellerId) ||
        (provider.key === "glowroad" && existing.baseUrl !== baseUrl);

      if (existing) {
        db.prepare(
          `UPDATE marketplace_integrations
           SET accountLabel = ?, externalSellerId = ?, marketplaceId = ?, region = ?,
               baseUrl = ?, listingsPath = ?, apiKeyHeader = ?, mappingJson = ?,
               credentialsEnc = ?, pricingMode = ?, autoSync = ?, syncFrequencyMinutes = ?,
               status = ?, rejectionReason = NULL, disconnectedAt = NULL, updatedAt = ?
           WHERE id = ?`
        ).run(
          accountLabel,
          externalSellerId,
          marketplaceId,
          region,
          baseUrl,
          listingsPath,
          apiKeyHeader,
          mappingJson,
          credentialsEnc,
          pricingMode,
          req.body.autoSync === undefined ? existing.autoSync : req.body.autoSync ? 1 : 0,
          frequency,
          identityChanged ? "Pending Approval" : existing.status,
          now(),
          existing.id
        );
      } else {
        db.prepare(
          `INSERT INTO marketplace_integrations
             (sellerId, provider, accountLabel, externalSellerId, marketplaceId, region,
              baseUrl, listingsPath, apiKeyHeader, mappingJson, credentialsEnc,
              pricingMode, autoSync, syncFrequencyMinutes, status, createdAt, updatedAt)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Approval', ?, ?)`
        ).run(
          seller.id,
          provider.key,
          accountLabel,
          externalSellerId,
          marketplaceId,
          region,
          baseUrl,
          listingsPath,
          apiKeyHeader,
          mappingJson,
          credentialsEnc,
          pricingMode,
          req.body.autoSync === undefined ? 1 : req.body.autoSync ? 1 : 0,
          frequency,
          now(),
          now()
        );
      }

      const saved = sellerIntegration(seller.id, provider.key);
      refreshNextSyncAt(saved.id);

      res.json({
        success: true,
        message: `${provider.label} configuration saved. Admin approval is required before syncing.`,
        integration: publicIntegration(saved),
      });
    } catch (error) {
      console.error("SELLER MARKETPLACE SAVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save marketplace configuration." });
    }
  }
);

marketplacesRouter.post(
  "/api/sellers/marketplaces/:provider/connect",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = sellerForRequest(req);
      const provider = getProvider(req.params.provider);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      if (!provider.supportsSync) {
        return res.status(409).json({
          success: false,
          code: "API_ACCESS_REQUIRED",
          message:
            "Meesho does not provide a public seller API. Use the authorized bulk CSV/XLSX import (Import Center → Bulk Upload) or request partner API access from Meesho.",
        });
      }

      const integration = sellerIntegration(seller.id, provider.key);
      if (!integration) {
        return res.status(400).json({
          success: false,
          message: `Save the ${provider.label} configuration first.`,
        });
      }

      const app = readAppCredentials(provider.key);
      if (!app.enabled) {
        return res.status(403).json({
          success: false,
          code: "PROVIDER_DISABLED",
          message: `${provider.label} integrations are disabled by the admin.`,
        });
      }

      if (provider.key === "amazon") {
        if (!app.configured) {
          return res.status(409).json({
            success: false,
            code: "APP_CREDENTIALS_REQUIRED",
            message: "Amazon app credentials (LWA + AWS IAM) are not configured by the admin yet.",
          });
        }

        const state = crypto.randomBytes(24).toString("hex");
        const returnTo = clean(req.body.returnTo).slice(0, 300);
        db.prepare(
          `INSERT INTO marketplace_oauth_states (state, sellerId, provider, returnTo, createdAt, expiresAt)
           VALUES (?, ?, ?, ?, ?, ?)`
        ).run(
          state,
          seller.id,
          provider.key,
          returnTo || null,
          now(),
          new Date(Date.now() + OAUTH_STATE_TTL_MS).toISOString()
        );

        const authorizeBase =
          clean(app.data.authorizeBaseUrl) ||
          "https://sellercentral.amazon.com/apps/authorize/consent";
        const url = new URL(authorizeBase);
        url.searchParams.set("application_id", clean(app.data.lwaClientId));
        url.searchParams.set("state", state);
        url.searchParams.set("version", "beta");

        return res.json({
          success: true,
          message: "Open this URL to authorize Amazon, then return to JustBrand.",
          authorizeUrl: url.toString(),
          expiresInMinutes: OAUTH_STATE_TTL_MS / 60000,
        });
      }

      if (provider.key === "flipkart") {
        try {
          const token = await ensureAccessToken(integration, app, { force: true });
          db.prepare(
            `UPDATE marketplace_integrations
             SET connectionStatus = 'Connected', lastTestedAt = ?, lastTestError = NULL,
                 tokenError = NULL, status = 'Pending Approval', updatedAt = ?
             WHERE id = ?`
          ).run(now(), now(), integration.id);

          return res.json({
            success: true,
            message: "Flipkart access token generated and stored securely. Admin approval is required before syncing.",
            tokenPreview: `${token.slice(0, 4)}…${token.slice(-4)}`,
          });
        } catch (error) {
          db.prepare(
            `UPDATE marketplace_integrations
             SET connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?, tokenError = ?, updatedAt = ?
             WHERE id = ?`
          ).run(now(), error.message, error.message, now(), integration.id);

          return res.status(502).json({ success: false, message: error.message });
        }
      }

      if (provider.key === "glowroad") {
        try {
          const items = await fetchMarketplaceItems(integration, app, 3);
          db.prepare(
            `UPDATE marketplace_integrations
             SET connectionStatus = 'Connected', lastTestedAt = ?, lastTestError = NULL,
                 status = 'Pending Approval', updatedAt = ?
             WHERE id = ?`
          ).run(now(), now(), integration.id);

          return res.json({
            success: true,
            message:
              "GlowRoad endpoint + API key accepted. The connector stays UNVERIFIED until GlowRoad confirms access; admin approval is required before syncing.",
            sample: items.map((item) => ({ sku: item.sku, name: item.name, price: item.price, stock: item.stock })),
          });
        } catch (error) {
          db.prepare(
            `UPDATE marketplace_integrations
             SET connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?, updatedAt = ?
             WHERE id = ?`
          ).run(now(), error.message, now(), integration.id);

          return res.status(502).json({ success: false, message: error.message });
        }
      }

      return res.status(400).json({ success: false, message: "Connect is not supported for this provider." });
    } catch (error) {
      console.error("SELLER MARKETPLACE CONNECT ERROR:", error);
      res.status(500).json({ success: false, message: "Connection failed." });
    }
  }
);

// Amazon redirects the browser here — no Authorization header exists,
// so the one-time state row is what ties the callback to a seller.
marketplacesRouter.get("/api/sellers/marketplaces/amazon/callback", async (req, res) => {
  try {
    const state = clean(req.query.state);
    const code = clean(req.query.code);
    const errorParam = clean(req.query.error);

    const row = state
      ? db.prepare(`SELECT * FROM marketplace_oauth_states WHERE state = ?`).get(state)
      : null;

    if (!row || Date.parse(row.expiresAt) < Date.now()) {
      return res.status(400).json({ success: false, message: "This Amazon authorization link expired. Please connect again." });
    }

    // Single use — delete before exchanging the code.
    db.prepare(`DELETE FROM marketplace_oauth_states WHERE state = ?`).run(state);

    if (errorParam) {
      return res.status(400).json({
        success: false,
        message: `Amazon authorization was not completed (${errorParam}).`,
      });
    }

    if (!code) {
      return res.status(400).json({ success: false, message: "Amazon did not return an authorization code." });
    }

    const integration = sellerIntegration(row.sellerId, "amazon");
    if (!integration) {
      return res.status(404).json({ success: false, message: "Amazon integration not found for this seller." });
    }

    const app = readAppCredentials("amazon");
    if (!app.configured) {
      return res.status(409).json({ success: false, message: "Amazon app credentials are not configured." });
    }

    const params = {
      grant_type: "authorization_code",
      code,
      client_id: clean(app.data.lwaClientId),
      client_secret: clean(app.data.lwaClientSecret),
    };
    if (clean(app.data.redirectUri)) params.redirect_uri = clean(app.data.redirectUri);

    let tokenData;
    try {
      tokenData = await amazonTokenRequest(app.data, params);
    } catch (error) {
      db.prepare(
        `UPDATE marketplace_integrations SET tokenError = ?, connectionStatus = 'Error', updatedAt = ? WHERE id = ?`
      ).run(error.message, now(), integration.id);
      return res.status(502).json({ success: false, message: `Amazon token exchange failed: ${error.message}` });
    }

    const refreshToken = clean(tokenData?.refresh_token);
    if (!refreshToken) {
      return res.status(502).json({ success: false, message: "Amazon did not return a refresh token." });
    }

    saveToken(integration, {
      accessToken: clean(tokenData.access_token),
      refreshToken,
      expiresAt: new Date(
        Date.now() + Math.max(60, Number(tokenData.expires_in) || 3600) * 1000
      ).toISOString(),
    });

    db.prepare(
      `UPDATE marketplace_integrations
       SET status = 'Pending Approval', connectionStatus = 'Connected', tokenError = NULL,
           lastTestedAt = ?, lastTestError = NULL, rejectionReason = NULL, updatedAt = ?
       WHERE id = ?`
    ).run(now(), now(), integration.id);

    const sellerAppUrl = clean(process.env.JB_SELLER_APP_URL);
    if (sellerAppUrl) {
      return res.redirect(`${sellerAppUrl.replace(/\/$/, "")}/?marketplace=amazon&connected=1`);
    }

    return res.json({
      success: true,
      message: "Amazon account authorized. Admin approval is required before syncing. Return to the Seller Panel.",
    });
  } catch (error) {
    console.error("AMAZON OAUTH CALLBACK ERROR:", error);
    res.status(500).json({ success: false, message: "Amazon authorization failed." });
  }
});

marketplacesRouter.post(
  "/api/sellers/marketplaces/:provider/test",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = sellerForRequest(req);
      const provider = getProvider(req.params.provider);
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      const integration = sellerIntegration(seller.id, provider.key);
      if (!integration) {
        return res.status(404).json({ success: false, message: "Connect this marketplace first." });
      }
      if (!provider.supportsSync) {
        return res.status(409).json({
          success: false,
          code: "API_ACCESS_REQUIRED",
          message: "Meesho does not provide a public seller API. Use the authorized bulk import.",
        });
      }

      try {
        const items = await fetchMarketplaceItems(integration, readAppCredentials(provider.key), 3);
        db.prepare(
          `UPDATE marketplace_integrations
           SET connectionStatus = 'Connected', lastTestedAt = ?, lastTestError = NULL, tokenError = NULL, updatedAt = ?
           WHERE id = ?`
        ).run(now(), now(), integration.id);

        res.json({
          success: true,
          message: `Connection OK — ${items.length} listing(s) read from ${provider.label}.`,
          sample: items.map((item) => ({
            sku: item.sku,
            name: item.name,
            price: item.price,
            stock: item.stock,
            listingStatus: item.listingStatus,
          })),
        });
      } catch (error) {
        db.prepare(
          `UPDATE marketplace_integrations
           SET connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?, updatedAt = ?
           WHERE id = ?`
        ).run(now(), error.message, now(), integration.id);

        res.status(502).json({ success: false, message: error.message });
      }
    } catch (error) {
      console.error("SELLER MARKETPLACE TEST ERROR:", error);
      res.status(500).json({ success: false, message: "Connection test failed." });
    }
  }
);

marketplacesRouter.post(
  "/api/sellers/marketplaces/:provider/sync",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = sellerForRequest(req);
      const provider = getProvider(req.params.provider);
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      const integration = sellerIntegration(seller.id, provider.key);
      if (!integration) {
        return res.status(404).json({ success: false, message: "Connect this marketplace first." });
      }

      if (!provider.supportsSync) {
        return res.status(409).json({
          success: false,
          code: "API_ACCESS_REQUIRED",
          message: "Meesho does not provide a public seller API. Use the authorized bulk import.",
        });
      }
      if (!readAppCredentials(provider.key).enabled) {
        return res.status(403).json({
          success: false,
          code: "PROVIDER_DISABLED",
          message: `${provider.label} integrations are disabled by the admin.`,
        });
      }
      if (integration.adminDisabled) {
        return res.status(403).json({
          success: false,
          code: "INTEGRATION_DISABLED",
          message: "The admin has disabled this marketplace connection.",
        });
      }
      if (integration.status !== "Approved") {
        return res.status(403).json({
          success: false,
          code: "INTEGRATION_NOT_APPROVED",
          message:
            integration.status === "Rejected"
              ? "This marketplace connection was rejected by the admin. Update it and resubmit."
              : "Your marketplace connection is waiting for admin approval.",
          status: integration.status,
        });
      }

      const result = await runMarketplaceSync(integration, "manual");

      res.json({
        success: result.status !== "failed",
        message:
          result.status === "failed"
            ? `Sync failed: ${result.errors[0] || "unknown error"}`
            : `Sync complete — ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
        result,
      });
    } catch (error) {
      console.error("SELLER MARKETPLACE SYNC ERROR:", error);
      res.status(error.code === "API_ACCESS_REQUIRED" ? 409 : 500).json({
        success: false,
        code: error.code || "SYNC_FAILED",
        message: error.message || "Sync failed.",
      });
    }
  }
);

marketplacesRouter.get(
  "/api/sellers/marketplaces/:provider/runs",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = sellerForRequest(req);
      const provider = getProvider(req.params.provider);
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      const runs = db
        .prepare(
          `SELECT * FROM marketplace_sync_runs
           WHERE sellerId = ? AND provider = ?
           ORDER BY id DESC LIMIT 30`
        )
        .all(seller.id, provider.key)
        .map((run) => {
          let errors = [];
          try {
            errors = JSON.parse(run.errorsJson || "[]");
          } catch {
            errors = [];
          }
          return { ...run, errors, errorsJson: undefined };
        });

      res.json({ success: true, runs });
    } catch (error) {
      console.error("SELLER MARKETPLACE RUNS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load sync history." });
    }
  }
);

marketplacesRouter.delete(
  "/api/sellers/marketplaces/:provider",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = sellerForRequest(req);
      const provider = getProvider(req.params.provider);
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      const integration = sellerIntegration(seller.id, provider.key);
      if (!integration) {
        return res.status(404).json({ success: false, message: "This marketplace is not connected." });
      }

      db.prepare(
        `UPDATE marketplace_integrations
         SET status = 'Disconnected', adminDisabled = 0, autoSync = 0, nextSyncAt = NULL,
             accessTokenEnc = NULL, tokenExpiresAt = NULL, credentialsEnc = NULL,
             connectionStatus = 'Disconnected', disconnectedAt = ?, updatedAt = ?
         WHERE id = ?`
      ).run(now(), now(), integration.id);

      res.json({
        success: true,
        message: `${provider.label} disconnected. Existing products stay in your catalog; no further sync will run.`,
        integration: publicIntegration(
          db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(integration.id)
        ),
      });
    } catch (error) {
      console.error("SELLER MARKETPLACE DISCONNECT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to disconnect marketplace." });
    }
  }
);

// =====================================================
// ADMIN ROUTES
// =====================================================

const adminGuard = [requireAuth, requireRole("super_admin", "manager")];

marketplacesRouter.get(
  "/api/admin/marketplaces",
  ...adminGuard,
  (req, res) => {
    try {
      const rows = db
        .prepare(
          `SELECT m.*, s.name AS sellerName, s.shopName AS shopName, s.sellerCode AS sellerCode
           FROM marketplace_integrations m
           JOIN sellers s ON s.id = m.sellerId
           ORDER BY CASE m.status WHEN 'Pending Approval' THEN 0 ELSE 1 END, m.id DESC`
        )
        .all();

      res.json({
        success: true,
        providers: providerList().map((provider) => publicProviderConfig(provider.key)),
        integrations: rows.map((row) => ({
          ...publicIntegration(row),
          sellerId: row.sellerId,
          sellerName: row.sellerName,
          shopName: row.shopName,
          sellerCode: row.sellerCode,
        })),
        settings: getImportSettings(),
      });
    } catch (error) {
      console.error("ADMIN MARKETPLACE LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load marketplace integrations." });
    }
  }
);

marketplacesRouter.put(
  "/api/admin/marketplaces/providers/:provider",
  ...adminGuard,
  (req, res) => {
    try {
      const provider = getProvider(req.params.provider);
      if (!provider) return res.status(404).json({ success: false, message: "Unknown marketplace." });

      const existing = readAppCredentials(provider.key);
      const incoming = {
        ...(req.body?.credentials && typeof req.body.credentials === "object"
          ? req.body.credentials
          : {}),
      };

      for (const field of provider.appFields) {
        if (req.body?.[field.key] !== undefined) incoming[field.key] = req.body[field.key];
      }

      const merged = { ...existing.data };
      for (const [key, value] of Object.entries(incoming)) {
        if (!provider.appFields.some((field) => field.key === key)) continue;
        if (value === null || value === "") delete merged[key];
        else merged[key] = clean(value).slice(0, 500);
      }

      const enabled =
        req.body?.enabled === undefined
          ? existing.enabled
          : Boolean(req.body.enabled);

      db.prepare(
        `INSERT INTO marketplace_providers (provider, enabled, credentialsEnc, updatedAt, updatedBy)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(provider) DO UPDATE SET
           enabled = excluded.enabled,
           credentialsEnc = excluded.credentialsEnc,
           updatedAt = excluded.updatedAt,
           updatedBy = excluded.updatedBy`
      ).run(
        provider.key,
        enabled ? 1 : 0,
        Object.keys(merged).length ? encryptSecret(JSON.stringify(merged)) : null,
        now(),
        clean(req.user?.name || req.user?.username || req.user?.role || "admin").slice(0, 80)
      );

      if (!enabled) {
        db.prepare(
          `UPDATE marketplace_integrations SET nextSyncAt = NULL WHERE provider = ?`
        ).run(provider.key);
      } else {
        refreshNextSyncAt();
      }

      res.json({
        success: true,
        message: `${provider.label} ${enabled ? "enabled" : "disabled"} and settings saved.`,
        provider: publicProviderConfig(provider.key),
      });
    } catch (error) {
      console.error("ADMIN MARKETPLACE PROVIDER SAVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save marketplace settings." });
    }
  }
);

marketplacesRouter.post(
  "/api/admin/marketplaces/:id/approve",
  ...adminGuard,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const integration = db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(id);
      if (!integration) return res.status(404).json({ success: false, message: "Integration not found." });

      const provider = getProvider(integration.provider);
      if (!provider.supportsSync) {
        return res.status(409).json({
          success: false,
          code: "API_ACCESS_REQUIRED",
          message: `${provider.label} has no public seller API; there is nothing to approve. Use bulk import.`,
        });
      }
      if (!readAppCredentials(provider.key).enabled) {
        return res.status(409).json({
          success: false,
          message: `${provider.label} is disabled globally. Enable the provider first.`,
        });
      }

      db.prepare(
        `UPDATE marketplace_integrations
         SET status = 'Approved', rejectionReason = NULL, adminDisabled = 0, updatedAt = ?
         WHERE id = ?`
      ).run(now(), id);

      refreshNextSyncAt(id);

      res.json({
        success: true,
        message: `${provider.label} connection approved.`,
        integration: publicIntegration(
          db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(id)
        ),
      });
    } catch (error) {
      console.error("ADMIN MARKETPLACE APPROVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to approve integration." });
    }
  }
);

marketplacesRouter.post(
  "/api/admin/marketplaces/:id/reject",
  ...adminGuard,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const reason = clean(req.body?.reason).slice(0, 500);

      const result = db
        .prepare(
          `UPDATE marketplace_integrations
           SET status = 'Rejected', rejectionReason = ?, autoSync = 0, nextSyncAt = NULL, updatedAt = ?
           WHERE id = ?`
        )
        .run(reason || "Rejected by admin.", now(), id);

      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: "Integration not found." });
      }

      res.json({
        success: true,
        message: "Marketplace integration rejected.",
        integration: publicIntegration(
          db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(id)
        ),
      });
    } catch (error) {
      console.error("ADMIN MARKETPLACE REJECT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to reject integration." });
    }
  }
);

// Admin kill-switch for ONE seller's connection (separate from the
// provider-wide enable/disable switch).
marketplacesRouter.post(
  "/api/admin/marketplaces/:id/toggle",
  ...adminGuard,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const integration = db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(id);
      if (!integration) return res.status(404).json({ success: false, message: "Integration not found." });

      const disabled = req.body?.disabled === undefined ? !integration.adminDisabled : Boolean(req.body.disabled);

      db.prepare(
        `UPDATE marketplace_integrations
         SET adminDisabled = ?, nextSyncAt = NULL, updatedAt = ?
         WHERE id = ?`
      ).run(disabled ? 1 : 0, now(), id);

      if (!disabled) refreshNextSyncAt(id);

      res.json({
        success: true,
        message: disabled
          ? "Connection disabled — no sync will run until re-enabled."
          : "Connection re-enabled.",
        integration: publicIntegration(
          db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(id)
        ),
      });
    } catch (error) {
      console.error("ADMIN MARKETPLACE TOGGLE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update the connection." });
    }
  }
);

marketplacesRouter.post(
  "/api/admin/marketplaces/:id/sync",
  ...adminGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const integration = db.prepare(`SELECT * FROM marketplace_integrations WHERE id = ?`).get(id);
      if (!integration) return res.status(404).json({ success: false, message: "Integration not found." });

      if (integration.status !== "Approved" || integration.adminDisabled) {
        return res.status(409).json({
          success: false,
          message: "Approve and enable this connection before syncing it.",
        });
      }

      const result = await runMarketplaceSync(integration, "admin_manual");

      res.json({
        success: result.status !== "failed",
        message:
          result.status === "failed"
            ? `Sync failed: ${result.errors[0] || "unknown error"}`
            : `Sync complete — ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
        result,
      });
    } catch (error) {
      console.error("ADMIN MARKETPLACE SYNC ERROR:", error);
      res.status(500).json({ success: false, message: error.message || "Sync failed." });
    }
  }
);

marketplacesRouter.get(
  "/api/admin/marketplace-sync-runs",
  ...adminGuard,
  (req, res) => {
    try {
      const runs = db
        .prepare(
          `SELECT r.*, s.name AS sellerName, s.shopName AS shopName, m.accountLabel
           FROM marketplace_sync_runs r
           JOIN sellers s ON s.id = r.sellerId
           LEFT JOIN marketplace_integrations m ON m.id = r.integrationId
           ORDER BY r.id DESC LIMIT 100`
        )
        .all()
        .map((run) => {
          let errors = [];
          try {
            errors = JSON.parse(run.errorsJson || "[]");
          } catch {
            errors = [];
          }
          return { ...run, errors, errorsJson: undefined };
        });

      res.json({ success: true, runs });
    } catch (error) {
      console.error("ADMIN MARKETPLACE RUNS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load marketplace sync history." });
    }
  }
);

// =====================================================
// SCHEDULER (same admin schedule as supplier sync)
// =====================================================

let marketplaceTimer = null;
let marketplaceTickAt = 0;

async function runDueMarketplaceSyncs() {
  const settings = getImportSettings();
  if (!settings.autoSyncEnabled) return { ran: 0 };

  const nowMs = Date.now();
  if (nowMs - marketplaceTickAt < 55 * 1000) return { ran: 0 };
  marketplaceTickAt = nowMs;

  const rows = db
    .prepare(
      `SELECT m.* FROM marketplace_integrations m
       JOIN marketplace_providers p ON p.provider = m.provider
       WHERE m.status = 'Approved' AND m.autoSync = 1 AND m.adminDisabled = 0 AND p.enabled = 1`
    )
    .all();

  let ran = 0;

  for (const integration of rows) {
    if (!providerSupports(integration.provider)) continue;

    const due = integration.nextSyncAt ? Date.parse(integration.nextSyncAt) : null;
    if (due !== null && Number.isFinite(due) && nowMs < due) continue;

    try {
      await runMarketplaceSync(integration, "scheduled");
      ran++;
    } catch (error) {
      console.error("SCHEDULED MARKETPLACE SYNC ERROR:", integration.id, error.message);
    }
  }

  return { ran };
}

function startMarketplaceScheduler() {
  if (marketplaceTimer) return;

  refreshNextSyncAt();

  marketplaceTimer = setInterval(() => {
    runDueMarketplaceSyncs().catch((error) => {
      console.error("MARKETPLACE SCHEDULER ERROR:", error.message);
    });
  }, 60 * 1000);

  if (typeof marketplaceTimer.unref === "function") marketplaceTimer.unref();
}

// =====================================================
// CHECKOUT STOCK GUARD (fail closed)
// =====================================================

const CHECKOUT_REFRESH_TTL_MS = Number.isFinite(Number(process.env.JB_CHECKOUT_REFRESH_TTL_MS))
  ? Math.max(0, Number(process.env.JB_CHECKOUT_REFRESH_TTL_MS))
  : 30 * 1000;
const checkoutCache = new Map();

async function refreshIntegrationForCheckout(integration, skus) {
  const settings = getImportSettings();
  const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(integration.sellerId);
  if (!seller) throw new Error("Seller not found for this marketplace.");

  const items = await fetchMarketplaceItems(
    integration,
    readAppCredentials(integration.provider),
    settings.maxSyncItems
  );

  const wanted = new Set(skus.map((sku) => clean(sku).toLowerCase()).filter(Boolean));
  const found = new Set();

  const tx = db.transaction(() => {
    for (const item of items) {
      const sku = clean(item.sku).toLowerCase();
      if (!sku || !wanted.has(sku)) continue;

      const result = applyMarketplaceItem({ seller, integration, item, allowCreate: false });
      if (result.status === "updated") found.add(sku);
    }
  });
  tx();

  return found;
}

export async function marketplaceCheckoutStockGuard(req, res, next) {
  if (req.method !== "POST" || !/^\/api\/orders\/?$/.test(req.path)) return next();

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return next();

  const ids = items
    .map((item) => Number(item.productId || item.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return next();

  const groups = new Map();

  try {
    const placeholders = ids.map(() => "?").join(",");
    const products = db
      .prepare(
        `SELECT id, name, sku, source, sourceRef FROM products WHERE id IN (${placeholders})`
      )
      .all(...ids);

    for (const product of products) {
      if (product.source !== "marketplace_api") continue;
      const match = /^marketplace:(\d+)$/.exec(String(product.sourceRef || ""));
      if (!match) continue;

      const integrationId = Number(match[1]);
      if (!groups.has(integrationId)) groups.set(integrationId, []);
      groups.get(integrationId).push(product);
    }

    for (const [integrationId, groupProducts] of groups) {
      const integration = db
        .prepare(
          `SELECT * FROM marketplace_integrations WHERE id = ? AND status = 'Approved' AND adminDisabled = 0`
        )
        .get(integrationId);

      if (!integration) {
        return res.status(409).json({
          success: false,
          code: "STOCK_UNVERIFIED",
          message: `"${groupProducts[0].name}" is temporarily unavailable — its marketplace connection is not active.`,
        });
      }

      if (!readAppCredentials(integration.provider).enabled) {
        return res.status(409).json({
          success: false,
          code: "STOCK_UNVERIFIED",
          message: `"${groupProducts[0].name}" is temporarily unavailable — ${integration.provider} is disabled.`,
        });
      }

      const cached = checkoutCache.get(integrationId);
      if (cached && Date.now() - cached.at < CHECKOUT_REFRESH_TTL_MS) continue;

      try {
        const found = await refreshIntegrationForCheckout(
          integration,
          groupProducts.map((product) => product.sku)
        );

        const missing = groupProducts.filter(
          (product) => !found.has(clean(product.sku).toLowerCase())
        );

        if (missing.length > 0) {
          db.prepare(
            `UPDATE products SET stockUnverified = 1
             WHERE id IN (${missing.map(() => "?").join(",")})`
          ).run(...missing.map((product) => product.id));

          return res.status(409).json({
            success: false,
            code: "STOCK_UNVERIFIED",
            message: `"${missing[0].name}" is no longer active on ${integration.provider}. Nothing was ordered — please remove it from your cart.`,
          });
        }

        checkoutCache.set(integrationId, { at: Date.now() });
      } catch (error) {
        db.prepare(
          `UPDATE products SET stockUnverified = 1
           WHERE source = 'marketplace_api' AND sourceRef = ?`
        ).run(`marketplace:${integrationId}`);
        checkoutCache.delete(integrationId);

        return res.status(409).json({
          success: false,
          code: "STOCK_UNVERIFIED",
          message: `"${groupProducts[0].name}" — live ${integration.provider} stock could not be confirmed (${error.message}). Nothing was ordered; please try again shortly.`,
        });
      }
    }

    return next();
  } catch (error) {
    console.error("MARKETPLACE CHECKOUT GUARD ERROR:", error);

    if (groups.size > 0) {
      return res.status(503).json({
        success: false,
        code: "STOCK_UNVERIFIED",
        message: "Live marketplace stock could not be verified. Nothing was ordered; please try again shortly.",
      });
    }

    return next();
  }
}

// =====================================================
// INIT
// =====================================================

export function initMarketplaces() {
  ensureMarketplaceTables();
  // Follow the admin's shared schedule (default 00:00 Asia/Kolkata).
  onScheduleChanged(() => refreshNextSyncAt());
  startMarketplaceScheduler();
  console.log("Marketplace connectors ready (Amazon, Flipkart, Meesho, GlowRoad).");
}

export { PROVIDERS as MARKETPLACE_PROVIDERS, runMarketplaceSync };
export default marketplacesRouter;
