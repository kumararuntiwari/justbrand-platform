// =====================================================
// JUSTBRAND — SUPPLIER / MANUFACTURER INTEGRATIONS
// =====================================================
// Admin-controlled supplier onboarding on top of the existing supplier
// product sync:
//   • separate product / stock / price / order endpoints
//   • encrypted credentials and webhook secret (AES-256-GCM)
//   • product sync + connection test
//   • multi-seller order split, one idempotent supplier order per
//     seller/order, automatic retries and status/tracking refresh
//   • signed supplier webhooks with replay protection
//
// Honesty rules:
//   • A configured integration is NOT "integrated" until its real
//     endpoint answers a connection test. The Admin UI shows Untested /
//     Error / Connected separately.
//   • No supplier order is invented. A job only becomes `synced` after
//     the supplier API returns a successful response.
//   • Credentials never leave the server. Responses contain only
//     booleans and a masked hint.
// =====================================================

import express from "express";
import crypto from "node:crypto";

import db from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import { courierAdapterStatus } from "./courier-adapters/index.js";
import {
  encryptSecret,
  decryptSecret,
  secretHint,
  publicIntegration,
  fetchSupplierItems,
  normalizeSupplierItem,
  readMapping,
  supplierUrl,
  integrationHeaders,
  assertPublicUrl,
  runSupplierSync,
} from "./seller-imports.js";

export const supplierIntegrationsRouter = express.Router();

const MAX_RESPONSE_BYTES = 1024 * 1024;
const REQUEST_TIMEOUT_MS = 20000;
const MAX_ORDER_ATTEMPTS = 5;

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

function bool(value) {
  return value === true || value === 1 || value === "1" || value === "true";
}

function parseJson(value, fallback = null) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}

function short(value, limit = 500) {
  return clean(value).slice(0, limit);
}

const ADMIN_ROLES = ["super_admin", "manager"];

// =====================================================
// TABLES
// =====================================================

