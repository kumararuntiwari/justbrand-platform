// =====================================================
// JUSTBRAND — SELLER PRODUCT IMPORT & SUPPLIER AUTO SYNC
// =====================================================
// Additive module. Nothing here changes an existing table or
// endpoint: every product write reuses the SAME helpers as the
// seller "Add Product" flow (GST resolution, customer pricing,
// image validation, stock validation) and every imported/synced
// product is created with status = 'Pending' so the existing
// admin approval gate keeps deciding what buyers can see.
//
// Two features:
//   1. Bulk upload — CSV / XLSX → preview → validation → import.
//      Duplicate SKUs (inside the file or already owned by the
//      seller) are detected and reported as errors; they are never
//      silently created or overwritten.
//   2. Supplier API integration — seller saves an endpoint + auth
//      configuration (encrypted at rest), admin approves it, then
//      products / price / stock sync manually or on a schedule.
//
// Security rules enforced here:
//   • API keys / secrets are encrypted with AES-256-GCM before they
//     touch the database and are NEVER returned by any endpoint
//     (responses carry only a "…1234" hint and booleans).
//   • Every seller query is scoped by req.user.sellerId; a seller
//     can never read another seller's integration, import job,
//     sync run or product.
//   • Seller-supplied URLs are fetched server-side, so private /
//     loopback / link-local destinations and redirects are blocked.

import express from "express";
import crypto from "node:crypto";
import zlib from "node:zlib";

import db from "./db.js";
import { requireAuth, requireRole, requireType } from "./auth.js";
import {
  resolveProductImages,
  validateProductImages,
  validateStockInput,
  calculateCustomerPricing,
  resolveProductGst,
  withProductImages,
} from "./business.js";
import { stageGstImport } from "./gst.js";

export const sellerImportsRouter = express.Router();

const MAX_UPLOAD_BYTES = 15 * 1024 * 1024; // raw CSV/XLSX body ceiling
const MAX_STORED_ROW_ERRORS = 500;
const MAX_SYNC_ERRORS = 200;
const MAX_SUPPLIER_RESPONSE_BYTES = 8 * 1024 * 1024;
const SUPPLIER_FETCH_TIMEOUT_MS = 20000;

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

// =====================================================
// TABLES (ALL ADDITIVE / IF NOT EXISTS)
// =====================================================

function ensureImportTables() {
  // SKU lives on the product row. Additive: existing products keep
  // sku = NULL and behave exactly as before.
  const productColumns = db.prepare(`PRAGMA table_info(products)`).all();
  const productColumnNames = new Set(productColumns.map((column) => column.name));

  if (!productColumnNames.has("sku")) {
    db.prepare(`ALTER TABLE products ADD COLUMN sku TEXT`).run();
  }
  // Provenance only (manual / bulk_import / supplier_api) — never
  // shown to buyers and never used for authorization.
  if (!productColumnNames.has("source")) {
    db.prepare(`ALTER TABLE products ADD COLUMN source TEXT`).run();
  }
  if (!productColumnNames.has("sourceRef")) {
    db.prepare(`ALTER TABLE products ADD COLUMN sourceRef TEXT`).run();
  }

  // PROFIT MARGIN — supplier cost and JustBrand markup are stored
  // separately from `price` (the selling price). `price` always equals
  // supplierPrice + markupAmount, so a re-sync recomputes the markup
  // from the RAW supplier cost and never stacks markup on markup.
  const extraProductColumns = [
    ["supplierPrice", "REAL"],
    ["markupType", "TEXT"],
    ["markupValue", "REAL"],
    ["markupAmount", "REAL"],
    ["priceSource", "TEXT"],
    // STOCK CONFIDENCE — a supplier-linked product whose latest sync
    // failed is marked unverified and cannot be sold until the supplier
    // confirms stock again (old stock is never shown as available).
    ["stockVerifiedAt", "TEXT"],
    ["stockUnverified", "INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [name, definition] of extraProductColumns) {
    if (!productColumnNames.has(name)) {
      db.prepare(`ALTER TABLE products ADD COLUMN ${name} ${definition}`).run();
    }
  }

  // Backfill: supplier products imported before this feature keep their
  // current selling price as the supplier cost with 0 markup, so the
  // next sync does not retroactively raise prices. Guarded + additive.
  db.prepare(
    `UPDATE products
     SET supplierPrice = price, markupType = 'fixed', markupValue = 0,
         markupAmount = 0, priceSource = 'supplier'
     WHERE source = 'supplier_api' AND supplierPrice IS NULL`
  ).run();

  // SKU uniqueness is enforced per seller in code (case-insensitive),
  // so this index only speeds up duplicate lookups / sync matching.
  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_products_seller_sku
     ON products (sellerId, sku)`
  ).run();

  // One row per previewed / committed upload. `previewJson` holds the
  // normalized rows + validation result so the commit step NEVER
  // trusts client-supplied row data again.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS product_imports (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sellerId INTEGER NOT NULL,
      fileName TEXT,
      fileType TEXT NOT NULL DEFAULT 'csv',
      status TEXT NOT NULL DEFAULT 'Previewed',
      totalRows INTEGER NOT NULL DEFAULT 0,
      validRows INTEGER NOT NULL DEFAULT 0,
      errorRows INTEGER NOT NULL DEFAULT 0,
      duplicateRows INTEGER NOT NULL DEFAULT 0,
      importedRows INTEGER NOT NULL DEFAULT 0,
      previewJson TEXT,
      errorsJson TEXT,
      createdIdsJson TEXT,
      createdAt TEXT NOT NULL,
      committedAt TEXT
    )
  `).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_product_imports_seller
     ON product_imports (sellerId, id DESC)`
  ).run();

  // Supplier connector configuration. Secrets are stored as
  // AES-256-GCM blobs (v1:iv:tag:ciphertext), never as plaintext.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS seller_api_integrations (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      sellerId INTEGER UNIQUE NOT NULL,
      providerName TEXT,
      baseUrl TEXT NOT NULL,
      authType TEXT NOT NULL DEFAULT 'api_key',
      authHeaderName TEXT,
      apiKeyEnc TEXT,
      apiSecretEnc TEXT,
      apiKeyHint TEXT,
      extraHeadersEnc TEXT,
      productsPath TEXT NOT NULL DEFAULT '/products',
      productsKey TEXT,
      mappingJson TEXT,
      status TEXT NOT NULL DEFAULT 'Pending Approval',
      rejectionReason TEXT,
      syncFrequencyMinutes INTEGER NOT NULL DEFAULT 1440,
      autoSync INTEGER NOT NULL DEFAULT 0,
      connectionStatus TEXT NOT NULL DEFAULT 'Untested',
      lastTestedAt TEXT,
      lastTestError TEXT,
      lastSyncAt TEXT,
      lastSyncStatus TEXT,
      lastSyncError TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT
    )
  `).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS supplier_sync_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      integrationId INTEGER NOT NULL,
      sellerId INTEGER NOT NULL,
      trigger TEXT NOT NULL DEFAULT 'manual',
      status TEXT NOT NULL DEFAULT 'running',
      fetched INTEGER NOT NULL DEFAULT 0,
      created INTEGER NOT NULL DEFAULT 0,
      updated INTEGER NOT NULL DEFAULT 0,
      skipped INTEGER NOT NULL DEFAULT 0,
      failed INTEGER NOT NULL DEFAULT 0,
      errorsJson TEXT,
      startedAt TEXT NOT NULL,
      finishedAt TEXT
    )
  `).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_supplier_sync_runs_seller
     ON supplier_sync_runs (sellerId, id DESC)`
  ).run();

  db.prepare(`
    CREATE TABLE IF NOT EXISTS import_settings (
      key TEXT PRIMARY KEY,
      value TEXT,
      updatedAt TEXT
    )
  `).run();

  // New integration columns (additive).
  const integrationColumns = db
    .prepare(`PRAGMA table_info(seller_api_integrations)`)
    .all()
    .map((column) => column.name);

  const extraIntegrationColumns = [
    ["connector", "TEXT NOT NULL DEFAULT 'generic'"],
    ["nextSyncAt", "TEXT"],
    ["lastSuccessfulSyncAt", "TEXT"],
    ["syncRetryCount", "INTEGER NOT NULL DEFAULT 0"],
  ];

  for (const [name, definition] of extraIntegrationColumns) {
    if (!integrationColumns.includes(name)) {
      db.prepare(`ALTER TABLE seller_api_integrations ADD COLUMN ${name} ${definition}`).run();
    }
  }

  // PROFIT MARGIN RULES — one row per scope target. Precedence:
  // supplier link → category → seller → global. `scopeKey` gives the
  // upsert a stable unique key (SQLite treats NULLs as distinct, so a
  // UNIQUE(scopeType, scopeId) index would allow duplicate globals).
  db.prepare(`
    CREATE TABLE IF NOT EXISTS margin_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      scopeType TEXT NOT NULL,
      scopeId TEXT,
      scopeKey TEXT NOT NULL UNIQUE,
      scopeLabel TEXT,
      marginType TEXT NOT NULL DEFAULT 'percent',
      marginValue REAL NOT NULL DEFAULT 0,
      notes TEXT,
      updatedBy TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT
    )
  `).run();

  // Every margin create / update / delete keeps a full before/after
  // snapshot — the audit trail is append-only.
  db.prepare(`
    CREATE TABLE IF NOT EXISTS margin_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ruleId INTEGER,
      action TEXT NOT NULL,
      scopeType TEXT,
      scopeKey TEXT,
      beforeJson TEXT,
      afterJson TEXT,
      changedBy TEXT,
      reason TEXT,
      changedAt TEXT NOT NULL
    )
  `).run();

  db.prepare(
    `CREATE INDEX IF NOT EXISTS idx_margin_audit_rule
     ON margin_audit (ruleId, id DESC)`
  ).run();

  // Default global markup of 0% — nothing changes until an admin sets
  // a real margin (existing prices keep working untouched).
  const globalRule = db
    .prepare(`SELECT id FROM margin_rules WHERE scopeType = 'global' LIMIT 1`)
    .get();

  if (!globalRule) {
    db.prepare(
      `INSERT INTO margin_rules
         (scopeType, scopeId, scopeKey, scopeLabel, marginType, marginValue, notes, updatedBy, createdAt)
       VALUES ('global', NULL, 'global', 'All suppliers (global default)', 'percent', 0, 'Seeded default — set a real markup.', 'system', ?)`
    ).run(now());
  }
}

// =====================================================
// ADMIN-CONFIGURABLE LIMITS
// =====================================================
// maxRowsPerImport  → hard cap on one upload
// maxImportsPerDay  → committed imports allowed per seller per day
// maxSyncItems      → items handled by one supplier sync run
// minSyncFrequencyMinutes → fastest schedule a seller may pick
// autoSyncEnabled   → global kill-switch for the scheduler
// schedule*         → when the automatic stock/price sync runs
// syncRetry*        → failed-sync retry policy

// Listeners notified when the shared schedule/limits change (used by
// the marketplace connectors so their nextSyncAt follows the admin's
// schedule too).
const scheduleChangeListeners = new Set();

export function onScheduleChanged(listener) {
  if (typeof listener === "function") scheduleChangeListeners.add(listener);
}

const DEFAULT_IMPORT_SETTINGS = {
  maxRowsPerImport: 2000,
  maxImportsPerDay: 10,
  maxSyncItems: 500,
  minSyncFrequencyMinutes: 15,
  autoSyncEnabled: true,
  scheduleMode: "global", // global = admin schedule for every supplier
  scheduleTime: "00:00", // 12:00 AM
  scheduleTimezone: "Asia/Kolkata",
  scheduleFrequencyMinutes: 1440,
  syncRetryLimit: 2,
  syncRetryBackoffMinutes: 15,
};

const SETTINGS_BOOLEAN_KEYS = new Set(["autoSyncEnabled"]);
const SETTINGS_STRING_KEYS = new Set(["scheduleMode", "scheduleTime", "scheduleTimezone"]);
const SETTINGS_NUMERIC_KEYS = new Set([
  "maxRowsPerImport",
  "maxImportsPerDay",
  "maxSyncItems",
  "minSyncFrequencyMinutes",
  "scheduleFrequencyMinutes",
  "syncRetryLimit",
  "syncRetryBackoffMinutes",
]);

function getImportSettings() {
  const settings = { ...DEFAULT_IMPORT_SETTINGS };
  const rows = db.prepare(`SELECT key, value FROM import_settings`).all();

  for (const row of rows) {
    if (!Object.prototype.hasOwnProperty.call(settings, row.key)) continue;

    if (SETTINGS_BOOLEAN_KEYS.has(row.key)) {
      settings[row.key] = row.value === "1" || row.value === "true";
      continue;
    }

    if (SETTINGS_STRING_KEYS.has(row.key)) {
      if (clean(row.value)) settings[row.key] = clean(row.value);
      continue;
    }

    if (!SETTINGS_NUMERIC_KEYS.has(row.key)) continue;

    const parsed = Number(row.value);
    if (Number.isFinite(parsed) && parsed >= 0) settings[row.key] = Math.floor(parsed);
  }

  return settings;
}

function isValidScheduleTime(value) {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(clean(value));
}

const SUPPORTED_SCHEDULE_TIMEZONES = ["Asia/Kolkata", "UTC"];

function timezoneOffsetMs(timezone) {
  // Asia/Kolkata has no DST (+05:30). UTC is 0. Anything else is
  // rejected when saving, so a stored value is always one of these.
  return clean(timezone) === "UTC" ? 0 : 5.5 * 60 * 60 * 1000;
}

// Next run for a daily/N-daily schedule at a fixed local time.
// Interval schedules (frequencies that are not whole days) simply run
// `frequency` minutes after they are scheduled.
function computeNextSyncAt({
  frequencyMinutes,
  scheduleTime,
  scheduleTimezone,
  fromMs = Date.now(),
} = {}) {
  const minutes = Math.max(5, Math.floor(Number(frequencyMinutes) || 1440));
  const from = Number(fromMs) || Date.now();

  if (minutes % 1440 !== 0) {
    return new Date(from + minutes * 60 * 1000).toISOString();
  }

  const time = isValidScheduleTime(scheduleTime) ? clean(scheduleTime) : "00:00";
  const offset = timezoneOffsetMs(scheduleTimezone);
  const [hours, mins] = time.split(":").map(Number);

  // Midnight and later times can push the UTC day; build the target
  // from the local (offset) calendar day instead of the UTC one.
  const local = new Date(from + offset);
  let target =
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      hours,
      mins
    ) - offset;

  if (target <= from) target += 24 * 60 * 60 * 1000;
  target += (minutes / 1440 - 1) * 24 * 60 * 60 * 1000;

  return new Date(target).toISOString();
}

// The schedule that applies to an integration: the admin's global
// schedule (default) or the frequency the seller picked.
function effectiveScheduleFor(integration, settings = getImportSettings()) {
  const frequencyMinutes =
    settings.scheduleMode === "seller"
      ? Math.max(
          settings.minSyncFrequencyMinutes,
          Number(integration.syncFrequencyMinutes) || 1440
        )
      : Math.max(
          settings.minSyncFrequencyMinutes,
          Number(settings.scheduleFrequencyMinutes) || 1440
        );

  return {
    frequencyMinutes,
    scheduleTime: settings.scheduleTime,
    scheduleTimezone: settings.scheduleTimezone,
  };
}

function refreshNextSyncAt(integrationId = null) {
  const settings = getImportSettings();
  const rows = integrationId
    ? db.prepare(`SELECT * FROM seller_api_integrations WHERE id = ?`).all(integrationId)
    : db
        .prepare(
          `SELECT * FROM seller_api_integrations WHERE status = 'Approved' AND autoSync = 1`
        )
        .all();

  const write = db.prepare(`UPDATE seller_api_integrations SET nextSyncAt = ? WHERE id = ?`);

  for (const row of rows) {
    if (row.status !== "Approved" || !row.autoSync) {
      write.run(null, row.id);
      continue;
    }
    write.run(computeNextSyncAt(effectiveScheduleFor(row, settings)), row.id);
  }
}

function saveImportSettings(input) {
  const current = getImportSettings();
  const next = { ...current };
  let scheduleChanged = false;

  const numericFields = [
    ["maxRowsPerImport", 1, 20000],
    ["maxImportsPerDay", 1, 200],
    ["maxSyncItems", 1, 5000],
    ["minSyncFrequencyMinutes", 5, 10080],
    ["scheduleFrequencyMinutes", 5, 10080],
    ["syncRetryLimit", 0, 5],
    ["syncRetryBackoffMinutes", 5, 1440],
  ];

  for (const [field, min, max] of numericFields) {
    if (input[field] === undefined) continue;
    const parsed = Number(input[field]);
    if (!Number.isFinite(parsed) || parsed < min || parsed > max) {
      return { ok: false, message: `${field} must be between ${min} and ${max}.` };
    }
    next[field] = Math.floor(parsed);

    if (["scheduleFrequencyMinutes", "minSyncFrequencyMinutes"].includes(field)) {
      scheduleChanged = true;
    }
  }

  if (next.scheduleFrequencyMinutes < next.minSyncFrequencyMinutes) {
    return {
      ok: false,
      message: "scheduleFrequencyMinutes cannot be lower than minSyncFrequencyMinutes.",
    };
  }

  if (input.autoSyncEnabled !== undefined) {
    next.autoSyncEnabled = Boolean(input.autoSyncEnabled);
  }

  if (input.scheduleMode !== undefined) {
    const mode = clean(input.scheduleMode);
    if (!["global", "seller"].includes(mode)) {
      return { ok: false, message: "scheduleMode must be 'global' or 'seller'." };
    }
    next.scheduleMode = mode;
    scheduleChanged = true;
  }

  if (input.scheduleTime !== undefined) {
    const time = clean(input.scheduleTime);
    if (!isValidScheduleTime(time)) {
      return { ok: false, message: "scheduleTime must be a 24-hour time like 00:00 or 21:30." };
    }
    next.scheduleTime = time;
    scheduleChanged = true;
  }

  if (input.scheduleTimezone !== undefined) {
    const timezone = clean(input.scheduleTimezone);
    if (!SUPPORTED_SCHEDULE_TIMEZONES.includes(timezone)) {
      return {
        ok: false,
        message: `scheduleTimezone must be one of: ${SUPPORTED_SCHEDULE_TIMEZONES.join(", ")}.`,
      };
    }
    next.scheduleTimezone = timezone;
    scheduleChanged = true;
  }

  const write = db.prepare(`
    INSERT INTO import_settings (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `);

  const tx = db.transaction(() => {
    for (const [key, value] of Object.entries(next)) {
      const stored = SETTINGS_BOOLEAN_KEYS.has(key)
        ? value
          ? "1"
          : "0"
        : String(value);
      write.run(key, stored, now());
    }
  });
  tx();

  if (scheduleChanged) {
    refreshNextSyncAt();
    for (const listener of scheduleChangeListeners) {
      try {
        listener();
      } catch (error) {
        console.error("SCHEDULE CHANGE LISTENER ERROR:", error.message);
      }
    }
  }

  return { ok: true, settings: getImportSettings() };
}

// =====================================================
// PROFIT MARGIN RULES
// =====================================================
// supplierPrice (RAW cost) + JustBrand markup = selling price.
// The selling price is then passed through the SAME
// calculateCustomerPricing() used by every product, so GST, platform
// fee and delivery are added exactly once.
//
// Scope precedence (most specific wins):
//   supplier link → product category → seller → global default

const MARGIN_SCOPE_TYPES = ["global", "seller", "supplier", "marketplace", "category"];
const MARGIN_TYPES = ["percent", "fixed"];

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function scopeKey(scopeType, scopeId) {
  return scopeType === "global" ? "global" : `${scopeType}:${String(scopeId)}`;
}

function marginScopeLabel(scopeType, scopeId) {
  if (scopeType === "global") return "All suppliers (global default)";

  if (scopeType === "seller") {
    const seller = db.prepare(`SELECT name, shopName FROM sellers WHERE id = ?`).get(Number(scopeId));
    return seller ? `Seller: ${seller.shopName || seller.name}` : `Seller #${scopeId}`;
  }

  if (scopeType === "supplier") {
    const row = db
      .prepare(
        `SELECT i.providerName, s.name AS sellerName
         FROM seller_api_integrations i LEFT JOIN sellers s ON s.id = i.sellerId
         WHERE i.id = ?`
      )
      .get(Number(scopeId));
    return row
      ? `Supplier: ${row.providerName || `Integration #${scopeId}`}${row.sellerName ? ` (${row.sellerName})` : ""}`
      : `Supplier #${scopeId}`;
  }

  if (scopeType === "marketplace") {
    try {
      const row = db
        .prepare(
          `SELECT m.provider, m.accountLabel, s.name AS sellerName
           FROM marketplace_integrations m LEFT JOIN sellers s ON s.id = m.sellerId
           WHERE m.id = ?`
        )
        .get(Number(scopeId));
      if (row) {
        return `Marketplace: ${row.provider}${row.accountLabel ? ` — ${row.accountLabel}` : ""}${
          row.sellerName ? ` (${row.sellerName})` : ""
        }`;
      }
    } catch {
      // marketplace tables are created by the marketplaces module
    }
    return `Marketplace #${scopeId}`;
  }

  return `Category: ${scopeId}`;
}

function normalizeMarginRule(row) {
  if (!row) return null;
  return {
    id: row.id,
    scopeType: row.scopeType,
    scopeId: row.scopeId,
    scopeKey: row.scopeKey,
    scopeLabel: row.scopeLabel || marginScopeLabel(row.scopeType, row.scopeId),
    marginType: row.marginType,
    marginValue: Number(row.marginValue) || 0,
    notes: row.notes || "",
    updatedBy: row.updatedBy || "",
    createdAt: row.createdAt,
    updatedAt: row.updatedAt || null,
  };
}

function listMarginRules() {
  return db
    .prepare(
      `SELECT * FROM margin_rules
       ORDER BY CASE scopeType
         WHEN 'global' THEN 0 WHEN 'seller' THEN 1
         WHEN 'supplier' THEN 2 ELSE 3 END, id`
    )
    .all()
    .map(normalizeMarginRule);
}

function listMarginAudit(limit = 50) {
  return db
    .prepare(`SELECT * FROM margin_audit ORDER BY id DESC LIMIT ?`)
    .all(Math.min(200, Math.max(1, Number(limit) || 50)))
    .map((row) => {
      const parse = (value) => {
        try {
          return JSON.parse(value || "null");
        } catch {
          return null;
        }
      };
      return {
        id: row.id,
        ruleId: row.ruleId,
        action: row.action,
        scopeType: row.scopeType,
        scopeKey: row.scopeKey,
        before: parse(row.beforeJson),
        after: parse(row.afterJson),
        changedBy: row.changedBy || "",
        reason: row.reason || "",
        changedAt: row.changedAt,
      };
    });
}

function resolveMarginRule({ sellerId, integrationId, marketplaceId, category }) {
  const candidates = [
    ["marketplace", marketplaceId === undefined || marketplaceId === null ? null : String(marketplaceId)],
    ["supplier", integrationId === undefined || integrationId === null ? null : String(integrationId)],
    ["category", clean(category) ? clean(category).toLowerCase() : null],
    ["seller", sellerId === undefined || sellerId === null ? null : String(sellerId)],
    ["global", null],
  ];

  for (const [scopeType, scopeId] of candidates) {
    if (scopeType !== "global" && !scopeId) continue;
    const row = db
      .prepare(`SELECT * FROM margin_rules WHERE scopeKey = ?`)
      .get(scopeKey(scopeType, scopeId));
    if (row) return { rule: normalizeMarginRule(row), level: scopeType };
  }

  return { rule: null, level: "none" };
}

function computeMarkup(supplierPrice, rule) {
  const price = round2(Math.max(0, Number(supplierPrice) || 0));
  const marginType = rule?.marginType === "fixed" ? "fixed" : "percent";
  const marginValue = Math.max(0, Number(rule?.marginValue) || 0);

  const markupAmount =
    rule && marginValue > 0
      ? marginType === "fixed"
        ? round2(marginValue)
        : round2((price * marginValue) / 100)
      : 0;

  return {
    supplierPrice: price,
    markupType: rule ? marginType : null,
    markupValue: rule ? marginValue : 0,
    markupAmount,
    sellingPrice: round2(price + markupAmount),
    marginLevel: rule?.scopeType || "none",
    marginRuleId: rule?.id || null,
  };
}

// Full price chain for one product: supplier cost → markup →
// selling price → existing GST / platform / delivery / customer price.
function buildSupplierPricing({
  supplierPrice,
  sellerId = null,
  integrationId = null,
  marketplaceId = null,
  category = "",
  gstRate = null,
  hsnCode = "",
  ruleOverride = null,
}) {
  const resolution = ruleOverride
    ? { rule: ruleOverride, level: ruleOverride.scopeType || "preview" }
    : resolveMarginRule({ sellerId, integrationId, marketplaceId, category });

  const margin = computeMarkup(supplierPrice, resolution.rule);

  const gst =
    gstRate === null || gstRate === undefined
      ? resolveProductGst({ category, gstRate: 0, hsnCode, gstSource: null })
      : { gstRate: Number(gstRate) || 0, source: "product" };

  // GST / platform / delivery are applied ONCE, by the same calculator
  // every manual product uses (no second GST or delivery on top).
  const pricing = calculateCustomerPricing(margin.sellingPrice, gst.gstRate, gst.priceIncludesGst);

  return {
    ...margin,
    marginLevel: resolution.level,
    category: clean(category),
    gstRate: gst.gstRate,
    gstAmount: pricing.gstAmount,
    platformCharge: pricing.platformCharge,
    mlmCommission: pricing.mlmCommission,
    deliveryCharge: pricing.deliveryCharge,
    customerPrice: pricing.customerPrice,
    breakdown: [
      { key: "supplierPrice", label: "Supplier price", amount: margin.supplierPrice },
      {
        key: "markupAmount",
        label: resolution.rule
          ? `JustBrand markup (${margin.markupType === "percent" ? `${margin.markupValue}%` : `₹${margin.markupValue} fixed`})`
          : "JustBrand markup (no rule)",
        amount: margin.markupAmount,
      },
      { key: "sellingPrice", label: "Selling price (price)", amount: margin.sellingPrice },
      { key: "gstAmount", label: `GST ${gst.gstRate}%`, amount: pricing.gstAmount },
      { key: "platformCharge", label: "Platform fee", amount: pricing.platformCharge },
      {
        key: "deliveryCharge",
        label: "Delivery (product component, charged once at checkout)",
        amount: pricing.deliveryCharge,
      },
      { key: "mlmCommission", label: "Membership commission", amount: pricing.mlmCommission },
      { key: "customerPrice", label: "Final customer price", amount: pricing.customerPrice },
    ],
  };
}