function ensureSupplierOrderTables() {
  // These columns are normally added by initSellerImports(). Repeating
  // the additive check here keeps this module safe when mounted alone.
  const columns = db
    .prepare(`PRAGMA table_info(seller_api_integrations)`)
    .all()
    .map((column) => column.name);

  const additions = [
    ["stockPath", "TEXT"],
    ["pricePath", "TEXT"],
    ["orderPath", "TEXT"],
    ["orderStatusPath", "TEXT"],
    ["webhookSecretEnc", "TEXT"],
    ["enabled", "INTEGER NOT NULL DEFAULT 1"],
    ["orderSyncEnabled", "INTEGER NOT NULL DEFAULT 0"],
    ["lastOrderSyncAt", "TEXT"],
    ["lastOrderSyncError", "TEXT"],
  ];

  for (const [name, definition] of additions) {
    if (!columns.includes(name)) {
      db.prepare(`ALTER TABLE seller_api_integrations ADD COLUMN ${name} ${definition}`).run();
    }
  }

  db.prepare(`
    CREATE TABLE IF NOT EXISTS supplier_order_jobs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      orderId INTEGER NOT NULL,
      integrationId INTEGER NOT NULL,
      sellerId INTEGER NOT NULL,
      sellerCode TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      attempts INTEGER NOT NULL DEFAULT 0,
      nextRetryAt TEXT,
      externalOrderId TEXT,
      externalStatus TEXT,
      trackingNumber TEXT,
      trackingUrl TEXT,
      lastError TEXT,
      lastResponseJson TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL,
      syncedAt TEXT,
      UNIQUE(orderId, integrationId)
    )
  `).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_supplier_order_jobs_due
     ON supplier_order_jobs (status, nextRetryAt, id)`
  ).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_supplier_order_jobs_integration
     ON supplier_order_jobs (integrationId, id DESC)`
  ).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS supplier_webhook_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integrationId INTEGER NOT NULL,
      eventKey TEXT NOT NULL,
      eventType TEXT,
      orderNumber TEXT,
      externalOrderId TEXT,
      status TEXT,
      receivedAt TEXT NOT NULL,
      processedAt TEXT,
      result TEXT,
      UNIQUE(integrationId, eventKey)
    )
  `).run();

  // A buyer order is split into one job per seller automatically. The
  // trigger is additive and only inserts a job when an ACTIVE supplier
  // has order sync enabled and a real order endpoint configured.
  db.prepare(`DROP TRIGGER IF EXISTS trg_supplier_order_job`).run();
  db.prepare(`
    CREATE TRIGGER trg_supplier_order_job
    AFTER INSERT ON order_items
    BEGIN
      INSERT OR IGNORE INTO supplier_order_jobs
        (orderId, integrationId, sellerId, sellerCode, status, attempts, createdAt, updatedAt)
      SELECT
        NEW.orderId, i.id, i.sellerId, s.sellerCode, 'pending', 0,
        strftime('%Y-%m-%dT%H:%M:%fZ','now'),
        strftime('%Y-%m-%dT%H:%M:%fZ','now')
      FROM seller_api_integrations i
      JOIN sellers s ON s.id = i.sellerId
      WHERE s.sellerCode = NEW.sellerId
        AND i.status = 'Approved'
        AND i.enabled = 1
        AND i.orderSyncEnabled = 1
        AND i.orderPath IS NOT NULL
        AND TRIM(i.orderPath) <> '';
    END
  `).run();
}

// =====================================================
// ADMIN SHAPES / VALIDATION
// =====================================================

function integrationWithSeller(row) {
  if (!row) return null;
  return {
    ...publicIntegration(row),
    sellerId: row.sellerId,
    sellerName: row.sellerName || null,
    shopName: row.shopName || null,
    sellerCode: row.sellerCode || null,
    jobCounts: row.jobCounts || {
      pending: 0,
      failed: 0,
      synced: 0,
    },
    webhookUrl: `/api/supplier-webhook/${row.id}`,
  };
}

function readIntegration(id) {
  return db
    .prepare(
      `SELECT i.*, s.name AS sellerName, s.shopName AS shopName, s.sellerCode AS sellerCode
       FROM seller_api_integrations i
       LEFT JOIN sellers s ON s.id = i.sellerId
       WHERE i.id = ?`
    )
    .get(Number(id));
}

function jobCounts(integrationId) {
  const rows = db
    .prepare(
      `SELECT status, COUNT(*) AS count
       FROM supplier_order_jobs
       WHERE integrationId = ?
       GROUP BY status`
    )
    .all(integrationId);

  const counts = { pending: 0, failed: 0, synced: 0, processing: 0 };
  for (const row of rows) counts[row.status] = Number(row.count) || 0;
  return counts;
}

function validatePaths(body) {
  for (const key of ["productsPath", "stockPath", "pricePath", "orderPath", "orderStatusPath"]) {
    if (body[key] === undefined) continue;
    const value = clean(body[key]);
    if (!value) continue;
    if (value.length > 500) return `${key} is too long.`;
    // A full URL is allowed only through the same public-host guard.
    if (/^https?:\/\//i.test(value)) {
      try {
        assertPublicUrl(value);
      } catch (error) {
        return `${key}: ${error.message}`;
      }
    }
    if (!/^https?:\/\//i.test(value) && !value.startsWith("/")) {
      return `${key} must start with / (for example /api/products).`;
    }
  }

  if (body.orderSyncEnabled && !clean(body.orderPath)) {
    return "Order sync requires an Order API endpoint.";
  }
  return "";
}

function saveIntegration(body, existing) {
  const sellerId = existing ? existing.sellerId : Number(body.sellerId);
  const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(sellerId);
  if (!seller) return { error: "Choose a valid seller / supplier." };

  const baseUrl = clean(body.baseUrl).slice(0, 500);
  if (!baseUrl) return { error: "API Base URL is required." };
  try {
    assertPublicUrl(baseUrl);
  } catch (error) {
    return { error: error.message };
  }

  const authType = clean(body.authType || "api_key").toLowerCase();
  if (!["none", "api_key", "bearer", "basic", "crmkey"].includes(authType)) {
    return { error: "Unsupported authentication type." };
  }

  const pathError = validatePaths({ ...existing, ...body });
  if (pathError) return { error: pathError };

  const frequency = Number(body.syncFrequencyMinutes ?? 1440);
  if (!Number.isInteger(frequency) || frequency < 15 || frequency > 10080) {
    return { error: "Sync frequency must be between 15 and 10080 minutes." };
  }

  let mapping = existing?.mappingJson ? readMapping(existing.mappingJson) : null;
  if (body.mapping !== undefined) {
    if (typeof body.mapping === "string") {
      try {
        mapping = body.mapping.trim() ? JSON.parse(body.mapping) : null;
      } catch {
        return { error: "Field mapping must be valid JSON." };
      }
    } else if (body.mapping && typeof body.mapping === "object") {
      mapping = body.mapping;
    }
  }

  const apiKey = clean(body.apiKey);
  const apiSecret = clean(body.apiSecret);
  const webhookSecret = clean(body.webhookSecret);

  if (webhookSecret && webhookSecret.length < 8) {
    return { error: "Webhook verification secret must be at least 8 characters." };
  }

  const credentialChanged =
    Boolean(apiKey) ||
    Boolean(apiSecret) ||
    Boolean(webhookSecret) ||
    Boolean(
      existing &&
        (existing.baseUrl !== baseUrl ||
          clean(existing.productsPath) !== clean(body.productsPath ?? existing.productsPath) ||
          clean(existing.stockPath) !== clean(body.stockPath ?? existing.stockPath) ||
          clean(existing.pricePath) !== clean(body.pricePath ?? existing.pricePath))
    );

  const values = {
    providerName: clean(body.providerName || seller.shopName || seller.name).slice(0, 120),
    baseUrl,
    authType,
    authHeaderName: clean(body.authHeaderName || "X-API-Key").slice(0, 60),
    apiKeyEnc: apiKey ? encryptSecret(apiKey) : existing?.apiKeyEnc || null,
    apiKeyHint: apiKey ? secretHint(apiKey) : existing?.apiKeyHint || null,
    apiSecretEnc: apiSecret ? encryptSecret(apiSecret) : existing?.apiSecretEnc || null,
    webhookSecretEnc: webhookSecret
      ? encryptSecret(webhookSecret)
      : existing?.webhookSecretEnc || null,
    productsPath: clean(body.productsPath ?? existing?.productsPath ?? "/products") || "/products",
    productsKey: clean(body.productsKey ?? existing?.productsKey).slice(0, 200),
    stockPath: clean(body.stockPath ?? existing?.stockPath).slice(0, 500),
    pricePath: clean(body.pricePath ?? existing?.pricePath).slice(0, 500),
    orderPath: clean(body.orderPath ?? existing?.orderPath).slice(0, 500),
    orderStatusPath: clean(body.orderStatusPath ?? existing?.orderStatusPath).slice(0, 500),
    mappingJson: mapping ? JSON.stringify(mapping) : existing?.mappingJson || null,
    syncFrequencyMinutes: frequency,
    autoSync:
      body.autoSync === undefined
        ? existing?.autoSync === undefined
          ? 0
          : Number(existing.autoSync)
        : bool(body.autoSync)
          ? 1
          : 0,
    enabled:
      body.enabled === undefined
        ? existing?.enabled === undefined
          ? 1
          : Number(existing.enabled)
        : bool(body.enabled)
          ? 1
          : 0,
    orderSyncEnabled:
      body.orderSyncEnabled === undefined
        ? existing?.orderSyncEnabled === undefined
          ? 0
          : Number(existing.orderSyncEnabled)
        : bool(body.orderSyncEnabled)
          ? 1
          : 0,
    connectionStatus: credentialChanged
      ? "Untested"
      : existing?.connectionStatus || "Untested",
    lastTestError: credentialChanged ? null : existing?.lastTestError || null,
    updatedAt: now(),
  };

  if (existing) {
    db.prepare(`
      UPDATE seller_api_integrations SET
        providerName = ?, baseUrl = ?, authType = ?, authHeaderName = ?,
        apiKeyEnc = ?, apiKeyHint = ?, apiSecretEnc = ?, webhookSecretEnc = ?,
        productsPath = ?, productsKey = ?, stockPath = ?, pricePath = ?,
        orderPath = ?, orderStatusPath = ?, mappingJson = ?,
        syncFrequencyMinutes = ?, autoSync = ?, enabled = ?, orderSyncEnabled = ?,
        status = 'Approved', rejectionReason = NULL,
        connectionStatus = ?, lastTestError = ?, nextSyncAt = ?,
        syncRetryCount = 0, updatedAt = ?
      WHERE id = ?
    `).run(
      values.providerName,
      values.baseUrl,
      values.authType,
      values.authHeaderName,
      values.apiKeyEnc,
      values.apiKeyHint,
      values.apiSecretEnc,
      values.webhookSecretEnc,
      values.productsPath,
      values.productsKey,
      values.stockPath,
      values.pricePath,
      values.orderPath,
      values.orderStatusPath,
      values.mappingJson,
      values.syncFrequencyMinutes,
      values.autoSync,
      values.enabled,
      values.orderSyncEnabled,
      values.connectionStatus,
      values.lastTestError,
      values.autoSync
        ? new Date(Date.now() + values.syncFrequencyMinutes * 60 * 1000).toISOString()
        : null,
      values.updatedAt,
      existing.id
    );
    return { integration: readIntegration(existing.id) };
  }

  const result = db.prepare(`
    INSERT INTO seller_api_integrations (
      sellerId, providerName, baseUrl, authType, authHeaderName,
      apiKeyEnc, apiKeyHint, apiSecretEnc, webhookSecretEnc,
      productsPath, productsKey, stockPath, pricePath,
      orderPath, orderStatusPath, mappingJson,
      status, syncFrequencyMinutes, autoSync, enabled, orderSyncEnabled,
      connectionStatus, nextSyncAt, createdAt, updatedAt
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
            'Approved', ?, ?, ?, ?, 'Untested', ?, ?, ?)
  `).run(
    seller.id,
    values.providerName,
    values.baseUrl,
    values.authType,
    values.authHeaderName,
    values.apiKeyEnc,
    values.apiKeyHint,
    values.apiSecretEnc,
    values.webhookSecretEnc,
    values.productsPath,
    values.productsKey,
    values.stockPath,
    values.pricePath,
    values.orderPath,
    values.orderStatusPath,
    values.mappingJson,
    values.syncFrequencyMinutes,
    values.autoSync,
    values.enabled,
    values.orderSyncEnabled,
    values.autoSync
      ? new Date(Date.now() + values.syncFrequencyMinutes * 60 * 1000).toISOString()
      : null,
    now(),
    values.updatedAt
  );

  return { integration: readIntegration(result.lastInsertRowid) };
}

// =====================================================
// HTTP HELPERS
// =====================================================

async function requestJson(url, { method = "GET", headers = {}, body } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      redirect: "error",
      signal: controller.signal,
    });

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_RESPONSE_BYTES) {
      throw new Error("Supplier API response is too large (over 1 MB).");
    }

    const text = buffer.toString("utf8");
    let data = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = null;
    }

    return { ok: response.ok, status: response.status, data, text };
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Supplier API timed out after 20 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function pickAny(source, paths) {
  let current = source;
  for (const path of paths) {
    let value = source;
    for (const segment of String(path).split(".")) {
      if (value === null || value === undefined) break;
      value = value[segment];
    }
    if (value !== undefined && value !== null && clean(value) !== "") return value;
  }
  return current === source ? undefined : current;
}

function orderPayload(order, items, seller) {
  return {
    orderNumber: order.orderNumber,
    placedAt: order.createdAt,
    seller: {
      code: seller.sellerCode,
      name: seller.name,
      shopName: seller.shopName || null,
    },
    customer: {
      name: order.customerName,
      phone: order.phone,
      email: order.email || null,
      address: order.address,
      city: order.city || null,
      state: order.state || null,
      pincode: order.pincode || null,
    },
    items: items.map((item) => ({
      sku: item.sku || null,
      name: item.productName,
      quantity: Number(item.quantity) || 1,
      price: Number(item.price) || 0,
    })),
    payment: {
      method: order.paymentMethod,
      status: order.paymentStatus,
    },
    totalAmount: Number(order.totalAmount) || 0,
    notes: "JustBrand marketplace order",
  };
}

function resolvePathTemplate(template, job) {
  return clean(template)
    .replace(/\{externalOrderId\}/g, encodeURIComponent(job.externalOrderId || ""))
    .replace(/\{orderNumber\}/g, encodeURIComponent(job.orderNumber || ""));
}

async function processOrderJob(jobId) {
  const job = db
    .prepare(
      `SELECT j.*, o.orderNumber, o.customerName, o.phone, o.email, o.address,
              o.city, o.state, o.pincode, o.paymentMethod, o.paymentStatus,
              o.totalAmount, o.createdAt AS orderCreatedAt,
              i.providerName, i.baseUrl, i.authType, i.authHeaderName,
              i.apiKeyEnc, i.apiSecretEnc, i.extraHeadersEnc,
              i.orderPath, i.orderSyncEnabled, i.enabled AS integrationEnabled,
              i.status AS integrationStatus,
              s.sellerCode, s.name AS sellerName, s.shopName
       FROM supplier_order_jobs j
       JOIN orders o ON o.id = j.orderId
       JOIN seller_api_integrations i ON i.id = j.integrationId
       JOIN sellers s ON s.id = j.sellerId
       WHERE j.id = ?`
    )
    .get(Number(jobId));

  if (!job) throw new Error("Supplier order job not found.");
  if (job.integrationStatus !== "Approved" || !Number(job.integrationEnabled)) {
    throw new Error("Supplier integration is not active.");
  }
  if (!Number(job.orderSyncEnabled) || !clean(job.orderPath)) {
    throw new Error("Order sync is not configured for this supplier.");
  }

  const claimed = db
    .prepare(
      `UPDATE supplier_order_jobs
       SET status = 'processing', updatedAt = ?
       WHERE id = ? AND status IN ('pending', 'failed')`
    )
    .run(now(), job.id);

  if (!claimed.changes) {
    return { skipped: true, message: "Job is already being processed or completed." };
  }

  const items = db
    .prepare(
      `SELECT oi.*, p.sku
       FROM order_items oi
       LEFT JOIN products p ON p.id = oi.productId
       WHERE oi.orderId = ? AND oi.sellerId = ?
       ORDER BY oi.id`
    )
    .all(job.orderId, job.sellerCode);

  const order = {
    ...job,
    createdAt: job.orderCreatedAt,
  };

  try {
    const url = supplierUrl(job, job.orderPath);
    const headers = {
      ...integrationHeaders(job),
      "Content-Type": "application/json",
      "Idempotency-Key": `jb-${job.orderNumber}-${job.integrationId}`,
    };
    const response = await requestJson(url, {
      method: "POST",
      headers,
      body: orderPayload(
        order,
        items,
        { sellerCode: job.sellerCode, name: job.sellerName, shopName: job.shopName }
      ),
    });

    if (!response.ok) {
      throw new Error(
        `Supplier order API returned HTTP ${response.status}${
          response.data?.message ? ` — ${short(response.data.message, 200)}` : ""
        }`
      );
    }

    const data = response.data || {};
    const externalOrderId = clean(
      pickAny(data, ["orderId", "order_id", "id", "data.orderId", "data.order_id", "data.id"])
    );
    const externalStatus = clean(
      pickAny(data, ["status", "orderStatus", "order_status", "data.status"])
    );
    const trackingNumber = clean(
      pickAny(data, [
        "trackingNumber",
        "tracking_number",
        "awb",
        "awbNumber",
        "data.trackingNumber",
        "data.awb",
      ])
    );
    const trackingUrl = clean(
      pickAny(data, ["trackingUrl", "tracking_url", "data.trackingUrl"])
    );

    if (!externalOrderId && !externalStatus && !trackingNumber) {
      throw new Error(
        "Supplier accepted the request but returned no order id, status or tracking reference. Not marked as synced."
      );
    }

    db.prepare(`
      UPDATE supplier_order_jobs SET
        status = 'synced', externalOrderId = ?, externalStatus = ?,
        trackingNumber = ?, trackingUrl = ?, lastError = NULL,
        lastResponseJson = ?, syncedAt = ?, updatedAt = ?
      WHERE id = ?
    `).run(
      externalOrderId || null,
      externalStatus || "Accepted",
      trackingNumber || null,
      trackingUrl || null,
      JSON.stringify({
        ok: true,
        status: response.status,
        externalOrderId: externalOrderId || null,
        externalStatus: externalStatus || null,
        trackingNumber: trackingNumber || null,
      }),
      now(),
      now(),
      job.id
    );

    db.prepare(
      `UPDATE seller_api_integrations
       SET lastOrderSyncAt = ?, lastOrderSyncError = NULL, updatedAt = ?
       WHERE id = ?`
    ).run(now(), now(), job.integrationId);

    return {
      ok: true,
      jobId: job.id,
      status: "synced",
      externalOrderId: externalOrderId || null,
      externalStatus: externalStatus || "Accepted",
      trackingNumber: trackingNumber || null,
    };
  } catch (error) {
    const message = short(error.message || "Supplier order sync failed.", 500);
    const attempts = Number(job.attempts) + 1;
    const retry = attempts < MAX_ORDER_ATTEMPTS;
    const nextRetryAt = retry
      ? new Date(Date.now() + Math.min(60, 5 * attempts) * 60 * 1000).toISOString()
      : null;

    db.prepare(`
      UPDATE supplier_order_jobs SET
        status = 'failed', attempts = ?, nextRetryAt = ?, lastError = ?, updatedAt = ?
      WHERE id = ?
    `).run(attempts, nextRetryAt, message, now(), job.id);

    db.prepare(
      `UPDATE seller_api_integrations
       SET lastOrderSyncError = ?, lastOrderSyncAt = ?, updatedAt = ?
       WHERE id = ?`
    ).run(message, now(), now(), job.integrationId);

    return { ok: false, jobId: job.id, status: "failed", attempts, retry, message };
  }
}

let processing = false;
let orderTimer = null;
let statusTimer = null;

async function processDueOrderJobs({ integrationId = null, limit = 10 } = {}) {
  if (processing) return { skipped: true, message: "Worker already running." };
  processing = true;

  try {
    const due = db
      .prepare(
        `SELECT id FROM supplier_order_jobs
         WHERE status IN ('pending', 'failed')
           AND (nextRetryAt IS NULL OR nextRetryAt <= ?)
           ${integrationId ? "AND integrationId = ?" : ""}
         ORDER BY id
         LIMIT ?`
      )
      .all(
        ...(integrationId ? [now(), Number(integrationId), Number(limit) || 10] : [now(), Number(limit) || 10])
      );

    const results = [];
    for (const row of due) {
      results.push(await processOrderJob(row.id));
    }
    return { processed: results.length, results };
  } finally {
    processing = false;
  }
}

async function syncOrderStatus(jobId) {
  const job = db
    .prepare(
      `SELECT j.*, o.orderNumber,
              i.orderStatusPath, i.providerName, i.baseUrl, i.authType,
              i.authHeaderName, i.apiKeyEnc, i.apiSecretEnc, i.extraHeadersEnc,
              i.status AS integrationStatus, i.enabled AS integrationEnabled
       FROM supplier_order_jobs j
       JOIN orders o ON o.id = j.orderId
       JOIN seller_api_integrations i ON i.id = j.integrationId
       WHERE j.id = ?`
    )
    .get(Number(jobId));

  if (!job) throw new Error("Supplier order job not found.");
  if (job.integrationStatus !== "Approved" || !Number(job.integrationEnabled)) {
    throw new Error("Supplier integration is not active.");
  }
  if (!clean(job.orderStatusPath)) {
    throw new Error("No order status endpoint is configured for this supplier.");
  }
  if (!job.externalOrderId && !job.orderNumber) {
    throw new Error("The supplier order has not been created yet.");
  }

  const path = resolvePathTemplate(job.orderStatusPath, job);
  const url = supplierUrl(job, path);
  const response = await requestJson(url, {
    method: "GET",
    headers: integrationHeaders(job),
  });

  if (!response.ok) {
    throw new Error(`Supplier status API returned HTTP ${response.status}.`);
  }

  const data = response.data || {};
  const externalStatus = clean(
    pickAny(data, ["status", "orderStatus", "order_status", "data.status"])
  );
  const trackingNumber = clean(
    pickAny(data, [
      "trackingNumber",
      "tracking_number",
      "awb",
      "awbNumber",
      "data.trackingNumber",
      "data.awb",
    ])
  );
  const trackingUrl = clean(
    pickAny(data, ["trackingUrl", "tracking_url", "data.trackingUrl"])
  );

  if (!externalStatus && !trackingNumber) {
    throw new Error("Supplier status response contained no status or tracking reference.");
  }

  db.prepare(
    `UPDATE supplier_order_jobs
     SET externalStatus = COALESCE(?, externalStatus),
         trackingNumber = COALESCE(?, trackingNumber),
         trackingUrl = COALESCE(?, trackingUrl),
         lastError = NULL, updatedAt = ?
     WHERE id = ?`
  ).run(
    externalStatus || null,
    trackingNumber || null,
    trackingUrl || null,
    now(),
    job.id
  );

  return {
    ok: true,
    jobId: job.id,
    externalStatus: externalStatus || null,
    trackingNumber: trackingNumber || null,
    trackingUrl: trackingUrl || null,
  };
}

// =====================================================
// ADMIN ROUTES
// =====================================================

const adminGuard = [requireAuth, requireRole(...ADMIN_ROLES)];

supplierIntegrationsRouter.get(
  "/api/admin/supplier-integrations",
  ...adminGuard,
  (req, res) => {
    try {
      const rows = db
        .prepare(
          `SELECT i.*, s.name AS sellerName, s.shopName AS shopName, s.sellerCode AS sellerCode
           FROM seller_api_integrations i
           LEFT JOIN sellers s ON s.id = i.sellerId
           ORDER BY i.id DESC`
        )
        .all()
        .map((row) => ({ ...row, jobCounts: jobCounts(row.id) }));

      const sellers = db
        .prepare(`SELECT id, name, shopName, sellerCode, status FROM sellers ORDER BY name`)
        .all();

      const jobs = db
        .prepare(
          `SELECT j.id, j.orderId, j.integrationId, j.sellerId, j.sellerCode,
                  j.status, j.attempts, j.nextRetryAt, j.externalOrderId,
                  j.externalStatus, j.trackingNumber, j.trackingUrl, j.lastError,
                  j.createdAt, j.updatedAt, j.syncedAt,
                  o.orderNumber, i.providerName
           FROM supplier_order_jobs j
           JOIN orders o ON o.id = j.orderId
           LEFT JOIN seller_api_integrations i ON i.id = j.integrationId
           ORDER BY j.id DESC LIMIT 100`
        )
        .all();

      const runs = db
        .prepare(
          `SELECT r.id, r.integrationId, r.status, r.fetched, r.created, r.updated,
                  r.failed, r.errorsJson, r.startedAt, r.finishedAt,
                  i.providerName
           FROM supplier_sync_runs r
           LEFT JOIN seller_api_integrations i ON i.id = r.integrationId
           ORDER BY r.id DESC LIMIT 50`
        )
        .all()
        .map((run) => ({
          ...run,
          errors: parseJson(run.errorsJson, []) || [],
          errorsJson: undefined,
        }));

      const alerts = [
        ...jobs
          .filter((job) => job.status === "failed")
          .map((job) => ({
            kind: "order_sync",
            id: job.id,
            providerName: job.providerName,
            orderNumber: job.orderNumber,
            message: job.lastError || "Supplier order sync failed.",
            at: job.updatedAt,
          })),
        ...runs
          .filter((run) => ["failed", "partial"].includes(run.status))
          .map((run) => ({
            kind: "product_sync",
            id: run.id,
            providerName: run.providerName,
            message: (run.errors || [])[0] || `Product sync ${run.status}.`,
            at: run.finishedAt || run.startedAt,
          })),
      ].slice(0, 40);

      res.json({
        success: true,
        integrations: rows.map(integrationWithSeller),
        sellers,
        jobs,
        runs,
        alerts,
        authTypes: ["none", "api_key", "bearer", "basic", "crmkey"],
        note:
          "Configured does not mean integrated. Credentials are encrypted server-side; the response only contains masked hints. Products stay Pending until an admin approves them.",
      });
    } catch (error) {
      console.error("SUPPLIER ADMIN LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load supplier integrations." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-integrations",
  ...adminGuard,
  (req, res) => {
    try {
      const sellerId = Number(req.body?.sellerId);
      if (!sellerId) {
        return res.status(400).json({ success: false, message: "Choose a seller / supplier." });
      }
      const existing = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`)
        .get(sellerId);
      if (existing) {
        return res.status(409).json({
          success: false,
          message: "This seller already has a supplier integration. Edit the existing one.",
          integrationId: existing.id,
        });
      }

      const result = saveIntegration(req.body || {}, null);
      if (result.error) {
        return res.status(400).json({ success: false, message: result.error });
      }

      res.status(201).json({
        success: true,
        message: "Supplier configuration saved. Test the connection before relying on it.",
        integration: integrationWithSeller(result.integration),
      });
    } catch (error) {
      console.error("SUPPLIER ADMIN CREATE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save supplier integration." });
    }
  }
);