function writeMarginAudit({ ruleId, action, rule, before, after, changedBy, reason }) {
  db.prepare(
    `INSERT INTO margin_audit
       (ruleId, action, scopeType, scopeKey, beforeJson, afterJson, changedBy, reason, changedAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    ruleId || null,
    action,
    rule?.scopeType || null,
    rule?.scopeKey || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    clean(changedBy).slice(0, 80) || "admin",
    clean(reason).slice(0, 300) || null,
    now()
  );
}

function saveMarginRule(input, actor = "admin") {
  const scopeType = clean(input.scopeType || "global").toLowerCase();
  if (!MARGIN_SCOPE_TYPES.includes(scopeType)) {
    return { ok: false, message: `scopeType must be one of: ${MARGIN_SCOPE_TYPES.join(", ")}.` };
  }

  const marginType = clean(input.marginType || "percent").toLowerCase();
  if (!MARGIN_TYPES.includes(marginType)) {
    return { ok: false, message: "marginType must be 'percent' or 'fixed'." };
  }

  const marginValue = Number(input.marginValue);
  const maxValue = marginType === "percent" ? 500 : 1000000;
  if (!Number.isFinite(marginValue) || marginValue < 0 || marginValue > maxValue) {
    return {
      ok: false,
      message:
        marginType === "percent"
          ? "Markup percentage must be between 0 and 500."
          : "Fixed markup must be between 0 and 10,00,000.",
    };
  }

  let scopeId = null;

  if (scopeType === "seller") {
    const sellerId = Number(input.scopeId);
    const seller = Number.isInteger(sellerId)
      ? db.prepare(`SELECT id FROM sellers WHERE id = ?`).get(sellerId)
      : null;
    if (!seller) return { ok: false, message: "Choose a valid seller for a seller margin." };
    scopeId = String(sellerId);
  } else if (scopeType === "supplier") {
    const integrationId = Number(input.scopeId);
    const integration = Number.isInteger(integrationId)
      ? db.prepare(`SELECT id FROM seller_api_integrations WHERE id = ?`).get(integrationId)
      : null;
    if (!integration) return { ok: false, message: "Choose a valid supplier integration." };
    scopeId = String(integrationId);
  } else if (scopeType === "marketplace") {
    const marketplaceId = Number(input.scopeId);
    let marketplace = null;
    if (Number.isInteger(marketplaceId)) {
      try {
        marketplace = db
          .prepare(`SELECT id FROM marketplace_integrations WHERE id = ?`)
          .get(marketplaceId);
      } catch {
        marketplace = null;
      }
    }
    if (!marketplace) {
      return { ok: false, message: "Choose a valid marketplace integration." };
    }
    scopeId = String(marketplaceId);
  } else if (scopeType === "category") {
    scopeId = clean(input.scopeId).toLowerCase().slice(0, 120);
    if (!scopeId) return { ok: false, message: "Category name is required for a category margin." };
  }

  const key = scopeKey(scopeType, scopeId);
  const existing = db.prepare(`SELECT * FROM margin_rules WHERE scopeKey = ?`).get(key);
  const at = now();
  const label = marginScopeLabel(scopeType, scopeId);
  const notes = clean(input.notes).slice(0, 300) || null;

  let ruleId;

  if (existing) {
    db.prepare(
      `UPDATE margin_rules
       SET marginType = ?, marginValue = ?, notes = ?, scopeLabel = ?,
           updatedBy = ?, updatedAt = ?
       WHERE id = ?`
    ).run(marginType, round2(marginValue), notes, label, clean(actor).slice(0, 80), at, existing.id);
    ruleId = existing.id;
  } else {
    const result = db
      .prepare(
        `INSERT INTO margin_rules
           (scopeType, scopeId, scopeKey, scopeLabel, marginType, marginValue, notes, updatedBy, createdAt, updatedAt)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(scopeType, scopeId, key, label, marginType, round2(marginValue), notes, clean(actor).slice(0, 80), at, at);
    ruleId = Number(result.lastInsertRowid);
  }

  const after = normalizeMarginRule(db.prepare(`SELECT * FROM margin_rules WHERE id = ?`).get(ruleId));
  const before = existing ? normalizeMarginRule(existing) : null;

  writeMarginAudit({
    ruleId,
    action: existing ? "updated" : "created",
    rule: after,
    before,
    after,
    changedBy: actor,
    reason: input.reason,
  });

  return { ok: true, rule: after, action: existing ? "updated" : "created" };
}

function deleteMarginRule(id, actor = "admin", reason = "") {
  const row = db.prepare(`SELECT * FROM margin_rules WHERE id = ?`).get(Number(id));
  if (!row) return { ok: false, message: "Margin rule not found." };

  if (row.scopeType === "global") {
    return {
      ok: false,
      message: "The global rule cannot be deleted — set it to 0% instead so prices stay predictable.",
    };
  }

  db.prepare(`DELETE FROM margin_rules WHERE id = ?`).run(row.id);

  writeMarginAudit({
    ruleId: row.id,
    action: "deleted",
    rule: row,
    before: normalizeMarginRule(row),
    after: null,
    changedBy: actor,
    reason,
  });

  return { ok: true };
}

function marginOptions() {
  const sellers = db
    .prepare(`SELECT id, name, shopName FROM sellers ORDER BY name`)
    .all()
    .map((row) => ({ id: row.id, label: row.shopName || row.name }));

  const suppliers = db
    .prepare(
      `SELECT i.id, i.providerName, i.connector, s.name AS sellerName
       FROM seller_api_integrations i LEFT JOIN sellers s ON s.id = i.sellerId
       ORDER BY i.id DESC`
    )
    .all()
    .map((row) => ({
      id: row.id,
      label: `${row.providerName || `Integration #${row.id}`}${row.sellerName ? ` — ${row.sellerName}` : ""}`,
      connector: row.connector || "generic",
    }));

  const categories = db
    .prepare(
      `SELECT DISTINCT TRIM(category) AS category FROM products
       WHERE category IS NOT NULL AND TRIM(category) <> ''
       ORDER BY category COLLATE NOCASE`
    )
    .all()
    .map((row) => row.category);

  let marketplaces = [];
  try {
    marketplaces = db
      .prepare(
        `SELECT m.id, m.provider, m.accountLabel, s.name AS sellerName
         FROM marketplace_integrations m LEFT JOIN sellers s ON s.id = m.sellerId
         WHERE m.status <> 'Disconnected'
         ORDER BY m.id DESC`
      )
      .all()
      .map((row) => ({
        id: row.id,
        label: `${row.provider}${row.accountLabel ? ` — ${row.accountLabel}` : ` #${row.id}`}${
          row.sellerName ? ` (${row.sellerName})` : ""
        }`,
        provider: row.provider,
      }));
  } catch {
    marketplaces = [];
  }

  return { sellers, suppliers, marketplaces, categories };
}

// =====================================================
// CREDENTIAL ENCRYPTION (AES-256-GCM)
// =====================================================
// Key source: JB_CREDENTIAL_KEY (recommended, set once on the
// server). Falls back to JWT_SECRET so an existing deployment keeps
// working without a new env var — rotating either key simply makes
// stored supplier credentials unreadable, never exposed.

function credentialKey() {
  const source =
    process.env.JB_CREDENTIAL_KEY ||
    process.env.JWT_SECRET ||
    "justbrand-local-credential-key";
  return crypto.createHash("sha256").update(String(source)).digest();
}

function encryptSecret(plain) {
  const text = String(plain ?? "");
  if (!text) return null;

  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", credentialKey(), iv);
  const encrypted = Buffer.concat([cipher.update(text, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();

  return `v1:${iv.toString("base64")}:${tag.toString("base64")}:${encrypted.toString("base64")}`;
}

function decryptSecret(blob) {
  if (!blob) return "";

  const parts = String(blob).split(":");
  if (parts.length !== 4 || parts[0] !== "v1") return "";

  try {
    const iv = Buffer.from(parts[1], "base64");
    const tag = Buffer.from(parts[2], "base64");
    const data = Buffer.from(parts[3], "base64");
    const decipher = crypto.createDecipheriv("aes-256-gcm", credentialKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(data), decipher.final()]).toString("utf8");
  } catch {
    // Wrong/rotated key or corrupt blob — treated as "no credential"
    // instead of throwing (never leaks why).
    return "";
  }
}

function secretHint(plain) {
  const text = String(plain ?? "");
  if (!text) return null;
  return text.length <= 4 ? "••••" : `••••${text.slice(-4)}`;
}

// =====================================================
// CSV PARSING (no dependency)
// =====================================================

function decodeText(buffer) {
  const bytes = Buffer.isBuffer(buffer) ? buffer : Buffer.from(buffer || "");
  // Strip UTF-8 BOM — Excel writes one for every CSV export.
  if (bytes.length >= 3 && bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf) {
    return bytes.subarray(3).toString("utf8");
  }
  return bytes.toString("utf8");
}

function detectDelimiter(text) {
  const headerLine = text.split(/\r?\n/, 1)[0] || "";
  const counts = [
    [",", (headerLine.match(/,/g) || []).length],
    [";", (headerLine.match(/;/g) || []).length],
    ["\t", (headerLine.match(/\t/g) || []).length],
  ].sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ",";
}

// RFC4180-style parser: quoted fields, escaped quotes, embedded
// newlines and CRLF are all handled.
function parseCsv(text) {
  const delimiter = detectDelimiter(text);
  const rows = [];
  let row = [];
  let field = "";
  let inQuotes = false;

  for (let i = 0; i < text.length; i++) {
    const char = text[i];

    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // ignore — handled by the \n branch
    } else {
      field += char;
    }
  }

  if (field.length > 0 || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  return rows;
}

// =====================================================
// XLSX PARSING (no dependency)
// =====================================================
// An .xlsx file is a ZIP of XML parts. We read the archive with
// Node's built-in zlib (stored + deflate entries), then pull the
// first worksheet's rows. This covers the files Excel / Google
// Sheets / LibreOffice produce, which is exactly what a seller
// uploads from the sample template.

function readZipEntries(buffer) {
  // End of central directory record (EOCD) — scan backwards because
  // it may be followed by a comment.
  const eocdSignature = 0x06054b50;
  let eocdOffset = -1;
  const scanFrom = Math.max(0, buffer.length - 65557);

  for (let i = buffer.length - 22; i >= scanFrom; i--) {
    if (buffer.readUInt32LE(i) === eocdSignature) {
      eocdOffset = i;
      break;
    }
  }

  if (eocdOffset < 0) throw new Error("Not a valid XLSX file (no ZIP directory).");

  const entryCount = buffer.readUInt16LE(eocdOffset + 10);
  const centralOffset = buffer.readUInt32LE(eocdOffset + 16);
  const entries = new Map();
  let pointer = centralOffset;

  for (let index = 0; index < entryCount; index++) {
    if (pointer + 46 > buffer.length || buffer.readUInt32LE(pointer) !== 0x02014b50) break;

    const compression = buffer.readUInt16LE(pointer + 10);
    const compressedSize = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const extraLength = buffer.readUInt16LE(pointer + 30);
    const commentLength = buffer.readUInt16LE(pointer + 32);
    const localOffset = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);

    if (
      localOffset + 30 <= buffer.length &&
      buffer.readUInt32LE(localOffset) === 0x04034b50 &&
      !name.endsWith("/")
    ) {
      const localNameLength = buffer.readUInt16LE(localOffset + 26);
      const localExtraLength = buffer.readUInt16LE(localOffset + 28);
      const dataStart = localOffset + 30 + localNameLength + localExtraLength;
      const dataEnd = dataStart + compressedSize;

      if (dataEnd <= buffer.length) {
        const raw = buffer.subarray(dataStart, dataEnd);
        try {
          entries.set(name, compression === 0 ? Buffer.from(raw) : zlib.inflateRawSync(raw));
        } catch {
          // Skip unreadable parts; a missing sheet is reported later.
        }
      }
    }

    pointer += 46 + nameLength + extraLength + commentLength;
  }

  return entries;
}

function decodeXmlEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function columnIndexFromRef(ref) {
  const letters = /^([A-Z]+)/i.exec(String(ref || ""))?.[1] || "A";
  let index = 0;
  for (const char of letters.toUpperCase()) {
    index = index * 26 + (char.charCodeAt(0) - 64);
  }
  return index - 1;
}

function parseSharedStrings(xml) {
  if (!xml) return [];

  const strings = [];
  const itemRegex = /<si\b[^>]*>([\s\S]*?)<\/si>/g;
  let match;

  while ((match = itemRegex.exec(xml))) {
    const parts = [];
    const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
    let textMatch;
    while ((textMatch = textRegex.exec(match[1]))) {
      parts.push(decodeXmlEntities(textMatch[1]));
    }
    strings.push(parts.join(""));
  }

  return strings;
}

function parseSheetRows(sheetXml, sharedStrings) {
  const rows = [];
  const rowRegex = /<row\b[^>]*>([\s\S]*?)<\/row>/g;
  let rowMatch;

  while ((rowMatch = rowRegex.exec(sheetXml))) {
    const cells = [];
    const cellRegex = /<c\b([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g;
    let cellMatch;

    while ((cellMatch = cellRegex.exec(rowMatch[1]))) {
      const attributes = cellMatch[1] || "";
      const body = cellMatch[2] || "";
      const ref = /r="([A-Z]+\d+)"/i.exec(attributes)?.[1];
      const type = /t="([^"]+)"/i.exec(attributes)?.[1] || "n";
      const column = ref ? columnIndexFromRef(ref) : cells.length;

      let value = "";

      if (type === "s") {
        const sharedIndex = Number(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1]);
        value = Number.isInteger(sharedIndex) ? sharedStrings[sharedIndex] ?? "" : "";
      } else if (type === "inlineStr") {
        const parts = [];
        const textRegex = /<t\b[^>]*>([\s\S]*?)<\/t>/g;
        let textMatch;
        while ((textMatch = textRegex.exec(body))) {
          parts.push(decodeXmlEntities(textMatch[1]));
        }
        value = parts.join("");
      } else if (type === "str") {
        value = decodeXmlEntities(/<v>([\s\S]*?)<\/v>/.exec(body)?.[1] || "");
      } else {
        const raw = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        value = raw === undefined ? "" : decodeXmlEntities(String(raw));
      }

      cells[column] = String(value ?? "").trim();
    }

    const normalized = [];
    for (let i = 0; i < cells.length; i++) normalized.push(cells[i] ?? "");
    rows.push(normalized);
  }

  return rows;
}

function parseXlsx(buffer) {
  const entries = readZipEntries(buffer);

  const sharedStrings = parseSharedStrings(
    entries.get("xl/sharedStrings.xml")?.toString("utf8")
  );

  let sheetName = "xl/worksheets/sheet1.xml";
  if (!entries.has(sheetName)) {
    sheetName = [...entries.keys()]
      .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))[0];
  }

  const sheetXml = entries.get(sheetName)?.toString("utf8");
  if (!sheetXml) throw new Error("No worksheet found in the XLSX file.");

  return parseSheetRows(sheetXml, sharedStrings);
}

// =====================================================
// SAMPLE TEMPLATE (CSV + XLSX, generated locally)
// =====================================================

const IMPORT_COLUMNS = [
  { key: "sku", label: "SKU", aliases: ["sku", "sellersku", "productcode", "stylecode"] },
  { key: "name", label: "Product Name", aliases: ["name", "productname", "title", "product"] },
  { key: "category", label: "Category", aliases: ["category", "categoryname", "subcategory"] },
  { key: "price", label: "Price", aliases: ["price", "sellingprice", "mrp", "sellerprice"] },
  { key: "comparePrice", label: "Compare Price (MRP)", aliases: ["compareprice", "compareprice_mrp", "mrpcompare", "listprice"] },
  { key: "stock", label: "Stock", aliases: ["stock", "quantity", "qty", "inventory"] },
  { key: "hsnCode", label: "HSN Code", aliases: ["hsncode", "hsn"] },
  { key: "gstRate", label: "GST Rate (%)", aliases: ["gstrate", "gst", "gstratepercent", "taxrate"] },
  { key: "shortDetails", label: "Short Details", aliases: ["shortdetails", "shortdescription", "features"] },
  { key: "description", label: "Description", aliases: ["description", "details", "longdescription"] },
  { key: "images", label: "Image URLs", aliases: ["images", "imageurls", "image", "imageurl", "photo", "photos"] },
];

const TEMPLATE_EXAMPLE = {
  sku: "JB-SAMPLE-001",
  name: "Sample Cotton Kurta",
  category: "Fashion",
  price: "899",
  comparePrice: "1499",
  stock: "25",
  hsnCode: "6205",
  gstRate: "5",
  shortDetails: "Soft cotton, regular fit",
  description: "Sample row — replace or delete before uploading.",
  images: "https://example.com/sample-front.jpg|https://example.com/sample-back.jpg",
};

function csvEscape(value) {
  const text = String(value ?? "");
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function buildCsvTemplate() {
  const header = IMPORT_COLUMNS.map((column) => csvEscape(column.label)).join(",");
  const example = IMPORT_COLUMNS.map((column) => csvEscape(TEMPLATE_EXAMPLE[column.key] || "")).join(",");
  const notes = [
    "",
    "# Rules: SKU is optional but must be unique for your shop. Product Name, Category and Price are required.",
    "# Image URLs: at least one; separate multiple with | (pipe). Max 6. HTTPS links or uploaded /uploads paths only.",
    "# Stock: whole number, 0 or more. Leave blank for unlimited. GST Rate: 0 / 0.1 / 0.25 / 1.5 / 3 / 5 / 12 / 18 / 28.",
    "# Every imported product goes to admin approval (Pending) first — nothing goes live automatically.",
  ].join("\r\n");

  // BOM keeps Excel from mangling ₹ / non-ASCII text.
  return `\uFEFF${header}\r\n${example}${notes}\r\n`;
}

// ---- minimal ZIP writer (stored entries) for the XLSX template ----
const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  if (typeof zlib.crc32 === "function") return zlib.crc32(buffer) >>> 0;

  let crc = -1;
  for (const byte of buffer) {
    crc = (crc >>> 8) ^ CRC_TABLE[(crc ^ byte) & 0xff];
  }
  return (crc ^ -1) >>> 0;
}

function zipStore(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const file of files) {
    const name = Buffer.from(file.name, "utf8");
    const data = Buffer.isBuffer(file.data) ? file.data : Buffer.from(file.data, "utf8");
    const crc = crc32(data);

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0x0800, 6); // UTF-8 names
    local.writeUInt16LE(0, 8); // stored
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(name.length, 26);
    local.writeUInt16LE(0, 28);

    localParts.push(local, name, data);

    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt16LE(20, 4);
    central.writeUInt16LE(20, 6);
    central.writeUInt16LE(0x0800, 8);
    central.writeUInt16LE(0, 10);
    central.writeUInt16LE(0, 12);
    central.writeUInt16LE(0, 14);
    central.writeUInt32LE(crc, 16);
    central.writeUInt32LE(data.length, 20);
    central.writeUInt32LE(data.length, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(0, 30);
    central.writeUInt16LE(0, 32);
    central.writeUInt16LE(0, 34);
    central.writeUInt16LE(0, 36);
    central.writeUInt32LE(0, 38);
    central.writeUInt32LE(offset, 42);

    centralParts.push(central, name);
    offset += local.length + name.length + data.length;
  }

  const centralBuffer = Buffer.concat(centralParts);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(files.length, 8);
  eocd.writeUInt16LE(files.length, 10);
  eocd.writeUInt32LE(centralBuffer.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...localParts, centralBuffer, eocd]);
}

function xmlEscape(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function buildXlsxTemplate() {
  const rows = [
    IMPORT_COLUMNS.map((column) => column.label),
    IMPORT_COLUMNS.map((column) => TEMPLATE_EXAMPLE[column.key] || ""),
  ];

  const sheetRows = rows
    .map((row, rowIndex) => {
      const cells = row
        .map((value, columnIndex) => {
          const ref = `${String.fromCharCode(65 + columnIndex)}${rowIndex + 1}`;
          return `<c r="${ref}" t="inlineStr"><is><t xml:space="preserve">${xmlEscape(value)}</t></is></c>`;
        })
        .join("");
      return `<row r="${rowIndex + 1}">${cells}</row>`;
    })
    .join("");

  const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetData>${sheetRows}</sheetData>
</worksheet>`;

  const files = [
    {
      name: "[Content_Types].xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
<Default Extension="xml" ContentType="application/xml"/>
<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`,
    },
    {
      name: "_rels/.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`,
    },
    {
      name: "xl/workbook.xml",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
<sheets><sheet name="Products" sheetId="1" r:id="rId1"/></sheets>
</workbook>`,
    },
    {
      name: "xl/_rels/workbook.xml.rels",
      data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`,
    },
    { name: "xl/worksheets/sheet1.xml", data: sheet },
  ];

  return zipStore(files);
}

// =====================================================
// ROW VALIDATION (same business rules as Add Product)
// =====================================================

function normalizeHeader(value) {
  return String(value ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function mapHeaders(headerRow) {
  const positions = new Map();

  headerRow.forEach((cell, index) => {
    const normalized = normalizeHeader(cell);
    if (!normalized) return;

    const column = IMPORT_COLUMNS.find(
      (candidate) =>
        candidate.aliases.includes(normalized) ||
        normalizeHeader(candidate.label) === normalized ||
        normalizeHeader(candidate.key) === normalized
    );

    if (column && !positions.has(column.key)) {
      positions.set(column.key, index);
    }
  });

  return positions;
}

function splitImages(value) {
  return String(value ?? "")
    .split(/[|\n]/)
    .flatMap((entry) => (entry.includes("http") ? entry.split(/,(?=\s*https?:)/i) : entry.split(",")))
    .map((entry) => entry.trim())
    .filter(Boolean);
}

function parsePriceNumber(value) {
  const text = String(value ?? "").replace(/[^0-9.]/g, "");
  if (!text) return 0;
  const parsed = Number(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

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

function validateImportRow(raw, rowNumber, seller, seenSkus) {
  const errors = [];
  const data = {
    sku: clean(raw.sku).slice(0, 64),
    name: clean(raw.name).slice(0, 200),
    category: clean(raw.category).slice(0, 120),
    price: clean(raw.price),
    comparePrice: clean(raw.comparePrice),
    stock: clean(raw.stock),
    hsnCode: clean(raw.hsnCode).slice(0, 20),
    gstRate: clean(raw.gstRate),
    shortDetails: clean(raw.shortDetails).slice(0, 500),
    description: clean(raw.description).slice(0, 5000),
    images: splitImages(raw.images),
  };

  if (!data.name) errors.push("Product name is required.");
  if (!data.category) errors.push("Category is required.");

  const priceValue = parsePriceNumber(data.price);
  if (priceValue <= 0) errors.push("A valid price (greater than 0) is required.");

  if (data.comparePrice) {
    const compareValue = parsePriceNumber(data.comparePrice);
    if (compareValue <= 0) errors.push("Compare price must be a valid number.");
    else if (compareValue < priceValue) errors.push("Compare price cannot be lower than the selling price.");
  }

  const stockInput = validateStockInput(data.stock);
  if (!stockInput.ok) errors.push(stockInput.message);

  if (data.gstRate) {
    const rate = Number(data.gstRate);
    if (!Number.isFinite(rate) || rate < 0) errors.push("GST rate must be a number (0 or more).");
  }

  // Image rule is identical to the seller Add Product form (1–6 valid
  // images) so a bulk import can never bypass it.
  if (data.images.length === 0) {
    errors.push("At least one product image URL is required.");
  } else {
    const imageError = validateProductImages(data.images);
    if (imageError) errors.push(imageError);
  }

  // Duplicate SKU — inside the same file and against this seller's
  // existing products. Reported, never auto-merged.
  let duplicate = false;
  if (data.sku) {
    const key = data.sku.toLowerCase();
    if (seenSkus.has(key)) {
      duplicate = true;
      errors.push(`Duplicate SKU in this file: ${data.sku}`);
    } else {
      seenSkus.add(key);
      if (findSellerProductBySku(seller, data.sku)) {
        duplicate = true;
        errors.push(`SKU already exists in your catalog: ${data.sku}`);
      }
    }
  }

  return {
    rowNumber,
    data,
    errors,
    duplicate,
    status: errors.length === 0 ? "valid" : "error",
  };
}

function readUploadRows(buffer, fileType) {
  const type = String(fileType || "").toLowerCase();

  if (type === "xlsx" || type === "xls") {
    if (type === "xls") {
      throw new Error("Legacy .xls files are not supported — please save as .xlsx or .csv.");
    }
    return parseXlsx(buffer);
  }

  const text = decodeText(buffer);
  if (!text.trim()) throw new Error("The uploaded file is empty.");
  return parseCsv(text);
}

function parseUpload(buffer, fileName, fileType) {
  const rows = readUploadRows(buffer, fileType);
  const headerIndex = rows.findIndex((row) => row.some((cell) => clean(cell)));

  if (headerIndex < 0) throw new Error("No header row found in the file.");

  const headerRow = rows[headerIndex];
  const positions = mapHeaders(headerRow);

  const missing = ["name", "category", "price"].filter((key) => !positions.has(key));
  if (missing.length > 0) {
    const labels = missing.map((key) => IMPORT_COLUMNS.find((c) => c.key === key).label);
    throw new Error(`Missing required column(s): ${labels.join(", ")}. Download the sample template and keep its headers.`);
  }

  const dataRows = [];
  for (let index = headerIndex + 1; index < rows.length; index++) {
    const row = rows[index];
    if (!row || row.every((cell) => !clean(cell))) continue;
    // Skip template comment lines that start with '#'.
    if (clean(row[0]).startsWith("#")) continue;

    const raw = {};
    for (const [key, position] of positions.entries()) {
      raw[key] = row[position] ?? "";
    }
    dataRows.push({ raw, rowNumber: index + 1 });
  }

  return { dataRows, fileName: clean(fileName) || "upload" };
}

// =====================================================
// BULK IMPORT ROUTES
// =====================================================

function getSellerForRequest(req) {
  return db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(req.user.sellerId);
}

function sellerKycApproved(seller) {
  const kyc = db.prepare(`SELECT kycStatus FROM seller_kyc WHERE sellerId = ?`).get(seller.id);
  return kyc && kyc.kycStatus === "Approved";
}

// Sample workbook — CSV (Excel-friendly) or XLSX.
sellerImportsRouter.get(
  "/api/sellers/imports/template",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const format = clean(req.query.format).toLowerCase();

    if (format === "xlsx") {
      const file = buildXlsxTemplate();
      res.setHeader("Content-Type", "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
      res.setHeader("Content-Disposition", 'attachment; filename="justbrand-product-import-template.xlsx"');
      return res.send(file);
    }

    const csv = buildCsvTemplate();
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", 'attachment; filename="justbrand-product-import-template.csv"');
    return res.send(csv);
  }
);

// Preview: parses + validates the file, stores the result server-side
// and returns a per-row report. No product is created here.
sellerImportsRouter.post(
  "/api/sellers/imports/preview",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });

      if (!sellerKycApproved(seller)) {
        return res.status(403).json({
          success: false,
          code: "KYC_REQUIRED",
          message: "Seller KYC approval is required before importing products.",
        });
      }

      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.alloc(0);
      if (buffer.length === 0) {
        return res.status(400).json({ success: false, message: "No file received." });
      }
      if (buffer.length > MAX_UPLOAD_BYTES) {
        return res.status(413).json({ success: false, message: "File is too large. Maximum upload size is 15 MB." });
      }

      const rawName = req.get("x-jb-file-name") || req.get("x-file-name") || "upload";
      let fileName = rawName;
      try {
        fileName = decodeURIComponent(rawName);
      } catch {
        // keep header value as-is
      }

      const fileType =
        clean(req.get("x-jb-file-type")).toLowerCase() ||
        (fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");

      const settings = getImportSettings();
      const { dataRows } = parseUpload(buffer, fileName, fileType);

      if (dataRows.length === 0) {
        return res.status(400).json({ success: false, message: "The file has a header but no product rows." });
      }

      if (dataRows.length > settings.maxRowsPerImport) {
        return res.status(400).json({
          success: false,
          message: `This file has ${dataRows.length} rows. The current limit is ${settings.maxRowsPerImport} rows per import. Split the file or ask the admin to raise the limit.`,
          limit: settings.maxRowsPerImport,
        });
      }

      const seenSkus = new Set();
      const rows = dataRows.map(({ raw, rowNumber }) =>
        validateImportRow(raw, rowNumber, seller, seenSkus)
      );

      const validRows = rows.filter((row) => row.status === "valid");
      const errorRows = rows.filter((row) => row.status === "error");
      const duplicateRows = rows.filter((row) => row.duplicate);

      const report = rows.map((row) => ({
        rowNumber: row.rowNumber,
        status: row.status,
        duplicate: row.duplicate,
        errors: row.errors,
        sku: row.data.sku,
        name: row.data.name,
        category: row.data.category,
        price: row.data.price,
        stock: row.data.stock,
        imageCount: row.data.images.length,
      }));

      const result = db
        .prepare(
          `INSERT INTO product_imports (
             sellerId, fileName, fileType, status, totalRows, validRows, errorRows,
             duplicateRows, previewJson, errorsJson, createdAt
           )
           VALUES (?, ?, ?, 'Previewed', ?, ?, ?, ?, ?, ?, ?)`
        )
        .run(
          seller.id,
          fileName,
          fileType,
          rows.length,
          validRows.length,
          errorRows.length,
          duplicateRows.length,
          JSON.stringify(rows),
          JSON.stringify(
            report
              .filter((row) => row.status === "error")
              .slice(0, MAX_STORED_ROW_ERRORS)
              .map((row) => ({ rowNumber: row.rowNumber, sku: row.sku, errors: row.errors }))
          ),
          now()
        );

      res.status(201).json({
        success: true,
        importId: Number(result.lastInsertRowid),
        fileName,
        fileType,
        totalRows: rows.length,
        validRows: validRows.length,
        errorRows: errorRows.length,
        duplicateRows: duplicateRows.length,
        limit: settings.maxRowsPerImport,
        rows: report,
      });
    } catch (error) {
      console.error("SELLER IMPORT PREVIEW ERROR:", error);
      res.status(400).json({ success: false, message: error.message || "Could not read the uploaded file." });
    }
  }
);

// History (own imports only).
sellerImportsRouter.get(
  "/api/sellers/imports",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const imports = db
        .prepare(
          `SELECT id, fileName, fileType, status, totalRows, validRows, errorRows,
                  duplicateRows, importedRows, createdAt, committedAt
           FROM product_imports
           WHERE sellerId = ?
           ORDER BY id DESC
           LIMIT 50`
        )
        .all(seller.id);

      res.json({ success: true, imports, settings: getImportSettings() });
    } catch (error) {
      console.error("SELLER IMPORT LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load import history." });
    }
  }
);

// Single job detail (row-level error report).
sellerImportsRouter.get(
  "/api/sellers/imports/:id",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const job = db
        .prepare(`SELECT * FROM product_imports WHERE id = ? AND sellerId = ?`)
        .get(Number(req.params.id), seller.id);

      if (!job) return res.status(404).json({ success: false, message: "Import not found." });

      let rows = [];
      try {
        rows = JSON.parse(job.previewJson || "[]");
      } catch {
        rows = [];
      }

      res.json({
        success: true,
        import: {
          id: job.id,
          fileName: job.fileName,
          fileType: job.fileType,
          status: job.status,
          totalRows: job.totalRows,
          validRows: job.validRows,
          errorRows: job.errorRows,
          duplicateRows: job.duplicateRows,
          importedRows: job.importedRows,
          createdAt: job.createdAt,
          committedAt: job.committedAt,
          rows: rows.map((row) => ({
            rowNumber: row.rowNumber,
            status: row.status,
            duplicate: row.duplicate,
            errors: row.errors,
            sku: row.data.sku,
            name: row.data.name,
            category: row.data.category,
            price: row.data.price,
            stock: row.data.stock,
            imageCount: row.data.images.length,
          })),
        },
      });
    } catch (error) {
      console.error("SELLER IMPORT DETAIL ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load the import." });
    }
  }
);