supplierIntegrationsRouter.put(
  "/api/admin/supplier-integrations/:id",
  ...adminGuard,
  (req, res) => {
    try {
      const existing = readIntegration(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Supplier integration not found." });
      }

      const result = saveIntegration(req.body || {}, existing);
      if (result.error) {
        return res.status(400).json({ success: false, message: result.error });
      }

      res.json({
        success: true,
        message: "Supplier configuration saved. Test the connection to verify it.",
        integration: integrationWithSeller(result.integration),
      });
    } catch (error) {
      console.error("SUPPLIER ADMIN UPDATE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update supplier integration." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-integrations/:id/toggle",
  ...adminGuard,
  (req, res) => {
    try {
      const existing = readIntegration(req.params.id);
      if (!existing) {
        return res.status(404).json({ success: false, message: "Supplier integration not found." });
      }
      const enabled = bool(req.body?.enabled);
      if (enabled && Number(existing.orderSyncEnabled) && !clean(existing.orderPath)) {
        return res.status(400).json({
          success: false,
          message: "Add an Order API endpoint before enabling order sync.",
        });
      }

      db.prepare(
        `UPDATE seller_api_integrations SET enabled = ?, updatedAt = ? WHERE id = ?`
      ).run(enabled ? 1 : 0, now(), existing.id);

      res.json({
        success: true,
        message: enabled ? "Supplier integration enabled." : "Supplier integration disabled.",
        integration: integrationWithSeller(readIntegration(existing.id)),
      });
    } catch (error) {
      console.error("SUPPLIER ADMIN TOGGLE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to change supplier status." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-integrations/:id/test",
  ...adminGuard,
  async (req, res) => {
    try {
      const integration = readIntegration(req.params.id);
      if (!integration) {
        return res.status(404).json({ success: false, message: "Supplier integration not found." });
      }

      try {
        const items = await fetchSupplierItems(integration, 3, integration.productsPath);
        const mapping = readMapping(integration.mappingJson);
        const sample = items.map((item) => {
          const normalized = normalizeSupplierItem(item, mapping);
          return {
            sku: normalized.sku,
            name: normalized.name,
            price: normalized.price,
            stock: normalized.stock,
          };
        });

        db.prepare(
          `UPDATE seller_api_integrations
           SET connectionStatus = 'Connected', lastTestedAt = ?, lastTestError = NULL,
               lastSyncError = NULL, updatedAt = ?
           WHERE id = ?`
        ).run(now(), now(), integration.id);

        res.json({
          success: true,
          message: `Connection OK — ${items.length} product(s) read. Nothing was imported by this test.`,
          sample,
          integration: integrationWithSeller(readIntegration(integration.id)),
        });
      } catch (error) {
        const message = short(error.message || "Connection failed.", 500);
        db.prepare(
          `UPDATE seller_api_integrations
           SET connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?, updatedAt = ?
           WHERE id = ?`
        ).run(now(), message, now(), integration.id);

        res.status(502).json({
          success: false,
          message,
          integration: integrationWithSeller(readIntegration(integration.id)),
        });
      }
    } catch (error) {
      console.error("SUPPLIER ADMIN TEST ERROR:", error);
      res.status(500).json({ success: false, message: "Connection test failed." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-integrations/:id/sync",
  ...adminGuard,
  async (req, res) => {
    try {
      const integration = readIntegration(req.params.id);
      if (!integration) {
        return res.status(404).json({ success: false, message: "Supplier integration not found." });
      }
      if (integration.status !== "Approved") {
        return res.status(409).json({ success: false, message: "Supplier integration is not approved." });
      }
      if (!Number(integration.enabled)) {
        return res.status(409).json({ success: false, message: "Supplier integration is disabled." });
      }

      const result = await runSupplierSync(integration, "admin_manual");
      res.json({
        success: result.status !== "failed",
        message:
          result.status === "failed"
            ? `Sync failed: ${result.errors?.[0] || "unknown error"}`
            : `Sync complete — ${result.created} created, ${result.updated} updated, ${result.failed} failed. New products remain Pending until approved.`,
        result,
        integration: integrationWithSeller(readIntegration(integration.id)),
      });
    } catch (error) {
      console.error("SUPPLIER ADMIN SYNC ERROR:", error);
      res.status(500).json({ success: false, message: "Supplier product sync failed." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-integrations/process-jobs",
  ...adminGuard,
  async (req, res) => {
    try {
      const result = await processDueOrderJobs({
        integrationId: req.body?.integrationId || null,
        limit: Math.min(25, Math.max(1, Number(req.body?.limit) || 10)),
      });
      res.json({ success: true, ...result });
    } catch (error) {
      console.error("SUPPLIER ORDER WORKER ERROR:", error);
      res.status(500).json({ success: false, message: "Supplier order worker failed." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-order-jobs/:id/retry",
  ...adminGuard,
  (req, res) => {
    try {
      const job = db
        .prepare(`SELECT * FROM supplier_order_jobs WHERE id = ?`)
        .get(Number(req.params.id));
      if (!job) return res.status(404).json({ success: false, message: "Supplier order job not found." });
      if (job.status === "synced") {
        return res.status(409).json({ success: false, message: "This order is already synced." });
      }

      db.prepare(
        `UPDATE supplier_order_jobs
         SET status = 'pending', nextRetryAt = NULL, lastError = NULL, updatedAt = ?
         WHERE id = ?`
      ).run(now(), job.id);

      res.json({ success: true, message: "Supplier order queued for retry." });
    } catch (error) {
      console.error("SUPPLIER ORDER RETRY ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to queue supplier order retry." });
    }
  }
);

supplierIntegrationsRouter.post(
  "/api/admin/supplier-order-jobs/:id/status-sync",
  ...adminGuard,
  async (req, res) => {
    try {
      const result = await syncOrderStatus(req.params.id);
      res.json({ success: true, message: "Supplier order status refreshed.", result });
    } catch (error) {
      console.error("SUPPLIER ORDER STATUS ERROR:", error);
      res.status(502).json({ success: false, message: error.message || "Status sync failed." });
    }
  }
);

// =====================================================
// SUPPLIER WEBHOOK
// =====================================================

function constantTimeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  if (!a.length || a.length !== b.length) return false;
  return crypto.timingSafeEqual(a, b);
}

supplierIntegrationsRouter.post("/api/supplier-webhook/:id", (req, res) => {
  try {
    const integration = readIntegration(req.params.id);
    if (!integration) {
      return res.status(404).json({ success: false, message: "Supplier integration not found." });
    }
    if (!Number(integration.enabled)) {
      return res.status(409).json({ success: false, message: "Supplier integration is disabled." });
    }

    const secret = decryptSecret(integration.webhookSecretEnc);
    if (!secret) {
      return res.status(503).json({
        success: false,
        message: "Webhook verification secret is not configured.",
      });
    }

    const raw = Buffer.isBuffer(req.rawBody)
      ? req.rawBody
      : Buffer.from(JSON.stringify(req.body || {}));
    const signature = clean(req.get("x-jb-signature"));
    const suppliedSecret = clean(req.get("x-webhook-secret"));

    let verified = false;
    if (signature) {
      const expected = `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`;
      verified = constantTimeEqual(signature, expected);
    } else if (suppliedSecret) {
      verified = constantTimeEqual(suppliedSecret, secret);
    }

    if (!verified) {
      return res.status(401).json({ success: false, message: "Invalid webhook signature." });
    }

    const body = req.body || {};
    const orderNumber = clean(body.orderNumber || body.order_number || body.orderId);
    const externalOrderId = clean(body.externalOrderId || body.supplierOrderId || body.order_id);
    const status = short(body.status || body.orderStatus || body.event, 80);
    const eventType = short(body.event || body.eventType || "order_status", 80);
    const trackingNumber = short(
      body.trackingNumber || body.tracking_number || body.awb || body.awbNumber,
      120
    );
    const trackingUrl = short(body.trackingUrl || body.tracking_url, 1000);
    const eventKey = short(
      body.eventId ||
        body.event_id ||
        crypto.createHash("sha256").update(raw).digest("hex"),
      180
    );

    const duplicate = db
      .prepare(
        `SELECT id FROM supplier_webhook_events
         WHERE integrationId = ? AND eventKey = ?`
      )
      .get(integration.id, eventKey);
    if (duplicate) {
      return res.json({ success: true, duplicate: true, message: "Webhook already processed." });
    }

    const job = db
      .prepare(
        `SELECT j.* FROM supplier_order_jobs j
         JOIN orders o ON o.id = j.orderId
         WHERE j.integrationId = ?
           AND (
             (? <> '' AND o.orderNumber = ?)
             OR (? <> '' AND j.externalOrderId = ?)
           )
         ORDER BY j.id DESC LIMIT 1`
      )
      .get(integration.id, orderNumber, orderNumber, externalOrderId, externalOrderId);

    const info = db
      .prepare(
        `INSERT INTO supplier_webhook_events
           (integrationId, eventKey, eventType, orderNumber, externalOrderId, status, receivedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        integration.id,
        eventKey,
        eventType,
        orderNumber || null,
        externalOrderId || null,
        status || null,
        now()
      );

    if (!job) {
      db.prepare(
        `UPDATE supplier_webhook_events SET processedAt = ?, result = ? WHERE id = ?`
      ).run(now(), "order_not_found", info.lastInsertRowid);
      return res.json({ success: true, matched: false, message: "No matching supplier order." });
    }

    db.prepare(`
      UPDATE supplier_order_jobs SET
        externalOrderId = COALESCE(?, externalOrderId),
        externalStatus = COALESCE(?, externalStatus),
        trackingNumber = COALESCE(?, trackingNumber),
        trackingUrl = COALESCE(?, trackingUrl),
        lastError = NULL, updatedAt = ?
      WHERE id = ?
    `).run(
      externalOrderId || null,
      status || null,
      trackingNumber || null,
      trackingUrl || null,
      now(),
      job.id
    );

    db.prepare(
      `UPDATE supplier_webhook_events SET processedAt = ?, result = ? WHERE id = ?`
    ).run(now(), `job:${job.id}`, info.lastInsertRowid);

    res.json({ success: true, matched: true, jobId: job.id });
  } catch (error) {
    console.error("SUPPLIER WEBHOOK ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to process supplier webhook." });
  }
});

// =====================================================
// CENTRAL LAUNCH STATUS
// =====================================================

supplierIntegrationsRouter.get(
  "/api/admin/launch-status",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    try {
      const sellers = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN k.kycStatus = 'Approved' THEN 1 ELSE 0 END) AS kycApproved
           FROM sellers s
           LEFT JOIN seller_kyc k ON k.sellerId = s.id`
        )
        .get();
      const products = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END) AS approved
           FROM products`
        )
        .get();
      const orders = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN status IN ('Pending','Processing','Shipped','Delivered') THEN 1 ELSE 0 END) AS active
           FROM orders`
        )
        .get();
      const members = db.prepare(`SELECT COUNT(*) AS total FROM mlm_members`).get();
      const commissions = db
        .prepare(
          `SELECT source, status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount
           FROM mlm_commissions
           WHERE source IS NOT NULL
           GROUP BY source, status`
        )
        .all();
      const settings = db
        .prepare(
          `SELECT earningType, enabled, percentage, calculationBase, maxLevels,
                  chainLimit, effectiveFrom
           FROM mlm_3x3_settings ORDER BY earningType`
        )
        .all();
      const suppliers = db
        .prepare(
          `SELECT id, providerName, enabled, orderSyncEnabled, connectionStatus,
                  lastSyncStatus, lastOrderSyncError,
                  apiKeyEnc IS NOT NULL AS hasApiKey,
                  (orderPath IS NOT NULL AND TRIM(orderPath) <> '') AS hasOrderEndpoint
           FROM seller_api_integrations ORDER BY id`
        )
        .all();
      const couriers = db
        .prepare(
          `SELECT id, code, name, enabled FROM courier_partners ORDER BY id`
        )
        .all()
        .map((partner) => {
          const status = courierAdapterStatus(partner.code);
          return {
            ...partner,
            configured: Boolean(status.configured),
            mode: status.mode,
            liveEnabled: Boolean(status.liveEnabled),
            missingEnv: status.missingEnv || [],
          };
        });
      const shipments = db
        .prepare(
          `SELECT COUNT(*) AS total,
                  SUM(CASE WHEN mode = 'live' THEN 1 ELSE 0 END) AS live,
                  SUM(CASE WHEN courierStatus = 'Delivered' THEN 1 ELSE 0 END) AS delivered,
                  SUM(CASE WHEN lastApiError IS NOT NULL AND lastApiError <> '' THEN 1 ELSE 0 END) AS errors
           FROM courier_shipments`
        )
        .get();
      const failedJobs = db
        .prepare(
          `SELECT COUNT(*) AS count FROM supplier_order_jobs WHERE status = 'failed'`
        )
        .get();
      const failedRuns = db
        .prepare(
          `SELECT COUNT(*) AS count FROM supplier_sync_runs WHERE status IN ('failed','partial')`
        )
        .get();

      res.json({
        success: true,
        shopping: {
          sellers: Number(sellers?.total) || 0,
          kycApproved: Number(sellers?.kycApproved) || 0,
          products: Number(products?.total) || 0,
          approvedProducts: Number(products?.approved) || 0,
          orders: Number(orders?.total) || 0,
          activeOrders: Number(orders?.active) || 0,
        },
        family: {
          members: Number(members?.total) || 0,
          settings,
          commissions,
        },
        suppliers: {
          total: suppliers.length,
          enabled: suppliers.filter((row) => Number(row.enabled)).length,
          connected: suppliers.filter((row) => row.connectionStatus === "Connected").length,
          orderSyncEnabled: suppliers.filter((row) => Number(row.orderSyncEnabled)).length,
          failedOrderJobs: Number(failedJobs?.count) || 0,
          failedProductRuns: Number(failedRuns?.count) || 0,
          integrations: suppliers,
        },
        couriers: {
          total: couriers.length,
          enabled: couriers.filter((row) => Number(row.enabled)).length,
          configured: couriers.filter((row) => row.configured).length,
          live: couriers.filter((row) => row.mode === "live").length,
          shipments: Number(shipments?.total) || 0,
          liveShipments: Number(shipments?.live) || 0,
          delivered: Number(shipments?.delivered) || 0,
          apiErrors: Number(shipments?.errors) || 0,
          partners: couriers,
        },
        note:
          "This is a readiness report, not a claim that live integrations are connected. Real supplier/courier credentials and successful live calls are required.",
      });
    } catch (error) {
      console.error("LAUNCH STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to build launch status." });
    }
  }
);

// =====================================================
// INIT
// =====================================================

export function initSupplierIntegrations() {
  ensureSupplierOrderTables();

  orderTimer = setInterval(() => {
    processDueOrderJobs({ limit: 10 }).catch((error) => {
      console.error("SUPPLIER ORDER TIMER ERROR:", error.message);
    });
  }, 60 * 1000);
  if (orderTimer.unref) orderTimer.unref();

  // Status refresh is deliberately slower than order submission.
  statusTimer = setInterval(async () => {
    try {
      const jobs = db
        .prepare(
          `SELECT j.id FROM supplier_order_jobs j
           JOIN seller_api_integrations i ON i.id = j.integrationId
           WHERE j.status = 'synced'
             AND j.externalOrderId IS NOT NULL
             AND i.orderStatusPath IS NOT NULL
             AND TRIM(i.orderStatusPath) <> ''
             AND j.updatedAt <= ?
           ORDER BY j.updatedAt LIMIT 10`
        )
        .all(new Date(Date.now() - 15 * 60 * 1000).toISOString());

      for (const job of jobs) {
        try {
          await syncOrderStatus(job.id);
        } catch {
          // Individual status failures remain visible through the sync
          // run / admin logs and never affect checkout.
        }
      }
    } catch (error) {
      console.error("SUPPLIER STATUS TIMER ERROR:", error.message);
    }
  }, 15 * 60 * 1000);
  if (statusTimer.unref) statusTimer.unref();

  // Catch up once on startup without blocking server readiness.
  setTimeout(() => {
    processDueOrderJobs({ limit: 5 }).catch(() => {});
  }, 3000).unref?.();

  console.log("Supplier integrations, order sync and launch status ready.");
}

export default supplierIntegrationsRouter;