// Commit: creates products from the STORED preview (never from a
// client-supplied row list). All products enter 'Pending'.
sellerImportsRouter.post(
  "/api/sellers/imports/:id/commit",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });

      if (!sellerKycApproved(seller)) {
        return res.status(403).json({
          success: false,
          code: "KYC_REQUIRED",
          message: "Seller KYC approval is required before importing products.",
        });
      }

      const job = db
        .prepare(`SELECT * FROM product_imports WHERE id = ? AND sellerId = ?`)
        .get(Number(req.params.id), seller.id);

      if (!job) return res.status(404).json({ success: false, message: "Import not found." });
      if (job.status === "Imported") {
        return res.status(409).json({ success: false, message: "This import was already completed." });
      }
      if (job.status !== "Previewed") {
        return res.status(409).json({ success: false, message: "This import can no longer be committed." });
      }

      const settings = getImportSettings();
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);

      const importsToday = db
        .prepare(
          `SELECT COUNT(*) AS total FROM product_imports
           WHERE sellerId = ? AND status = 'Imported' AND committedAt >= ?`
        )
        .get(seller.id, todayStart.toISOString()).total;

      if (importsToday >= settings.maxImportsPerDay) {
        return res.status(429).json({
          success: false,
          message: `Daily import limit reached (${settings.maxImportsPerDay} imports per day). Try again tomorrow.`,
        });
      }

      let rows = [];
      try {
        rows = JSON.parse(job.previewJson || "[]");
      } catch {
        rows = [];
      }

      const validRows = rows.filter((row) => row && row.status === "valid" && row.data);
      if (validRows.length === 0) {
        return res.status(400).json({ success: false, message: "No valid rows to import." });
      }

      const insert = db.prepare(`
        INSERT INTO products (
          sellerId, sellerName, sku, name, category, price, comparePrice,
          image, images, description, shortDetails, status, createdAt,
          hsnCode, gstRate, gstSource, deliveryCharge, platformCharge, mlmCommission,
          customerPrice, pricingUpdatedAt, stock, source, sourceRef
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'bulk_import', ?)
      `);

      const createdIds = [];
      let skipped = 0;

      const commit = db.transaction(() => {
        for (const row of validRows) {
          const data = row.data;

          // Re-check the SKU at commit time: the catalog may have
          // changed between preview and commit.
          if (data.sku && findSellerProductBySku(seller, data.sku)) {
            skipped++;
            continue;
          }

          const explicitGstRate = Math.max(0, Number(data.gstRate) || 0);
          const gst = resolveProductGst({
            category: data.category,
            gstRate: explicitGstRate,
            hsnCode: data.hsnCode,
            gstSource: explicitGstRate > 0 ? "product" : null,
            gstApproved: 0,
          });
          const pricing = calculateCustomerPricing(data.price, gst.gstRate, gst.priceIncludesGst);

          const images = resolveProductImages(null, data.images);
          const stockInput = validateStockInput(data.stock);
          const stock = stockInput.ok && !stockInput.unset ? stockInput.stock : null;

          const result = insert.run(
            seller.sellerCode,
            seller.name,
            data.sku || null,
            data.name,
            data.category,
            data.price,
            data.comparePrice || null,
            images[0],
            JSON.stringify(images),
            data.description,
            data.shortDetails,
            now(),
            data.hsnCode,
            gst.gstRate,
            gst.source,
            pricing.deliveryCharge,
            pricing.platformCharge,
            pricing.mlmCommission,
            pricing.customerPrice,
            now(),
            stock,
            `import:${job.id}`
          );

          createdIds.push(Number(result.lastInsertRowid));
        }

        db.prepare(
          `UPDATE product_imports
           SET status = 'Imported', importedRows = ?, createdIdsJson = ?, committedAt = ?
           WHERE id = ? AND sellerId = ?`
        ).run(createdIds.length, JSON.stringify(createdIds), now(), job.id, seller.id);
      });

      commit();

      res.json({
        success: true,
        message: `${createdIds.length} product(s) imported and sent for admin approval.`,
        imported: createdIds.length,
        skipped,
        errors: job.errorRows,
        importId: job.id,
      });
    } catch (error) {
      console.error("SELLER IMPORT COMMIT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to import products." });
    }
  }
);

// =====================================================
// SUPPLIER API — URL SAFETY
// =====================================================

// Local/CI only: lets the automated test suite point the connector at
// a throwaway supplier server on 127.0.0.1. Never set this in a
// deployment — it disables the private-network guard below.
const ALLOW_PRIVATE_SUPPLIER_HOSTS =
  process.env.JB_ALLOW_PRIVATE_SUPPLIER_HOSTS === "1";

function isPrivateHost(hostname) {
  if (ALLOW_PRIVATE_SUPPLIER_HOSTS) return false;

  const host = String(hostname || "").toLowerCase().replace(/^\[|\]$/g, "");

  if (!host) return true;
  if (host === "localhost" || host.endsWith(".localhost")) return true;
  if (host.endsWith(".local") || host.endsWith(".internal")) return true;
  if (host === "::1" || host === "0:0:0:0:0:0:0:1") return true;

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (ipv4) {
    const [, a, b] = ipv4.map(Number);
    if (a === 0 || a === 10 || a === 127) return true;
    if (a === 169 && b === 254) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    if (a >= 224) return true;
    return false;
  }

  if (host.includes(":")) {
    if (host.startsWith("fc") || host.startsWith("fd")) return true;
    if (host.startsWith("fe80")) return true;
    return false;
  }

  return false;
}

function assertPublicUrl(rawUrl) {
  let parsed;
  try {
    parsed = new URL(String(rawUrl));
  } catch {
    throw new Error("API Base URL is not a valid URL.");
  }

  if (!/^https?:$/.test(parsed.protocol)) {
    throw new Error("API Base URL must start with http:// or https://.");
  }
  if (parsed.username || parsed.password) {
    throw new Error("Do not put credentials in the URL — use the API Key / Secret fields.");
  }
  if (isPrivateHost(parsed.hostname)) {
    throw new Error("Private, local or internal hosts are not allowed for supplier APIs.");
  }

  return parsed;
}

// =====================================================
// SUPPLIER CONNECTOR
// =====================================================

const AUTH_TYPES = new Set(["none", "api_key", "bearer", "basic", "crmkey"]);

// =====================================================
// CONNECTORS
// =====================================================
// `generic` is a configurable JSON connector. IndiaMART and Udaan get
// their OWN adapters (separate auth handling + capability notes), but
// neither is advertised as a working integration:
//   • IndiaMART publicly documents only its Lead Manager (leads) API,
//     authenticated with a crmkey. A catalog / price / stock pull is
//     not a public API and needs IndiaMART-issued partner access.
//   • Udaan publishes no public developer API; credentials and facility
//     codes are issued by the Udaan team for partner integrations.
// Both therefore stay `unverified_partner` until real credentials and a
// real endpoint are tested — the UI says exactly that.

const CONNECTORS = {
  generic: {
    key: "generic",
    label: "Generic JSON API",
    authTypes: ["none", "api_key", "bearer", "basic"],
    verification: "self_configured",
    docsUrl: "",
    notes:
      "Your own / supplier-provided JSON API. Configure the endpoint, auth and field mapping from its documentation.",
  },
  indiamart: {
    key: "indiamart",
    label: "IndiaMART",
    authTypes: ["crmkey"],
    forcedAuthType: "crmkey",
    verification: "unverified_partner",
    docsUrl: "https://seller.indiamart.com/lmsapi/",
    notes:
      "IndiaMART only publicly documents the Lead Manager (leads) API, authenticated with a crmkey CRM key. Catalog / price / stock pull needs IndiaMART-issued partner access. Until JustBrand tests it with official credentials this connector is UNVERIFIED — not a certified IndiaMART integration.",
  },
  udaan: {
    key: "udaan",
    label: "Udaan",
    authTypes: ["basic"],
    forcedAuthType: "basic",
    verification: "unverified_partner",
    docsUrl: "https://udaan.com/sellercentral",
    notes:
      "Udaan publishes no public developer API. Username/password and facility codes are issued by the Udaan team for partner integrations. Without that access this connector is UNVERIFIED and cannot read live Udaan price/stock.",
  },
};

function getConnector(name) {
  return CONNECTORS[clean(name)] || CONNECTORS.generic;
}

function publicConnector(name) {
  const connector = getConnector(name);
  return {
    key: connector.key,
    label: connector.label,
    authTypes: connector.authTypes,
    verification: connector.verification,
    docsUrl: connector.docsUrl,
    notes: connector.notes,
    certified: connector.verification === "self_configured",
  };
}

function allConnectors() {
  return Object.keys(CONNECTORS).map(publicConnector);
}

const DEFAULT_FIELD_MAPPING = {
  sku: "sku",
  name: "name",
  category: "category",
  price: "price",
  comparePrice: "comparePrice",
  stock: "stock",
  description: "description",
  images: "images",
  hsnCode: "hsnCode",
};

function readMapping(mappingJson) {
  let mapping = {};
  try {
    mapping = JSON.parse(mappingJson || "{}");
  } catch {
    mapping = {};
  }
  if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) mapping = {};

  const merged = { ...DEFAULT_FIELD_MAPPING };
  for (const key of Object.keys(DEFAULT_FIELD_MAPPING)) {
    if (typeof mapping[key] === "string" && mapping[key].trim()) {
      merged[key] = mapping[key].trim();
    }
  }
  return merged;
}

// Dot / index path lookup: "data.items.0.price" works.
function pickPath(source, path) {
  if (!path) return undefined;
  let current = source;

  for (const segment of String(path).split(".")) {
    if (current === null || current === undefined) return undefined;
    if (Array.isArray(current) && /^\d+$/.test(segment)) {
      current = current[Number(segment)];
    } else {
      current = current[segment];
    }
  }
  return current;
}

function publicIntegration(row) {
  if (!row) return null;

  return {
    id: row.id,
    providerName: row.providerName || "",
    baseUrl: row.baseUrl,
    authType: row.authType,
    authHeaderName: row.authHeaderName || "",
    hasApiKey: Boolean(row.apiKeyEnc),
    apiKeyHint: row.apiKeyHint || null,
    hasApiSecret: Boolean(row.apiSecretEnc),
    productsPath: row.productsPath,
    productsKey: row.productsKey || "",
    mapping: readMapping(row.mappingJson),
    status: row.status,
    rejectionReason: row.rejectionReason || null,
    connector: row.connector || "generic",
    connectorInfo: publicConnector(row.connector || "generic"),
    syncFrequencyMinutes: row.syncFrequencyMinutes,
    autoSync: Boolean(row.autoSync),
    connectionStatus: row.connectionStatus,
    lastTestedAt: row.lastTestedAt || null,
    lastTestError: row.lastTestError || null,
    lastSyncAt: row.lastSyncAt || null,
    lastSuccessfulSyncAt: row.lastSuccessfulSyncAt || null,
    lastSyncStatus: row.lastSyncStatus || null,
    lastSyncError: row.lastSyncError || null,
    nextSyncAt: row.nextSyncAt || null,
    syncRetryCount: Number(row.syncRetryCount) || 0,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

function integrationHeaders(integration) {
  const headers = { Accept: "application/json" };
  const apiKey = decryptSecret(integration.apiKeyEnc);
  const secret = decryptSecret(integration.apiSecretEnc);

  if (integration.authType === "api_key" && apiKey) {
    headers[integration.authHeaderName || "X-API-Key"] = apiKey;
  } else if (integration.authType === "crmkey") {
    // IndiaMART documents its CRM key as a `crmkey` query parameter —
    // appended in supplierUrl(), never in a header.
  } else if (integration.authType === "bearer" && apiKey) {
    headers.Authorization = `Bearer ${apiKey}`;
  } else if (integration.authType === "basic") {
    headers.Authorization = `Basic ${Buffer.from(`${apiKey}:${secret}`).toString("base64")}`;
  }

  // Provider-specific extra headers (e.g. a tenant id) — stored
  // encrypted with the credentials.
  const extraRaw = decryptSecret(integration.extraHeadersEnc);
  if (extraRaw) {
    try {
      const extra = JSON.parse(extraRaw);
      if (extra && typeof extra === "object" && !Array.isArray(extra)) {
        for (const [key, value] of Object.entries(extra)) {
          // Never let configuration override the auth header it
          // was configured with, and skip header injection attempts.
          if (!/^[A-Za-z0-9-]+$/.test(key)) continue;
          if (key.toLowerCase() === "authorization") continue;
          headers[key] = String(value ?? "");
        }
      }
    } catch {
      // ignore malformed extra headers
    }
  }

  return headers;
}

function supplierUrl(integration) {
  const base = assertPublicUrl(integration.baseUrl);
  const path = clean(integration.productsPath) || "/products";

  const build = (rawUrl) => {
    const url = new URL(rawUrl);

    if (integration.authType === "crmkey") {
      const key = decryptSecret(integration.apiKeyEnc);
      if (!key) throw new Error("The IndiaMART CRM key is missing. Save the key again.");
      url.searchParams.set("crmkey", key);
    }

    return assertPublicUrl(url.toString());
  };

  if (/^https?:\/\//i.test(path)) return build(path);

  const url = new URL(base.toString());
  const joined = `${url.pathname.replace(/\/$/, "")}/${path.replace(/^\//, "")}`;
  url.pathname = joined.replace(/\/{2,}/g, "/");
  return build(url.toString());
}

async function fetchSupplierItems(integration, maxItems) {
  const url = supplierUrl(integration);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SUPPLIER_FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      method: "GET",
      headers: integrationHeaders(integration),
      redirect: "error", // a redirect could point at a private host
      signal: controller.signal,
    });

    if (!response.ok) {
      throw new Error(`Supplier API returned HTTP ${response.status}`);
    }

    const text = await response.text();
    if (text.length > MAX_SUPPLIER_RESPONSE_BYTES) {
      throw new Error("Supplier API response is too large (over 8 MB).");
    }

    let payload;
    try {
      payload = JSON.parse(text);
    } catch {
      throw new Error("Supplier API did not return valid JSON.");
    }

    const list = integration.productsKey
      ? pickPath(payload, integration.productsKey)
      : Array.isArray(payload)
      ? payload
      : payload?.products || payload?.items || payload?.data;

    if (!Array.isArray(list)) {
      throw new Error(
        "Could not find the product list in the response. Set the 'Products key' field (e.g. data.products)."
      );
    }

    return list.slice(0, maxItems);
  } catch (error) {
    if (error.name === "AbortError") {
      throw new Error("Supplier API timed out after 20 seconds.");
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

function normalizeSupplierItem(item, mapping) {
  const rawImages = pickPath(item, mapping.images);
  const images = Array.isArray(rawImages)
    ? rawImages.map((entry) => clean(entry)).filter(Boolean)
    : splitImages(rawImages);

  const rawStock = pickPath(item, mapping.stock);

  return {
    sku: clean(pickPath(item, mapping.sku)).slice(0, 64),
    name: clean(pickPath(item, mapping.name)).slice(0, 200),
    category: clean(pickPath(item, mapping.category)).slice(0, 120),
    price: clean(pickPath(item, mapping.price)),
    comparePrice: clean(pickPath(item, mapping.comparePrice)),
    stock: rawStock === null || rawStock === undefined ? "" : clean(rawStock),
    description: clean(pickPath(item, mapping.description)).slice(0, 5000),
    hsnCode: clean(pickPath(item, mapping.hsnCode)).slice(0, 20),
    images: images.slice(0, 6),
  };
}

// Applies one supplier item: updates price/stock on a matching SKU
// (approval status untouched), otherwise creates a Pending product.
// `options.allowCreate = false` is used by the checkout stock guard,
// which must never create products while a buyer is checking out.
function applySupplierItem(seller, item, mapping, integrationId, insert, options = {}) {
  const allowCreate = options.allowCreate !== false;
  const data = normalizeSupplierItem(item, mapping);

  if (!data.sku) return { status: "failed", error: "Item has no SKU." };

  const priceValue = parsePriceNumber(data.price);
  if (priceValue <= 0) return { status: "failed", error: `SKU ${data.sku}: invalid price.` };

  const existing = findSellerProductBySku(seller, data.sku);

  const stockInput = validateStockInput(data.stock);

  if (existing) {
    if (!stockInput.ok) {
      return { status: "failed", error: `SKU ${data.sku}: ${stockInput.message}` };
    }

    const gst = resolveProductGst({
      category: existing.category || data.category,
      subCategory: existing.subCategory,
      gstRate: existing.gstSource === "product" ? existing.gstRate : 0,
      hsnCode: existing.hsnCode || data.hsnCode,
      gstSource: existing.gstSource === "product" ? "product" : null,
      gstType: existing.gstType,
      gstApproved: existing.gstApproved,
    });

    // MARKUP IS ALWAYS RECOMPUTED FROM THE RAW SUPPLIER PRICE — never
    // from the stored selling price, so a re-sync cannot compound it.
    const margin = computeMarkup(
      priceValue,
      resolveMarginRule({
        sellerId: seller.id,
        integrationId,
        category: existing.category || data.category,
      }).rule
    );
    const pricing = calculateCustomerPricing(margin.sellingPrice, gst.gstRate, gst.priceIncludesGst);

    // A supplier that does not expose stock must not silently switch
    // an existing tracked product to "unlimited" — keep the stored
    // value unless a real number arrived.
    const stockProvided = data.stock !== "" && stockInput.ok && !stockInput.unset;
    const stock = stockProvided ? stockInput.stock : existing.stock ?? null;
    const stockUnverified = stockProvided ? 0 : Number(existing.stockUnverified) || 0;
    const stockVerifiedAt = stockProvided ? now() : existing.stockVerifiedAt || null;

    // Only commercial fields change. Name / description / images /
    // category stay seller-managed and the approval status is kept —
    // a background sync must never silently unpublish a live product.
    db.prepare(
      `UPDATE products
       SET price = ?, comparePrice = ?, deliveryCharge = ?, platformCharge = ?,
           mlmCommission = ?, customerPrice = ?, pricingUpdatedAt = ?, stock = ?,
           supplierPrice = ?, markupType = ?, markupValue = ?, markupAmount = ?,
           priceSource = 'supplier', stockVerifiedAt = ?, stockUnverified = ?
       WHERE id = ?`
    ).run(
      String(margin.sellingPrice),
      data.comparePrice || existing.comparePrice || null,
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
      stockVerifiedAt,
      stockUnverified,
      existing.id
    );

    return {
      status: "updated",
      price: pricing.customerPrice,
      sellingPrice: margin.sellingPrice,
      markupAmount: margin.markupAmount,
    };
  }

  if (!allowCreate) {
    return { status: "skipped", error: `SKU ${data.sku}: not found in this seller's catalog.` };
  }

  // New products follow the same marketplace rules as the manual form.
  if (!data.name) return { status: "failed", error: `SKU ${data.sku}: product name is missing.` };
  if (!data.category) return { status: "failed", error: `SKU ${data.sku}: category is missing.` };

  const imageError = validateProductImages(data.images);
  if (imageError) return { status: "failed", error: `SKU ${data.sku}: ${imageError}` };

  const gst = resolveProductGst({
    category: data.category,
    gstRate: 0,
    hsnCode: data.hsnCode,
    gstSource: null,
  });

  const margin = computeMarkup(
    priceValue,
    resolveMarginRule({ sellerId: seller.id, integrationId, category: data.category }).rule
  );
  const pricing = calculateCustomerPricing(margin.sellingPrice, gst.gstRate, gst.priceIncludesGst);
  const stockInputOk = stockInput.ok && !stockInput.unset;
  const stock = stockInputOk ? stockInput.stock : null;

  const result = insert.run(
    seller.sellerCode,
    seller.name,
    data.sku,
    data.name,
    data.category,
    String(margin.sellingPrice),
    data.comparePrice || null,
    data.images[0],
    JSON.stringify(data.images),
    data.description,
    "",
    now(),
    data.hsnCode,
    gst.gstRate,
    gst.source,
    pricing.deliveryCharge,
    pricing.platformCharge,
    pricing.mlmCommission,
    pricing.customerPrice,
    now(),
    stock,
    `integration:${integrationId}`,
    margin.supplierPrice,
    margin.markupType,
    margin.markupValue,
    margin.markupAmount,
    stockInputOk ? now() : null,
    0
  );

  return {
    status: "created",
    productId: Number(result.lastInsertRowid),
    sellingPrice: margin.sellingPrice,
    markupAmount: margin.markupAmount,
  };
}

async function runSupplierSync(integration, trigger) {
  const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(integration.sellerId);
  if (!seller) throw new Error("Seller not found for this integration.");

  const settings = getImportSettings();
  const mapping = readMapping(integration.mappingJson);

  const runResult = db
    .prepare(
      `INSERT INTO supplier_sync_runs (integrationId, sellerId, trigger, status, startedAt)
       VALUES (?, ?, ?, 'running', ?)`
    )
    .run(integration.id, seller.id, trigger, now());

  const runId = Number(runResult.lastInsertRowid);
  const errors = [];
  let fetched = 0;
  let created = 0;
  let updated = 0;
  let skipped = 0;
  let failed = 0;

  try {
    const items = await fetchSupplierItems(integration, settings.maxSyncItems);
    fetched = items.length;

    const insert = db.prepare(`
      INSERT INTO products (
        sellerId, sellerName, sku, name, category, price, comparePrice,
        image, images, description, shortDetails, status, createdAt,
        hsnCode, gstRate, gstSource, deliveryCharge, platformCharge, mlmCommission,
        customerPrice, pricingUpdatedAt, stock, source, sourceRef,
        supplierPrice, markupType, markupValue, markupAmount, priceSource,
        stockVerifiedAt, stockUnverified
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'supplier_api', ?, ?, ?, ?, ?, 'supplier', ?, ?)
    `);

    const apply = db.transaction(() => {
      for (const item of items) {
        const result = applySupplierItem(seller, item, mapping, integration.id, insert);

        if (result.status === "created") created++;
        else if (result.status === "updated") updated++;
        else if (result.status === "failed") {
          failed++;
          if (errors.length < MAX_SYNC_ERRORS) errors.push(result.error);
        } else skipped++;
      }
    });

    apply();

    const status = failed > 0 && created + updated === 0 ? "failed" : failed > 0 ? "partial" : "success";

    db.prepare(
      `UPDATE supplier_sync_runs
       SET status = ?, fetched = ?, created = ?, updated = ?, skipped = ?, failed = ?,
           errorsJson = ?, finishedAt = ?
       WHERE id = ?`
    ).run(status, fetched, created, updated, skipped, failed, JSON.stringify(errors), now(), runId);

    db.prepare(
      `UPDATE seller_api_integrations
       SET lastSyncAt = ?, lastSyncStatus = ?, lastSyncError = ?, connectionStatus = 'Connected',
           lastTestedAt = ?, lastTestError = NULL, lastSuccessfulSyncAt = ?,
           syncRetryCount = 0, nextSyncAt = ?, updatedAt = ?
       WHERE id = ?`
    ).run(
      now(),
      status,
      errors.length > 0 ? errors.slice(0, 5).join(" | ") : null,
      now(),
      now(),
      computeNextSyncAt(effectiveScheduleFor(integration, settings)),
      now(),
      integration.id
    );

    // Fresh data supersedes any cached checkout refresh.
    checkoutRefreshCache.delete(integration.id);

    return { runId, status, fetched, created, updated, skipped, failed, errors, retryScheduled: false };
  } catch (error) {
    const message = error.message || "Supplier sync failed.";

    db.prepare(
      `UPDATE supplier_sync_runs
       SET status = 'failed', fetched = ?, errorsJson = ?, finishedAt = ?
       WHERE id = ?`
    ).run(fetched, JSON.stringify([message]), now(), runId);

    // STOCK CONFIDENCE: the supplier did not confirm this catalog, so
    // its existing stock is no longer shown as available. Products stay
    // approved (admin approval is not touched) and recover on the next
    // successful sync / checkout-time refresh.
    db.prepare(
      `UPDATE products SET stockUnverified = 1
       WHERE source = 'supplier_api' AND sourceRef = ?`
    ).run(`integration:${integration.id}`);

    const retryCount = (Number(integration.syncRetryCount) || 0) + 1;
    const retryScheduled = retryCount <= (Number(settings.syncRetryLimit) || 0);
    const nextSyncAt = retryScheduled
      ? new Date(Date.now() + (Number(settings.syncRetryBackoffMinutes) || 15) * 60 * 1000).toISOString()
      : computeNextSyncAt(effectiveScheduleFor(integration, settings));

    db.prepare(
      `UPDATE seller_api_integrations
       SET lastSyncAt = ?, lastSyncStatus = 'failed', lastSyncError = ?,
           connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?,
           syncRetryCount = ?, nextSyncAt = ?, updatedAt = ?
       WHERE id = ?`
    ).run(now(), message, now(), message, retryCount, nextSyncAt, now(), integration.id);

    checkoutRefreshCache.delete(integration.id);

    return {
      runId,
      status: "failed",
      fetched,
      created,
      updated,
      skipped,
      failed: failed || 1,
      errors: [message],
      retryScheduled,
      retryAt: retryScheduled ? nextSyncAt : null,
      stockUnverified: true,
    };
  }
}

// =====================================================
// SUPPLIER API ROUTES (SELLER)
// =====================================================

sellerImportsRouter.get(
  "/api/sellers/integration",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const row = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`)
        .get(seller.id);

      res.json({
        success: true,
        integration: publicIntegration(row),
        settings: getImportSettings(),
        connectors: allConnectors(),
      });
    } catch (error) {
      console.error("SELLER INTEGRATION GET ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load supplier API settings." });
    }
  }
);

sellerImportsRouter.put(
  "/api/sellers/integration",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const settings = getImportSettings();

      const baseUrl = clean(req.body.baseUrl).slice(0, 300);
      const providerName = clean(req.body.providerName).slice(0, 80);

      const connectorRow = db
        .prepare(`SELECT connector FROM seller_api_integrations WHERE sellerId = ?`)
        .get(seller.id);
      const connector = getConnector(
        clean(req.body.connector) || connectorRow?.connector || "generic"
      );
      // IndiaMART (crmkey) and Udaan (basic) each require THEIR OWN
      // documented auth mode — never the generic header/key choice.
      const authType =
        connector.forcedAuthType || clean(req.body.authType).toLowerCase() || "api_key";
      const authHeaderName = clean(req.body.authHeaderName).slice(0, 60) || "X-API-Key";
      const productsPath = clean(req.body.productsPath).slice(0, 300) || "/products";
      const productsKey = clean(req.body.productsKey).slice(0, 200);
      const apiKey = clean(req.body.apiKey);
      const apiSecret = clean(req.body.apiSecret);
      const extraHeaders = clean(req.body.extraHeaders);

      if (!baseUrl) {
        return res.status(400).json({ success: false, message: "API Base URL is required." });
      }
      try {
        assertPublicUrl(baseUrl);
      } catch (error) {
        return res.status(400).json({ success: false, message: error.message });
      }

      if (!AUTH_TYPES.has(authType) || !connector.authTypes.includes(authType)) {
        return res.status(400).json({
          success: false,
          message: `${connector.label} supports: ${connector.authTypes.join(", ")}.`,
        });
      }

      const frequency = Number(req.body.syncFrequencyMinutes ?? 1440);
      if (!Number.isInteger(frequency) || frequency < settings.minSyncFrequencyMinutes || frequency > 10080) {
        return res.status(400).json({
          success: false,
          message: `Sync frequency must be between ${settings.minSyncFrequencyMinutes} and 10080 minutes.`,
        });
      }

      let mapping = {};
      if (req.body.mapping !== undefined) {
        if (typeof req.body.mapping === "string") {
          try {
            mapping = req.body.mapping.trim() ? JSON.parse(req.body.mapping) : {};
          } catch {
            return res.status(400).json({ success: false, message: "Field mapping must be valid JSON." });
          }
        } else if (req.body.mapping && typeof req.body.mapping === "object") {
          mapping = req.body.mapping;
        }

        if (!mapping || typeof mapping !== "object" || Array.isArray(mapping)) {
          return res.status(400).json({ success: false, message: "Field mapping must be a JSON object." });
        }

        for (const [key, value] of Object.entries(mapping)) {
          if (!Object.prototype.hasOwnProperty.call(DEFAULT_FIELD_MAPPING, key)) {
            return res.status(400).json({
              success: false,
              message: `Unknown mapping field '${key}'. Allowed: ${Object.keys(DEFAULT_FIELD_MAPPING).join(", ")}.`,
            });
          }
          if (typeof value !== "string") {
            return res.status(400).json({
              success: false,
              message: `Mapping for '${key}' must be a text path (e.g. "price").`,
            });
          }
        }
      }

      if (extraHeaders) {
        try {
          const parsed = JSON.parse(extraHeaders);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) throw new Error();
        } catch {
          return res.status(400).json({
            success: false,
            message: "Extra headers must be a JSON object, e.g. {\"X-Tenant\":\"shop1\"}.",
          });
        }
      }

      const existing = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`)
        .get(seller.id);

      // Writing credentials always sends the integration back to
      // admin approval — a seller cannot swap credentials on an
      // already-approved connector without review.
      const credentialChanged = Boolean(apiKey) || Boolean(apiSecret) || Boolean(existing && existing.baseUrl !== baseUrl);

      const apiKeyEnc = apiKey ? encryptSecret(apiKey) : existing?.apiKeyEnc || null;
      const apiSecretEnc = apiSecret ? encryptSecret(apiSecret) : existing?.apiSecretEnc || null;
      const extraHeadersEnc = extraHeaders
        ? encryptSecret(extraHeaders)
        : existing?.extraHeadersEnc || null;
      const apiKeyHint = apiKey ? secretHint(apiKey) : existing?.apiKeyHint || null;

      if (existing) {
        db.prepare(
          `UPDATE seller_api_integrations
           SET providerName = ?, baseUrl = ?, connector = ?, authType = ?, authHeaderName = ?,
               apiKeyEnc = ?, apiSecretEnc = ?, apiKeyHint = ?, extraHeadersEnc = ?,
               productsPath = ?, productsKey = ?, mappingJson = ?,
               syncFrequencyMinutes = ?, autoSync = ?,
               status = ?, rejectionReason = NULL, updatedAt = ?
           WHERE sellerId = ?`
        ).run(
          providerName,
          baseUrl,
          connector.key,
          authType,
          authHeaderName,
          apiKeyEnc,
          apiSecretEnc,
          apiKeyHint,
          extraHeadersEnc,
          productsPath,
          productsKey,
          JSON.stringify(mapping),
          frequency,
          req.body.autoSync ? 1 : 0,
          credentialChanged ? "Pending Approval" : existing.status,
          now(),
          seller.id
        );
      } else {
        db.prepare(
          `INSERT INTO seller_api_integrations (
             sellerId, providerName, baseUrl, connector, authType, authHeaderName,
             apiKeyEnc, apiSecretEnc, apiKeyHint, extraHeadersEnc,
             productsPath, productsKey, mappingJson,
             status, syncFrequencyMinutes, autoSync, createdAt, updatedAt
           )
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending Approval', ?, ?, ?, ?)`
        ).run(
          seller.id,
          providerName,
          baseUrl,
          connector.key,
          authType,
          authHeaderName,
          apiKeyEnc,
          apiSecretEnc,
          apiKeyHint,
          extraHeadersEnc,
          productsPath,
          productsKey,
          JSON.stringify(mapping),
          frequency,
          req.body.autoSync ? 1 : 0,
          now(),
          now()
        );
      }

      const saved = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`)
        .get(seller.id);

      refreshNextSyncAt(saved.id);

      res.json({
        success: true,
        message:
          connector.key === "generic"
            ? "Supplier API configuration saved. Admin approval is required before syncing."
            : `${connector.label} connector saved as UNVERIFIED — it stays inactive for price/stock until official API access is tested. Admin approval is required.`,
        integration: publicIntegration(
          db.prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`).get(seller.id)
        ),
      });
    } catch (error) {
      console.error("SELLER INTEGRATION SAVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save supplier API settings." });
    }
  }
);

// Connection test — fetches a handful of items and reports names,
// never credentials.
sellerImportsRouter.post(
  "/api/sellers/integration/test",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const integration = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`)
        .get(seller.id);

      if (!integration) {
        return res.status(404).json({ success: false, message: "Save the supplier API configuration first." });
      }

      const mapping = readMapping(integration.mappingJson);

      try {
        const items = await fetchSupplierItems(integration, 3);
        const sample = items.map((item) => {
          const mapped = normalizeSupplierItem(item, mapping);
          return { sku: mapped.sku, name: mapped.name, price: mapped.price, stock: mapped.stock };
        });

        db.prepare(
          `UPDATE seller_api_integrations
           SET connectionStatus = 'Connected', lastTestedAt = ?, lastTestError = NULL, updatedAt = ?
           WHERE id = ?`
        ).run(now(), now(), integration.id);

        res.json({
          success: true,
          message: `Connection OK — ${items.length} item(s) read from the supplier API.`,
          sample,
        });
      } catch (error) {
        const message = error.message || "Connection failed.";

        db.prepare(
          `UPDATE seller_api_integrations
           SET connectionStatus = 'Error', lastTestedAt = ?, lastTestError = ?, updatedAt = ?
           WHERE id = ?`
        ).run(now(), message, now(), integration.id);

        res.status(502).json({ success: false, message });
      }
    } catch (error) {
      console.error("SELLER INTEGRATION TEST ERROR:", error);
      res.status(500).json({ success: false, message: "Connection test failed." });
    }
  }
);

sellerImportsRouter.post(
  "/api/sellers/integration/sync",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const integration = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE sellerId = ?`)
        .get(seller.id);

      if (!integration) {
        return res.status(404).json({ success: false, message: "No supplier API configured." });
      }
      if (integration.status !== "Approved") {
        return res.status(403).json({
          success: false,
          code: "INTEGRATION_NOT_APPROVED",
          message:
            integration.status === "Rejected"
              ? "This supplier API was rejected by the admin. Update the configuration and resubmit."
              : "Your supplier API is waiting for admin approval.",
          status: integration.status,
        });
      }

      const result = await runSupplierSync({ ...integration, autoSync: integration.autoSync }, "manual");

      res.json({
        success: result.status !== "failed",
        message:
          result.status === "failed"
            ? `Sync failed: ${result.errors[0] || "unknown error"}`
            : `Sync complete — ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
        result,
      });
    } catch (error) {
      console.error("SELLER INTEGRATION SYNC ERROR:", error);
      res.status(500).json({ success: false, message: "Sync failed." });
    }
  }
);

sellerImportsRouter.get(
  "/api/sellers/integration/runs",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = getSellerForRequest(req);
      const runs = db
        .prepare(
          `SELECT * FROM supplier_sync_runs
           WHERE sellerId = ?
           ORDER BY id DESC
           LIMIT 30`
        )
        .all(seller.id)
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
      console.error("SELLER SYNC RUN LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load sync history." });
    }
  }
);

// =====================================================
// ADMIN ROUTES
// =====================================================

const adminGuard = [requireAuth, requireRole("super_admin", "manager")];

sellerImportsRouter.get(
  "/api/admin/seller-integrations",
  ...adminGuard,
  (req, res) => {
    try {
      const rows = db
        .prepare(
          `SELECT i.*, s.name AS sellerName, s.shopName AS shopName, s.sellerCode AS sellerCode
           FROM seller_api_integrations i
           JOIN sellers s ON s.id = i.sellerId
           ORDER BY
             CASE i.status WHEN 'Pending Approval' THEN 0 ELSE 1 END,
             i.id DESC`
        )
        .all();

      res.json({
        success: true,
        integrations: rows.map((row) => ({
          ...publicIntegration(row),
          sellerId: row.sellerId,
          sellerName: row.sellerName,
          shopName: row.shopName,
          sellerCode: row.sellerCode,
        })),
      });
    } catch (error) {
      console.error("ADMIN INTEGRATION LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load seller integrations." });
    }
  }
);

sellerImportsRouter.post(
  "/api/admin/seller-integrations/:id/approve",
  ...adminGuard,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const result = db
        .prepare(
          `UPDATE seller_api_integrations
           SET status = 'Approved', rejectionReason = NULL, updatedAt = ?
           WHERE id = ?`
        )
        .run(now(), id);

      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: "Integration not found." });
      }

      refreshNextSyncAt(id);

      const row = db.prepare(`SELECT * FROM seller_api_integrations WHERE id = ?`).get(id);
      res.json({ success: true, message: "Supplier API integration approved.", integration: publicIntegration(row) });
    } catch (error) {
      console.error("ADMIN INTEGRATION APPROVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to approve integration." });
    }
  }
);

sellerImportsRouter.post(
  "/api/admin/seller-integrations/:id/reject",
  ...adminGuard,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const reason = clean(req.body.reason).slice(0, 500);

      const result = db
        .prepare(
          `UPDATE seller_api_integrations
           SET status = 'Rejected', rejectionReason = ?, autoSync = 0,
               nextSyncAt = NULL, updatedAt = ?
           WHERE id = ?`
        )
        .run(reason || "Rejected by admin.", now(), id);

      if (result.changes === 0) {
        return res.status(404).json({ success: false, message: "Integration not found." });
      }

      const row = db.prepare(`SELECT * FROM seller_api_integrations WHERE id = ?`).get(id);
      res.json({ success: true, message: "Supplier API integration rejected.", integration: publicIntegration(row) });
    } catch (error) {
      console.error("ADMIN INTEGRATION REJECT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to reject integration." });
    }
  }
);

sellerImportsRouter.get(
  "/api/admin/product-imports",
  ...adminGuard,
  (req, res) => {
    try {
      const imports = db
        .prepare(
          `SELECT j.id, j.sellerId, j.fileName, j.fileType, j.status, j.totalRows,
                  j.validRows, j.errorRows, j.duplicateRows, j.importedRows,
                  j.createdAt, j.committedAt,
                  s.name AS sellerName, s.shopName AS shopName, s.sellerCode AS sellerCode
           FROM product_imports j
           JOIN sellers s ON s.id = j.sellerId
           ORDER BY j.id DESC
           LIMIT 100`
        )
        .all();

      res.json({ success: true, imports, settings: getImportSettings() });
    } catch (error) {
      console.error("ADMIN IMPORTS LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load import history." });
    }
  }
);

sellerImportsRouter.get(
  "/api/admin/supplier-sync-runs",
  ...adminGuard,
  (req, res) => {
    try {
      const runs = db
        .prepare(
          `SELECT r.id, r.integrationId, r.sellerId, r.trigger, r.status, r.fetched,
                  r.created, r.updated, r.skipped, r.failed, r.errorsJson,
                  r.startedAt, r.finishedAt,
                  s.name AS sellerName, s.shopName AS shopName,
                  i.providerName, i.baseUrl
           FROM supplier_sync_runs r
           JOIN sellers s ON s.id = r.sellerId
           LEFT JOIN seller_api_integrations i ON i.id = r.integrationId
           ORDER BY r.id DESC
           LIMIT 100`
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
      console.error("ADMIN SYNC RUN LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load sync history." });
    }
  }
);

sellerImportsRouter.get(
  "/api/admin/import-settings",
  ...adminGuard,
  (req, res) => {
    res.json({ success: true, settings: getImportSettings() });
  }
);

sellerImportsRouter.put(
  "/api/admin/import-settings",
  ...adminGuard,
  (req, res) => {
    const result = saveImportSettings(req.body || {});
    if (!result.ok) {
      return res.status(400).json({ success: false, message: result.message });
    }
    res.json({ success: true, message: "Import & sync limits saved.", settings: result.settings });
  }
);

// =====================================================
// ADMIN — PROFIT MARGIN RULES
// =====================================================

sellerImportsRouter.get(
  "/api/admin/margins",
  ...adminGuard,
  (req, res) => {
    try {
      const rules = listMarginRules();

      res.json({
        success: true,
        rules,
        audit: listMarginAudit(Number(req.query.auditLimit) || 50),
        options: marginOptions(),
        exampleRule: rules.find((rule) => rule.scopeType === "global") || null,
      });
    } catch (error) {
      console.error("ADMIN MARGIN LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load profit margin rules." });
    }
  }
);

sellerImportsRouter.put(
  "/api/admin/margins",
  ...adminGuard,
  (req, res) => {
    try {
      const result = saveMarginRule(
        req.body || {},
        req.user?.name || req.user?.username || req.user?.role || "admin"
      );

      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }

      res.json({
        success: true,
        message:
          result.action === "created"
            ? "Profit margin rule created."
            : "Profit margin rule updated — the audit history keeps the previous value.",
        rule: result.rule,
        rules: listMarginRules(),
        audit: listMarginAudit(50),
      });
    } catch (error) {
      console.error("ADMIN MARGIN SAVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save the profit margin rule." });
    }
  }
);

sellerImportsRouter.delete(
  "/api/admin/margins/:id",
  ...adminGuard,
  (req, res) => {
    try {
      const result = deleteMarginRule(
        Number(req.params.id),
        req.user?.name || req.user?.username || req.user?.role || "admin",
        req.body?.reason
      );

      if (!result.ok) {
        return res.status(400).json({ success: false, message: result.message });
      }

      res.json({
        success: true,
        message: "Profit margin rule deleted.",
        rules: listMarginRules(),
        audit: listMarginAudit(50),
      });
    } catch (error) {
      console.error("ADMIN MARGIN DELETE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to delete the profit margin rule." });
    }
  }
);

// Preview the full chain BEFORE anything is saved:
// supplier price → markup → selling price → GST / delivery → customer price.
sellerImportsRouter.post(
  "/api/admin/margins/preview",
  ...adminGuard,
  (req, res) => {
    try {
      const supplierPrice = Number(req.body.supplierPrice);
      if (!Number.isFinite(supplierPrice) || supplierPrice < 0) {
        return res.status(400).json({ success: false, message: "Enter a valid supplier price." });
      }

      const integrationId = req.body.integrationId ? Number(req.body.integrationId) : null;
      if (integrationId) {
        const integration = db
          .prepare(`SELECT id FROM seller_api_integrations WHERE id = ?`)
          .get(integrationId);
        if (!integration) {
          return res.status(400).json({ success: false, message: "Supplier integration not found." });
        }
      }

      const sellerId = req.body.sellerId ? Number(req.body.sellerId) : null;
      if (sellerId) {
        const seller = db.prepare(`SELECT id FROM sellers WHERE id = ?`).get(sellerId);
        if (!seller) return res.status(400).json({ success: false, message: "Seller not found." });
      }

      const marginType = clean(req.body.marginType).toLowerCase();
      const hasOverride =
        MARGIN_TYPES.includes(marginType) && req.body.marginValue !== undefined;

      let ruleOverride = null;
      if (hasOverride) {
        const value = Number(req.body.marginValue);
        if (!Number.isFinite(value) || value < 0) {
          return res.status(400).json({ success: false, message: "Enter a valid markup value." });
        }
        ruleOverride = {
          id: null,
          scopeType: "preview",
          marginType,
          marginValue: value,
        };
      }

      const pricing = buildSupplierPricing({
        supplierPrice,
        sellerId,
        integrationId,
        category: clean(req.body.category),
        gstRate:
          req.body.gstRate === undefined || req.body.gstRate === ""
            ? null
            : Number(req.body.gstRate),
        ruleOverride,
      });

      res.json({ success: true, preview: pricing });
    } catch (error) {
      console.error("ADMIN MARGIN PREVIEW ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to build the price preview." });
    }
  }
);

// Recompute stored pricing for one integration's products after a
// margin change (base price = supplierPrice, so nothing compounds).
sellerImportsRouter.post(
  "/api/admin/seller-integrations/:id/reprice",
  ...adminGuard,
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const integration = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE id = ?`)
        .get(id);

      if (!integration) {
        return res.status(404).json({ success: false, message: "Integration not found." });
      }

      const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(integration.sellerId);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });

      const products = db
        .prepare(
          `SELECT * FROM products
           WHERE source = 'supplier_api' AND sourceRef = ? AND supplierPrice IS NOT NULL`
        )
        .all(`integration:${id}`);

      let repriced = 0;

      const tx = db.transaction(() => {
        for (const product of products) {
          const margin = computeMarkup(
            product.supplierPrice,
            resolveMarginRule({
              sellerId: seller.id,
              integrationId: id,
              category: product.category,
            }).rule
          );
          const gst = resolveProductGst(product);
          const pricing = calculateCustomerPricing(margin.sellingPrice, gst.gstRate, gst.priceIncludesGst);

          db.prepare(
            `UPDATE products
             SET price = ?, supplierPrice = ?, markupType = ?, markupValue = ?,
                 markupAmount = ?, priceSource = 'supplier', gstRate = ?, gstSource = ?,
                 deliveryCharge = ?, platformCharge = ?, mlmCommission = ?, customerPrice = ?,
                 pricingUpdatedAt = ?
             WHERE id = ?`
          ).run(
            String(margin.sellingPrice),
            margin.supplierPrice,
            margin.markupType,
            margin.markupValue,
            margin.markupAmount,
            gst.gstRate,
            gst.source,
            pricing.deliveryCharge,
            pricing.platformCharge,
            pricing.mlmCommission,
            pricing.customerPrice,
            now(),
            product.id
          );
          repriced++;
        }
      });
      tx();

      res.json({
        success: true,
        message: `Repriced ${repriced} product(s) from their supplier price — no markup was applied twice.`,
        repriced,
      });
    } catch (error) {
      console.error("ADMIN MARGIN REPRICE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to reprice supplier products." });
    }
  }
);

// Admin-triggered manual sync (also the "retry failed sync" button
// in the admin error report).
sellerImportsRouter.post(
  "/api/admin/seller-integrations/:id/sync",
  ...adminGuard,
  async (req, res) => {
    try {
      const id = Number(req.params.id);
      const integration = db
        .prepare(`SELECT * FROM seller_api_integrations WHERE id = ?`)
        .get(id);

      if (!integration) {
        return res.status(404).json({ success: false, message: "Integration not found." });
      }
      if (integration.status !== "Approved") {
        return res.status(403).json({
          success: false,
          message: "Approve this supplier integration before syncing it.",
        });
      }

      const result = await runSupplierSync(integration, "admin_manual");

      res.json({
        success: result.status !== "failed",
        message:
          result.status === "failed"
            ? `Sync failed: ${result.errors[0] || "unknown error"}`
            : `Sync complete — ${result.created} created, ${result.updated} updated, ${result.failed} failed.`,
        result,
      });
    } catch (error) {
      console.error("ADMIN MANUAL SYNC ERROR:", error);
      res.status(500).json({ success: false, message: "Sync failed." });
    }
  }
);

// =====================================================
// SCHEDULER (server-side, per configuration)
// =====================================================

let schedulerTimer = null;
let schedulerTickAt = 0;

// DEFAULT: every day at 00:00 Asia/Kolkata (admin can change the time,
// timezone, frequency and mode). Each run stores its nextSyncAt, and a
// failed run schedules a retry using the admin's retry policy.
async function runDueScheduledSyncs(options = {}) {
  const settings = getImportSettings();
  if (!settings.autoSyncEnabled && !options.force) return { ran: 0, skipped: "disabled" };

  const nowMs = Date.now();

  // Cheap throttle: the tick itself runs every minute, but a slow
  // supplier must not stack requests.
  if (!options.force && nowMs - schedulerTickAt < 55 * 1000) return { ran: 0, skipped: "throttled" };
  schedulerTickAt = nowMs;

  const candidates = db
    .prepare(
      `SELECT * FROM seller_api_integrations
       WHERE status = 'Approved' AND autoSync = 1`
    )
    .all();

  let ran = 0;

  for (const integration of candidates) {
    const due = integration.nextSyncAt ? Date.parse(integration.nextSyncAt) : null;

    // Legacy rows without a computed slot run once now and get one.
    if (due !== null && Number.isFinite(due) && nowMs < due) continue;

    try {
      await runSupplierSync(integration, "scheduled");
      ran++;
    } catch (error) {
      console.error("SCHEDULED SUPPLIER SYNC ERROR:", integration.id, error.message);
    }
  }

  return { ran };
}

function startScheduler() {
  if (schedulerTimer) return;

  // Give legacy approved integrations a schedule slot at boot.
  refreshNextSyncAt();

  schedulerTimer = setInterval(() => {
    runDueScheduledSyncs().catch((error) => {
      console.error("SUPPLIER SYNC SCHEDULER ERROR:", error.message);
    });
  }, 60 * 1000);

  if (typeof schedulerTimer.unref === "function") schedulerTimer.unref();
}

// =====================================================
// CHECKOUT STOCK GUARD
// =====================================================
// Mounted by server.js BEFORE the order routes. For every supplier-
// linked product in the cart it refreshes price/stock from the supplier
// (at most once per 30s per integration), so the order is validated
// against LIVE stock — not last night's value. If the supplier cannot
// confirm, the guard fails closed: the product is marked unverified and
// the order is refused instead of selling unconfirmed stock.

// Env override exists so isolated tests can force a live supplier call
// on every checkout without waiting for the cache window.
const CHECKOUT_REFRESH_TTL_MS = Number.isFinite(Number(process.env.JB_CHECKOUT_REFRESH_TTL_MS))
  ? Math.max(0, Number(process.env.JB_CHECKOUT_REFRESH_TTL_MS))
  : 30 * 1000;
const checkoutRefreshCache = new Map();

async function refreshIntegrationForCheckout(integration, skus) {
  const settings = getImportSettings();
  const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(integration.sellerId);

  if (!seller) throw new Error("Seller not found for this supplier.");

  const mapping = readMapping(integration.mappingJson);
  const items = await fetchSupplierItems(integration, settings.maxSyncItems);
  const wanted = new Set(skus.map((sku) => clean(sku).toLowerCase()).filter(Boolean));
  const found = new Set();

  const tx = db.transaction(() => {
    for (const item of items) {
      const normalized = normalizeSupplierItem(item, mapping);
      const sku = clean(normalized.sku).toLowerCase();
      if (!sku || !wanted.has(sku)) continue;

      const result = applySupplierItem(
        seller,
        item,
        mapping,
        integration.id,
        null,
        { allowCreate: false }
      );

      if (result.status === "updated") found.add(sku);
    }
  });
  tx();

  return found;
}

export async function supplierCheckoutStockGuard(req, res, next) {
  if (req.method !== "POST" || !/^\/api\/orders\/?$/.test(req.path)) return next();

  const items = Array.isArray(req.body?.items) ? req.body.items : [];
  if (items.length === 0) return next();

  const ids = items
    .map((item) => Number(item.productId || item.id))
    .filter((id) => Number.isInteger(id) && id > 0);
  if (ids.length === 0) return next();

  let groups = new Map();

  try {
    const placeholders = ids.map(() => "?").join(",");
    const products = db
      .prepare(
        `SELECT id, name, sku, source, sourceRef FROM products WHERE id IN (${placeholders})`
      )
      .all(...ids);

    for (const product of products) {
      if (product.source !== "supplier_api") continue;
      const match = /^integration:(\d+)$/.exec(String(product.sourceRef || ""));
      if (!match) continue;

      const integrationId = Number(match[1]);
      if (!groups.has(integrationId)) groups.set(integrationId, []);
      groups.get(integrationId).push(product);
    }

    for (const [integrationId, groupProducts] of groups) {
      const integration = db
        .prepare(
          `SELECT * FROM seller_api_integrations WHERE id = ? AND status = 'Approved'`
        )
        .get(integrationId);

      if (!integration) {
        return res.status(409).json({
          success: false,
          code: "STOCK_UNVERIFIED",
          message: `"${groupProducts[0].name}" is temporarily unavailable — its supplier connection is not approved.`,
        });
      }

      const cached = checkoutRefreshCache.get(integrationId);
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
            message: `"${missing[0].name}" is no longer available from the supplier. Nothing was ordered — please remove it from your cart.`,
          });
        }

        checkoutRefreshCache.set(integrationId, { at: Date.now() });
      } catch (error) {
        // Fail closed: never sell stock the supplier just failed to confirm.
        db.prepare(
          `UPDATE products SET stockUnverified = 1
           WHERE source = 'supplier_api' AND sourceRef = ?`
        ).run(`integration:${integrationId}`);
        checkoutRefreshCache.delete(integrationId);

        return res.status(409).json({
          success: false,
          code: "STOCK_UNVERIFIED",
          message: `"${groupProducts[0].name}" — live supplier stock could not be confirmed right now (${error.message}). Nothing was ordered; please try again in a few minutes.`,
        });
      }
    }

    return next();
  } catch (error) {
    console.error("CHECKOUT STOCK GUARD ERROR:", error);

    if (groups.size > 0) {
      return res.status(503).json({
        success: false,
        code: "STOCK_UNVERIFIED",
        message:
          "Live stock could not be verified for a supplier product. Nothing was ordered; please try again shortly.",
      });
    }
    return next();
  }
}

// =====================================================
// ADMIN — GST RATE IMPORT (CSV / XLSX)
// =====================================================
// Reuses the dependency-free CSV/XLSX reader that powers the seller
// product import. Every imported row is staged as a PENDING draft — an
// admin must approve it before it affects any price.
sellerImportsRouter.post(
  "/api/admin/gst/import",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const buffer = Buffer.isBuffer(req.body) ? req.body : Buffer.from("");
      if (!buffer.length) {
        return res.status(400).json({ success: false, message: "The uploaded file is empty." });
      }
      if (buffer.length > 5 * 1024 * 1024) {
        return res.status(413).json({ success: false, message: "GST rate file must be under 5 MB." });
      }

      const fileName = clean(req.headers["x-file-name"] || req.query.fileName || "gst-rates.csv");
      const declaredType = clean(req.headers["x-file-type"] || req.query.fileType).toLowerCase();
      const fileType = declaredType || (fileName.toLowerCase().endsWith(".xlsx") ? "xlsx" : "csv");

      const rows = readUploadRows(buffer, fileType);
      const actor = clean(req.user?.name || req.user?.username || "admin");
      const result = stageGstImport(rows, actor);

      if (!result.ok) {
        return res.status(result.status || 400).json({ success: false, message: result.message });
      }

      res.json({
        success: true,
        message: result.message,
        importedCount: result.importedCount,
        errorCount: result.errorCount,
        errors: result.errors,
        mappings: result.mappings,
      });
    } catch (error) {
      console.error("GST import error:", error);
      res.status(400).json({ success: false, message: error.message || "Failed to import GST rates." });
    }
  }
);

// =====================================================
// INIT
// =====================================================

export function initSellerImports() {
  ensureImportTables();
  startScheduler();
  console.log("Seller import & supplier sync tables ready.");
}

// Shared with the marketplace connectors (Amazon / Flipkart / Meesho /
// GlowRoad) so encryption, margin math and scheduling have exactly ONE
// implementation across supplier and marketplace syncs.
export {
  encryptSecret,
  decryptSecret,
  secretHint,
  computeMarkup,
  resolveMarginRule,
  buildSupplierPricing,
  computeNextSyncAt,
  getImportSettings,
  readMapping,
  normalizeSupplierItem,
  splitImages,
};

export default sellerImportsRouter;
