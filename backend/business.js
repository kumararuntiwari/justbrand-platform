// =====================================================
// JUSTBRAND BUSINESS LAYER
// =====================================================
// Additive module mounted by server.js. Contains:
//   - Sellers (registration, login, KYC, bank, products, orders)
//   - Customers (registration, login, orders)
//   - Orders (stored in DB, status tracking, cancellation)
//   - JustBrand Family / MLM (members, A/B/C placement, spillover,
//     tree, wallet, commissions, admin-configurable rules)
//   - Commission engine (return window, cancelled/refunded rules)
//   - Admin management endpoints (role-restricted)
//
// Rules preserved from the existing MLM commission configuration:
//   directCommission: 10, levelCommission: 5, binaryCommission: 5,
//   shoppingCommission: 3, returnPeriodDays: 7, directMemberLimit: 3,
//   commissionAfterReturn: true, cancelCommission: false,
//   returnCommission: false
// =====================================================

import express from "express";
import {
  hashPassword,
  comparePassword,
  createToken,
  requireAuth,
  requireRole,
  requireType,
} from "./auth.js";
import db from "./db.js";
// ADDITIVE: admin-configurable payment settings (DB-backed with env
// fallback) + courier (logistics company) helpers for order responses.
import { buildPaymentConfig } from "./payment-admin.js";
import { courierPartnerNames, courierPublicTracking } from "./courier.js";
import {
  PAN_STATUS,
  GST_STATUS,
  ENROLMENT_STATUS,
  INVOICE_TYPE,
  cleanTaxText,
  normalizeTaxState,
  maskTaxId,
  validatePan,
  validateGstin,
  computeSellerTaxEligibility,
  isIntraState,
} from "./seller-tax.js";
// ADDITIVE: 3×3 direct / spillover / time-wise earning engine. Its
// settings, snapshots and commission rows are isolated by source, so
// existing Family commission and wallet behaviour stays unchanged.
import {
  initMlm3x3,
  captureMlm3x3OrderSnapshot,
  generateMlm3x3CommissionsForOrder,
  voidMlm3x3CommissionsForOrder,
  getMlm3x3Settings,
  saveMlm3x3Settings,
  listMlm3x3SettingsAudit,
  listMlm3x3Commissions,
  getMlm3x3Summary,
  classifyIntroduction,
  recordMlmReferral,
} from "./mlm-3x3.js";
// ADDITIVE: admin-verified GST mappings (category / subcategory / HSN),
// approval + effective-date gating, audit history and CSV/XLSX staging.
import {
  initGstMappings,
  findApprovedMapping,
  listGstMappings,
  getGstMapping,
  saveGstMapping,
  approveGstMapping,
  deleteGstMapping,
  listGstHistory,
  getGstMappingSummary,
  stageGstImport,
} from "./gst.js";

export const businessRouter = express.Router();

// =====================================
// HELPERS
// =====================================

function now() {
  return new Date().toISOString();
}

function clean(value) {
  return String(value ?? "").trim();
}

// =====================================
// MULTI-IMAGE HELPERS (additive)
// =====================================
// Products can carry up to 6 images. Canonical storage is the
// `images` column (JSON array, first entry = primary/main image);
// the legacy `image` column stays in sync (image = images[0]) so the
// old single-image field keeps working for every existing client.

const MAX_PRODUCT_IMAGES = 6;
const ALLOWED_IMAGE_MIME = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

function parseProductImages(value) {
  let list = [];
  if (value) {
    try {
      const parsed = JSON.parse(value);
      if (Array.isArray(parsed)) {
        list = parsed.map((entry) => String(entry || "").trim()).filter(Boolean);
      }
    } catch {
      // Corrupt/non-JSON value — fall back to the legacy image column.
      list = [];
    }
  }
  return list;
}

// Accepts the product row and any *newly submitted* image payload and
// returns the canonical image list. Backward compatible: when no
// images payload arrives, falls back to the legacy `image` column.
// The list is NOT truncated here — over-limit submissions are
// rejected by validateProductImages with a clear error instead.
export function resolveProductImages(row, incoming) {
  if (Array.isArray(incoming)) {
    const list = incoming
      .map((entry) => String(entry || "").trim())
      .filter(Boolean);
    return list.length > 0 ? list : [String(row?.image || "").trim()].filter(Boolean);
  }
  const legacy = String(incoming || "").trim() || String(row?.image || "").trim();
  return legacy ? [legacy] : [];
}

// Validates image entries for seller-owned writes. `data:` URLs and
// http(s) URLs are both accepted (matches the existing upload flow);
// anything else is rejected so invalid uploads never reach the DB.
export function validateProductImages(list) {
  if (list.length < 1) {
    return "At least one product image is required.";
  }
  if (list.length > MAX_PRODUCT_IMAGES) {
    return `Maximum ${MAX_PRODUCT_IMAGES} images are allowed per product.`;
  }
  for (const entry of list) {
    if (entry.startsWith("data:image/")) {
      const mimeMatch = /^data:(image\/[a-z0-9.+-]+);/i.exec(entry);
      const mime = mimeMatch ? mimeMatch[1].toLowerCase() : "";
      if (!ALLOWED_IMAGE_MIME.has(mime)) {
        return "Only JPG, JPEG, PNG and WebP image formats are allowed.";
      }
    } else if (!/^(https?:\/\/|\/)/i.test(entry)) {
      return "Each image must be an uploaded file or a valid image URL.";
    }
  }
  return null;
}

// Response shaping: keeps the legacy `image` field populated and adds
// an `images` array. Only seller/admin payloads include the images
// array — the public buyer list maps rows through mapPublicProduct.
export function withProductImages(product) {
  if (!product) return product;
  const list = parseProductImages(product.images);
  const images = list.length > 0 ? list : [String(product.image || "").trim()].filter(Boolean);
  return { ...product, images };
}

// Public (buyer-facing) shaping: exposes `images` and keeps `image`
// as the primary entry so old bundles keep rendering unchanged.
// LIMITED STOCK TRACKING: `stock` is exposed as-is (null = not
// tracked) plus a derived `inStock` boolean so the Buyer can block
// checkout on tracked products that hit zero.
// Supplier cost + JustBrand markup are internal commercial data. They
// are stripped from every buyer / seller payload and never exposed —
// the seller sees the selling price, only the admin sees the split.
export function stripSupplierCost(product) {
  if (!product) return product;
  const {
    supplierPrice,
    markupType,
    markupValue,
    markupAmount,
    priceSource,
    ...rest
  } = product;
  return rest;
}

export function mapPublicProduct(product) {
  const { images } = withProductImages(product);
  const stock =
    product.stock === null || product.stock === undefined
      ? null
      : Number(product.stock);
  const stockUnverified = Number(product.stockUnverified) === 1;

  return {
    ...stripSupplierCost(product),
    images,
    image: images[0] || "",
    stock,
    // STOCK CONFIDENCE: a supplier product whose latest sync failed is
    // not shown as available until the supplier confirms stock again.
    stockUnverified,
    inStock: !stockUnverified && (stock === null || stock > 0),
  };
}

// ======================================================
// STOCK INPUT VALIDATION (seller add/edit product)
// ======================================================
// Limited stock tracking business rules:
//   • omitted (undefined) → leave the stored value unchanged
//   • null / blank string  → store NULL = untracked (unlimited)
//   • otherwise must be a whole number ≥ 0 (negative / fractional /
//     non-numeric are rejected — never silently coerced).
export function validateStockInput(value) {
  if (value === undefined) return { ok: true, unset: true };

  if (value === null) return { ok: true, stock: null };

  if (typeof value === "string" && value.trim() === "") {
    return { ok: true, stock: null };
  }

  const n = Number(value);

  if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0) {
    return {
      ok: false,
      message: "Stock must be a whole number of 0 or more (blank = unlimited).",
    };
  }

  return { ok: true, stock: n };
}

function publicSeller(seller) {
  if (!seller) return null;
  return {
    id: seller.id,
    sellerCode: seller.sellerCode,
    name: seller.name,
    shopName: seller.shopName,
    mobile: seller.mobile,
    email: seller.email,
    status: seller.status,
    createdAt: seller.createdAt,
    lastLoginAt: seller.lastLoginAt,
  };
}

// =====================================================
// SELLER TAX PROFILE HELPERS
// =====================================================
function getSellerTaxRow(sellerRef) {
  const numeric = Number(sellerRef);
  return db
    .prepare(
      `SELECT s.id AS sellerId, s.sellerCode, s.name, s.shopName, s.mobile,
              s.email, s.status AS sellerStatus, k.*
       FROM sellers s
       LEFT JOIN seller_kyc k ON k.sellerId = s.id
       WHERE s.id = ? OR s.sellerCode = ?`
    )
    .get(Number.isFinite(numeric) ? numeric : 0, String(sellerRef ?? ""));
}

function getSellerTaxProfile(sellerRef) {
  const row = getSellerTaxRow(sellerRef);
  if (!row) return null;
  const eligibility = computeSellerTaxEligibility(row);
  return { row, eligibility };
}

// Public marketplace rule: only an Approved product whose seller currently
// satisfies KYC + PAN + Admin GST approval may be exposed to buyers. This is
// evaluated live, so revoking tax approval hides existing records without
// deleting or rewriting them.
export function isProductSellable(product) {
  if (!product || product.status !== "Approved") return false;
  const profile = getSellerTaxProfile(product.sellerId);
  return Boolean(
    profile &&
      profile.eligibility.canSell &&
      profile.eligibility.taxTreatment === "gst"
  );
}

export function filterSellableProducts(products) {
  const profileCache = new Map();
  return (Array.isArray(products) ? products : []).filter((product) => {
    if (!product || product.status !== "Approved") return false;
    const key = String(product.sellerId ?? "");
    if (!profileCache.has(key)) {
      const profile = getSellerTaxProfile(product.sellerId);
      profileCache.set(
        key,
        Boolean(
          profile &&
            profile.eligibility.canSell &&
            profile.eligibility.taxTreatment === "gst"
        )
      );
    }
    return profileCache.get(key);
  });
}

// Re-evaluate a product against the seller's CURRENT tax profile and
// persist the derived tax fields. Used by admin approval and by GST
// approval (which resubmits affected products for re-approval).
export function applyProductSellerTax(productId) {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(Number(productId));
  if (!product) return { ok: false, code: "NOT_FOUND", message: "Product not found." };

  const profile = getSellerTaxProfile(product.sellerId);
  if (!profile) {
    return { ok: false, code: "SELLER_NOT_FOUND", message: "Seller not found for this product." };
  }

  if (!profile.eligibility.canSell) {
    return {
      ok: false,
      code: "SELLER_TAX_BLOCKED",
      message:
        "Seller tax eligibility is not approved for selling: " +
        (profile.eligibility.blockers.join(" ") || "admin review pending."),
      blockers: profile.eligibility.blockers,
      taxProfile: publicSellerTaxProfile(profile.row, profile.eligibility),
    };
  }

  const gst = resolveSellerProductTax(product.sellerId, product);
  const pricing = calculateCustomerPricing(product.price, gst.gstRate, gst.priceIncludesGst);

  db.prepare(`
    UPDATE products
    SET gstRate = ?, gstSource = ?, deliveryCharge = ?, platformCharge = ?,
        mlmCommission = ?, customerPrice = ?, pricingUpdatedAt = ?,
        taxTreatment = ?, gstInvoiceAllowed = ?, sellerTaxSnapshot = ?,
        taxTreatmentReason = ?
    WHERE id = ?
  `).run(
    gst.gstRate,
    gst.source,
    pricing.deliveryCharge,
    pricing.platformCharge,
    pricing.mlmCommission,
    pricing.customerPrice,
    now(),
    gst.taxTreatment ?? null,
    gst.gstInvoiceAllowed ?? 1,
    gst.sellerTaxSnapshot ?? null,
    gst.taxTreatmentReason ?? null,
    product.id
  );

  return {
    ok: true,
    product: db.prepare(`SELECT * FROM products WHERE id = ?`).get(product.id),
    tax: gst,
    taxProfile: publicSellerTaxProfile(profile.row, profile.eligibility),
  };
}

function publicSellerTaxProfile(row, eligibility) {
  if (!row) return null;
  return {
    sellerId: row.sellerId,
    panNumberMasked: maskTaxId(row.panNumber),
    panStatus: eligibility.panStatus,
    panVerifiedAt: row.panVerifiedAt || null,
    panRejectionReason: row.panRejectionReason || null,
    gstNumberMasked: maskTaxId(row.gstNumber),
    gstStatus: eligibility.gstStatus,
    gstSubmittedAt: row.gstSubmittedAt || null,
    gstApprovedAt: row.gstApprovedAt || null,
    gstRejectionReason: row.gstRejectionReason || null,
    businessType: row.businessType || "goods",
    state: row.state || "",
    enrolmentNumberMasked: maskTaxId(row.enrolmentNumber),
    enrolmentStatus: row.enrolmentStatus || ENROLMENT_STATUS.NOT_PROVIDED,
    turnoverBelowThreshold: Number(row.turnoverBelowThreshold) === 1,
    unregisteredSellingApproved: Number(row.unregisteredSellingApproved) === 1,
    unregisteredApprovedAt: row.unregisteredApprovedAt || null,
    taxProfileConfigured: Number(row.taxProfileConfigured) === 1,
    canSell: eligibility.canSell,
    taxTreatment: eligibility.taxTreatment,
    invoiceType: eligibility.invoiceType,
    intraStateOnly: eligibility.intraStateOnly,
    blockers: eligibility.blockers,
    note: eligibility.note || row.taxNote || null,
  };
}

// Resolve the product's tax treatment from the CURRENT seller profile.
// Only a GST-approved seller gets a sellable treatment. Blocked sellers
// (including legacy profiles without tax capture) get 0% and can never be
// admin-approved until KYC + PAN + GSTIN approval are complete.
function resolveSellerProductTax(sellerId, productLike) {
  const profile = getSellerTaxProfile(sellerId);
  if (!profile) {
    return {
      ...resolveProductGst(productLike),
      taxTreatment: null,
      gstInvoiceAllowed: 1,
      sellerTaxSnapshot: null,
      taxTreatmentReason: null,
    };
  }

  const { row, eligibility } = profile;
  const snapshot = publicSellerTaxProfile(row, eligibility);

  if (eligibility.taxTreatment === "gst") {
    // Ignore a stale non_gst/blocked treatment stored while the seller
    // was unregistered: after GST approval the approved HSN/category
    // mapping (or the seller's fresh proposal) is authoritative again.
    return {
      ...resolveProductGst({ ...productLike, taxTreatment: "gst" }),
      taxTreatment: "gst",
      gstInvoiceAllowed: 1,
      sellerTaxSnapshot: JSON.stringify(snapshot),
      taxTreatmentReason: "GST Registered seller — approved HSN/category mapping applies.",
    };
  }

  return {
    gstRate: 0,
    source: "none",
    gstType: "exclusive",
    priceIncludesGst: false,
    hsnCode: clean(productLike.hsnCode || ""),
    needsReview: false,
    flags: [],
    taxTreatment: "blocked",
    gstInvoiceAllowed: 0,
    sellerTaxSnapshot: JSON.stringify(snapshot),
    taxTreatmentReason:
      eligibility.blockers.join(" ") || "Seller tax eligibility is not approved.",
  };
}

function checkoutSellerTaxGuard(product) {
  const profile = getSellerTaxProfile(product.sellerId);
  if (!profile) {
    return {
      status: 409,
      code: "SELLER_GST_REQUIRED",
      message: `"${product.name}" cannot be sold until the seller's PAN and GSTIN are approved.`,
    };
  }

  if (!profile.eligibility.canSell) {
    return {
      status: 409,
      code: "SELLER_GST_REQUIRED",
      message: `"${product.name}" cannot be sold yet: ${profile.eligibility.blockers.join(" ") || "seller KYC, PAN and GSTIN approval are required."}`,
    };
  }

  return null;
}

function writeSellerTaxAudit({ sellerId, actor, action, before, after, reason }) {
  return writeSellerAudit({
    sellerId,
    action,
    actorType: "admin",
    actorId: actor?.adminId || actor?.id || actor?.name || "admin",
    before: before === null || before === undefined ? null : { status: before },
    after: after === null || after === undefined ? null : { status: after },
    note: reason,
  });
}

function writeSellerAudit({ sellerId, action, actorType, actorId, before, after, note }) {
  db.prepare(
    `INSERT INTO seller_audit_log
       (sellerId, action, actorType, actorId, beforeJson, afterJson, note, createdAt)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(
    Number(sellerId),
    cleanTaxText(action, 80) || "update",
    cleanTaxText(actorType, 20) || "system",
    cleanTaxText(actorId, 80) || null,
    before ? JSON.stringify(before) : null,
    after ? JSON.stringify(after) : null,
    cleanTaxText(note, 500) || null,
    now()
  );
}

function publicCustomer(customer) {
  if (!customer) return null;
  return {
    id: customer.id,
    name: customer.name,
    mobile: customer.mobile,
    email: customer.email,
    referredByMemberId: customer.referredByMemberId,
    createdAt: customer.createdAt,
    address: customer.address || null,
    city: customer.city || null,
    state: customer.state || null,
    pincode: customer.pincode || null,
  };
}

function publicMember(member) {
  if (!member) return null;
  return {
    id: member.id,
    memberId: member.memberId,
    name: member.name,
    mobile: member.mobile,
    email: member.email,
    referralCode: member.referralCode,
    parentId: member.parentId,
    parentName: member.parentName || null,
    position: member.position,
    status: member.status,
    createdAt: member.createdAt,
  };
}

// Simple in-memory rate limiter for auth endpoints
// (no new dependencies; sliding window per IP per route).
const authAttempts = new Map();

function pruneAuthAttempts(nowMs) {
  if (authAttempts.size <= 5000) return;

  for (const [key, timestamps] of authAttempts) {
    const alive = timestamps.filter(
      (timestamp) => nowMs - timestamp < 5 * 60 * 1000
    );

    if (alive.length === 0) {
      authAttempts.delete(key);
    } else {
      authAttempts.set(key, alive);
    }
  }
}

function rateLimit(maxAttempts, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip || "unknown"}:${req.baseUrl || ""}${req.route?.path || req.path}`;
    const currentTime = Date.now();

    pruneAuthAttempts(currentTime);

    const attempts = (authAttempts.get(key) || []).filter(
      (timestamp) => currentTime - timestamp < windowMs
    );

    if (attempts.length >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: "Too many attempts. Please try again later.",
      });
    }

    attempts.push(currentTime);
    authAttempts.set(key, attempts);

    next();
  };
}

// =====================================
// TABLES (ALL ADDITIVE / IF NOT EXISTS)
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS sellers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerCode TEXT UNIQUE,
    name TEXT NOT NULL,
    shopName TEXT,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT UNIQUE NOT NULL,
    passwordHash TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS seller_kyc (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId INTEGER UNIQUE NOT NULL,
    shopName TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    gstNumber TEXT,
    panNumber TEXT,
    aadhaarNumber TEXT,
    kycStatus TEXT NOT NULL DEFAULT 'Pending',
    rejectionReason TEXT,
    updatedAt TEXT
  )
`).run();

// -----------------------------------------------------
// ADDITIVE: PAN / GST TAX PROFILE (seller_kyc columns)
// -----------------------------------------------------
// Existing rows keep taxProfileConfigured = 0 and therefore retain the
// old GST behaviour until the admin captures their tax details. New
// registrations through the updated UI set it to 1.
function ensureSellerTaxColumns() {
  const columns = db.prepare("PRAGMA table_info(seller_kyc)").all();
  const existing = new Set(columns.map((column) => column.name));
  const additions = [
    ["panStatus", "TEXT DEFAULT 'Pending Verification'"],
    ["panVerifiedAt", "TEXT"],
    ["panVerifiedBy", "TEXT"],
    ["panRejectionReason", "TEXT"],
    ["gstStatus", "TEXT DEFAULT 'GST Unregistered'"],
    ["gstSubmittedAt", "TEXT"],
    ["gstApprovedAt", "TEXT"],
    ["gstApprovedBy", "TEXT"],
    ["gstRejectionReason", "TEXT"],
    ["businessType", "TEXT DEFAULT 'goods'"],
    ["enrolmentNumber", "TEXT"],
    ["enrolmentStatus", "TEXT DEFAULT 'Not Provided'"],
    ["turnoverBelowThreshold", "INTEGER DEFAULT 1"],
    ["unregisteredSellingApproved", "INTEGER DEFAULT 0"],
    ["unregisteredApprovedAt", "TEXT"],
    ["unregisteredApprovedBy", "TEXT"],
    ["taxProfileConfigured", "INTEGER DEFAULT 0"],
    ["taxNote", "TEXT"],
  ];

  for (const [name, type] of additions) {
    if (!existing.has(name)) {
      db.prepare(`ALTER TABLE seller_kyc ADD COLUMN ${name} ${type}`).run();
    }
  }
}

ensureSellerTaxColumns();

db.prepare(`
  CREATE TABLE IF NOT EXISTS seller_audit_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId INTEGER NOT NULL,
    action TEXT NOT NULL,
    actorType TEXT NOT NULL DEFAULT 'system',
    actorId TEXT,
    beforeJson TEXT,
    afterJson TEXT,
    note TEXT,
    createdAt TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS seller_bank (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId INTEGER UNIQUE NOT NULL,
    accountName TEXT,
    accountNumber TEXT,
    ifscCode TEXT,
    bankName TEXT,
    upiId TEXT,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS customers (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT,
    passwordHash TEXT NOT NULL,
    referredByMemberId TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS orders (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderNumber TEXT UNIQUE NOT NULL,
    customerId INTEGER NOT NULL,
    customerName TEXT,
    phone TEXT,
    address TEXT,
    totalAmount TEXT,
    paymentMethod TEXT DEFAULT 'COD',
    paymentStatus TEXT DEFAULT 'Pending',
    paymentRef TEXT,
    status TEXT NOT NULL DEFAULT 'Pending',
    deliveredAt TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    email TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS order_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    productId INTEGER NOT NULL,
    productName TEXT,
    sellerId TEXT,
    price TEXT,
    quantity INTEGER NOT NULL DEFAULT 1
  )
`).run();

// ADDITIVE: immutable per-seller invoice snapshots created with the
// order. Non-GST sellers get a NON_GST_INVOICE with zero tax fields;
// GST sellers get a TAX_INVOICE. Existing orders keep no invoice row
// until/unless a future migration explicitly backfills them (never
// silently rewritten).
db.prepare(`
  CREATE TABLE IF NOT EXISTS order_invoices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    sellerId TEXT,
    invoiceNumber TEXT NOT NULL,
    invoiceType TEXT NOT NULL,
    sellerName TEXT,
    sellerGstin TEXT,
    sellerState TEXT,
    placeOfSupply TEXT,
    taxableValue REAL NOT NULL DEFAULT 0,
    cgst REAL NOT NULL DEFAULT 0,
    sgst REAL NOT NULL DEFAULT 0,
    igst REAL NOT NULL DEFAULT 0,
    gstAmount REAL NOT NULL DEFAULT 0,
    total REAL NOT NULL DEFAULT 0,
    snapshotJson TEXT,
    issuedAt TEXT NOT NULL
  )
`).run();

// LIMITED STOCK TRACKING (additive): orders created after stock
// tracking record whether tracked-product stock was decremented for
// them. Only those orders may restore stock on the verified
// pre-shipping customer cancel — orders from before the feature
// (no decrement happened) must never inflate inventory on cancel.
function ensureOrderStockColumns() {
  const columns = db.prepare("PRAGMA table_info(orders)").all();
  const existing = new Set(columns.map((column) => column.name));
  if (!existing.has("stockDeducted")) {
    db.prepare("ALTER TABLE orders ADD COLUMN stockDeducted INTEGER NOT NULL DEFAULT 0").run();
  }
}

ensureOrderStockColumns();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_members (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    mobile TEXT UNIQUE NOT NULL,
    email TEXT,
    passwordHash TEXT NOT NULL,
    referralCode TEXT UNIQUE,
    parentId TEXT,
    position TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_wallets (
    memberId TEXT PRIMARY KEY,
    balance REAL NOT NULL DEFAULT 0,
    totalEarned REAL NOT NULL DEFAULT 0,
    totalPaid REAL NOT NULL DEFAULT 0,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_commissions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT NOT NULL,
    orderId INTEGER,
    type TEXT,
    description TEXT,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pending',
    createdAt TEXT NOT NULL,
    payableAt TEXT,
    paidAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT
  )
`).run();

// =====================================
// PAN-INDIA TIME-BASED SPILLOVER SCHEMA (additive)
// =====================================
// Shopping-eligibility events + audited placement records for the
// automatic spillover system. ADDITIVE ONLY: existing tables/columns
// are never rewritten — legacy members keep the parentId/position
// they already have, and historical commission rows stay untouched.
//
// mlm_eligibility_events — one authoritative server-side record per
//   qualifying order (UNIQUE orderId = duplicate events are impossible
//   to double-process). confirmedAt is the authoritative timestamp of
//   when shopping eligibility was confirmed (stored UTC, displayed IST).
//
// mlm_placements — one audited placement row per member (UNIQUE
//   memberId = a member can never be placed twice). Records the parent,
//   the A/B/C slot, the qualifying order and the eligibility timestamp.
//
// mlm_placement_audit — append-only log for every placement action
//   (automatic and manual) so corrections are traceable.

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_eligibility_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    memberId TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'Confirmed',
    confirmedAt TEXT NOT NULL,
    revokedAt TEXT,
    revokeReason TEXT,
    createdAt TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_mlm_eligibility_order
  ON mlm_eligibility_events(orderId)
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_mlm_eligibility_member
  ON mlm_eligibility_events(memberId)
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_placements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT NOT NULL UNIQUE,
    parentId TEXT,
    position TEXT,
    eligibilityEventId INTEGER,
    qualifyingOrderId INTEGER,
    eligibilityAt TEXT,
    status TEXT NOT NULL DEFAULT 'Placed',
    reason TEXT,
    createdAt TEXT NOT NULL
  )
`).run();

db.prepare(`
  CREATE INDEX IF NOT EXISTS idx_mlm_placements_parent
  ON mlm_placements(parentId)
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS mlm_placement_audit (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    at TEXT NOT NULL,
    actor TEXT NOT NULL,
    action TEXT NOT NULL,
    memberId TEXT,
    details TEXT
  )
`).run();

// Sponsor link (who referred the member) is recorded at registration
// but placement itself is DEFERRED until shopping eligibility is
// confirmed. Additive column — guarded so upgrades of existing
// databases (production included) are a no-op when it already exists.
const memberColumns = db.prepare(`PRAGMA table_info(mlm_members)`).all();
if (!memberColumns.some((column) => column.name === "sponsorId")) {
  db.prepare(`ALTER TABLE mlm_members ADD COLUMN sponsorId TEXT`).run();
}

// =====================================
// SELLER PRICING / TAX SETTINGS
// =====================================
db.prepare(`
  CREATE TABLE IF NOT EXISTS pricing_settings (
    key TEXT PRIMARY KEY,
    value REAL NOT NULL,
    updatedAt TEXT
  )
`).run();

const DEFAULT_PRICING_RULES = {
  deliveryFlat: 40,
  platformPercent: 5,
  mlmPercent: 3,
};

function getPricingRules() {
  const rows = db.prepare(`SELECT key, value FROM pricing_settings`).all();
  const rules = { ...DEFAULT_PRICING_RULES };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(rules, row.key)) rules[row.key] = Number(row.value);
  }
  return rules;
}

export function calculateCustomerPricing(basePrice, gstRate = 0, priceIncludesGst = null) {
  // Prices may arrive as "₹1299" / " 1299 " / 1299 — strip non-numeric
  // characters before parsing (matches the sanitizePrice convention used
  // for the same field everywhere else in this file).
  const base = Math.max(0, Number(String(basePrice).replace(/[^0-9.]/g, "")) || 0);
  const rules = getPricingRules();

  // Admin-configurable charges (Charges & Tax Settings). The defaults
  // reproduce the legacy behaviour byte-for-byte — platform 5% per
  // product, delivery ₹40, GST 0% exclusive — so existing prices and
  // tests are unaffected until an admin actually changes a setting.
  const platformCfg = getPlatformFeeSettings();
  const deliveryCfg = getDeliverySettings();
  const gstCfg = getGstSettings();

  // The platform fee rides inside the unit price only on the
  // per_product basis; a per_order fee is charged exactly once by
  // calculateOrderTotals — never in both places (no double charge).
  const platformCharge =
    platformCfg.enabled && platformCfg.basis === "per_product"
      ? platformCfg.mode === "flat"
        ? platformCfg.value
        : (base * platformCfg.value) / 100
      : 0;

  const mlmCommission = (base * rules.mlmPercent) / 100;

  // Product-level delivery component = the configured default charge.
  // Order-level free-above / value-band / method rules are applied by
  // calculateOrderTotals, which is authoritative for what the buyer pays.
  const deliveryCharge =
    deliveryCfg.mode === "percent"
      ? (base * deliveryCfg.value) / 100
      : deliveryCfg.value;

  const taxableAmount = base + platformCharge + mlmCommission + deliveryCharge;
  const rate = Math.max(0, Number(gstRate) || 0);
  // Per-product GST type (set by an admin) overrides the global mode; an
  // empty product value keeps inheriting the admin GST setting.
  const inclusive =
    priceIncludesGst === null || priceIncludesGst === undefined
      ? Boolean(gstCfg.priceIncludesGst)
      : Boolean(priceIncludesGst);

  let gstAmount;
  let customerPrice;

  if (inclusive) {
    // GST-inclusive pricing: the selling price already contains the
    // tax, so it is extracted instead of added on top.
    gstAmount = taxableAmount - taxableAmount / (1 + rate / 100);
    customerPrice = Math.ceil(taxableAmount * 100) / 100;
  } else {
    gstAmount = (taxableAmount * rate) / 100;
    customerPrice = Math.ceil((taxableAmount + gstAmount) * 100) / 100;
  }

  return {
    basePrice: Math.round(base * 100) / 100,
    gstRate: rate,
    priceIncludesGst: inclusive,
    gstAmount: Math.round(gstAmount * 100) / 100,
    deliveryCharge: Math.round(deliveryCharge * 100) / 100,
    platformCharge: Math.round(platformCharge * 100) / 100,
    mlmCommission: Math.round(mlmCommission * 100) / 100,
    customerPrice,
  };
}

db.prepare(`
  CREATE TABLE IF NOT EXISTS payout_requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    memberId TEXT NOT NULL,
    amount REAL NOT NULL,
    method TEXT,
    status TEXT NOT NULL DEFAULT 'Processing',
    createdAt TEXT NOT NULL,
    processedAt TEXT
  )
`).run();

// =====================================
// MLM SETTINGS (ADMIN CONFIGURABLE)
// =====================================

const DEFAULT_MLM_RULES = {
  directCommission: 10,
  levelCommission: 5,
  binaryCommission: 5,
  shoppingCommission: 3,
  returnPeriodDays: 7,
  directMemberLimit: 3,
  commissionAfterReturn: true,
  cancelCommission: false,
  returnCommission: false,
};

function getMlmRules() {
  const row = db
    .prepare(`SELECT value FROM mlm_settings WHERE key = 'commission_rules'`)
    .get();

  if (!row) return { ...DEFAULT_MLM_RULES };

  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_MLM_RULES, ...parsed };
  } catch {
    return { ...DEFAULT_MLM_RULES };
  }
}

function saveMlmRules(rules) {
  db.prepare(`
    INSERT INTO mlm_settings (key, value, updatedAt)
    VALUES ('commission_rules', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(JSON.stringify(rules), now());
}

// =====================================
// MLM PLACEMENT (A/B/C + SPILLOVER)
// =====================================
// A member can have maximum 3 direct placements (A, B, C).
// When a referrer's 3 direct slots are full, the new member is
// spilled over to the first member in their subtree (breadth-first)
// that still has a free slot.

const MAX_DIRECT = 3;

function countDirectChildren(parentId) {
  const row = db
    .prepare(`SELECT COUNT(*) AS count FROM mlm_members WHERE parentId = ?`)
    .get(parentId);
  return row ? row.count : 0;
}

function findPlacementFor(referrer) {
  // Breadth-first search starting from the referrer.
  const queue = [referrer.memberId];

  while (queue.length > 0) {
    const currentId = queue.shift();

    const children = db
      .prepare(
        `SELECT memberId FROM mlm_members WHERE parentId = ? ORDER BY id ASC`
      )
      .all(currentId);

    if (children.length < MAX_DIRECT) {
      const position = ["A", "B", "C"][children.length] || "C";

      return { parentId: currentId, position };
    }

    children.forEach((child) => queue.push(child.memberId));
  }

  // Fallback (practically unreachable): place under the referrer as C.
  return { parentId: referrer.memberId, position: "C" };
}

function generateMemberId() {
  for (let attempt = 0; attempt < 50; attempt++) {
    const candidate = `JB${Math.floor(100000 + Math.random() * 900000)}`;

    const existing = db
      .prepare(`SELECT id FROM mlm_members WHERE memberId = ?`)
      .get(candidate);

    if (!existing) return candidate;
  }

  // Extremely unlikely fallback: timestamp-based ID.
  return `JB${Date.now()}`.slice(0, 8);
}

// =====================================
// PAN-INDIA TIME-BASED SPILLOVER ENGINE
// =====================================
// Replaces the old "place at registration" joining flow with an
// automatic, shopping-eligible, time-based system:
//
//   1. Registration records the SPONSOR (sponsorId) only — members
//      may join from anywhere in India; there is no location gate.
//   2. When one of the member's orders is Delivered (the existing
//      verified business rule for earning), shopping eligibility is
//      CONFIRMED with an authoritative server-side timestamp.
//   3. Confirmed-eligible members are placed in chronological order
//      of confirmed eligibility (identical timestamps fall back to
//      the unique, stable orderId — deterministic tie-break).
//   4. Placement uses breadth-first (level-order) traversal from the
//      sponsor: the first node in level order with a free direct
//      slot. A parent can NEVER have more than three direct children
//      — a fourth member always spills deeper.
//   5. Everything is transactional + guarded by UNIQUE constraints
//      (one event per order, one placement per member), so
//      simultaneous qualifying orders cannot duplicate placements or
//      exceed the three-member limit.
//   6. Existing members, their placements and all historical
//      commission rows are preserved untouched — this system only
//      places members that are currently unplaced.
//
// Timestamps are stored as UTC ISO strings (consistent with the rest
// of the schema) and DISPLAYED in Indian Standard Time (IST, +05:30)
// through toIst() — one consistent reference everywhere.

function toIst(iso) {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  const ist = new Date(date.getTime() + (5 * 60 + 30) * 60 * 1000);
  const pad = (n) => String(n).padStart(2, "0");
  return (
    `${ist.getUTCFullYear()}-${pad(ist.getUTCMonth() + 1)}-${pad(ist.getUTCDate())} ` +
    `${pad(ist.getUTCHours())}:${pad(ist.getUTCMinutes())}:${pad(ist.getUTCSeconds())} IST`
  );
}

function placementAudit(action, memberId, details, actor = "system") {
  db.prepare(`
    INSERT INTO mlm_placement_audit (at, actor, action, memberId, details)
    VALUES (?, ?, ?, ?, ?)
  `).run(now(), actor, action, memberId || null, JSON.stringify(details || {}));
}

// True when the member already occupies a tree position (placed by
// this engine OR by the legacy registration-time flow).
function isMemberPlaced(member) {
  if (member.parentId) return true; // legacy or spillover placement
  const placement = db
    .prepare(`SELECT id FROM mlm_placements WHERE memberId = ? LIMIT 1`)
    .get(member.memberId);
  return Boolean(placement);
}

// Place one confirmed-eligible member exactly once. Runs inside a
// transaction; the UNIQUE(memberId) constraint on mlm_placements is
// the final word on duplicate/concurrent attempts.
function placeEligibleMember(event, actor = "system") {
  const place = db.transaction((evt) => {
    const member = db
      .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
      .get(evt.memberId);

    if (!member) {
      return { placed: false, reason: "member-not-found" };
    }

    if (isMemberPlaced(member)) {
      return { placed: false, reason: "already-placed" };
    }

    let parentId = null;
    let position = null;

    const sponsor = member.sponsorId
      ? db
          .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
          .get(member.sponsorId)
      : null;

    if (sponsor && sponsor.memberId !== member.memberId) {
      // Breadth-first spillover inside the sponsor's subtree.
      const spot = findPlacementFor(sponsor);
      parentId = spot.parentId;
      position = spot.position;
    } else {
      // No sponsor (root joiner) — stays the root of its own tree.
      position = "ROOT";
    }

    // Hard safety guards: never a self-parent, never more than
    // MAX_DIRECT children (findPlacementFor guarantees the slot).
    if (parentId === member.memberId) {
      return { placed: false, reason: "self-placement-blocked" };
    }

    if (parentId && countDirectChildren(parentId) >= MAX_DIRECT) {
      // Slot vanished between BFS and write (cannot happen inside a
      // single synchronous transaction, but never exceed the limit).
      return { placed: false, reason: "direct-limit-reached" };
    }

    const result = db.prepare(`
      INSERT INTO mlm_placements (
        memberId, parentId, position, eligibilityEventId,
        qualifyingOrderId, eligibilityAt, status, reason, createdAt
      )
      VALUES (?, ?, ?, ?, ?, ?, 'Placed', NULL, ?)
    `).run(
      member.memberId,
      parentId,
      position,
      evt.id,
      evt.orderId,
      evt.confirmedAt,
      now()
    );

    db.prepare(`
      UPDATE mlm_members
      SET parentId = ?, position = ?
      WHERE memberId = ? AND parentId IS NULL
    `).run(parentId, position, member.memberId);

    return {
      placed: true,
      placementId: result.lastInsertRowid,
      parentId,
      position,
    };
  });

  try {
    const outcome = place(event);

    if (outcome.placed) {
      placementAudit(
        "auto-placement",
        event.memberId,
        {
          parentId: outcome.parentId,
          position: outcome.position,
          qualifyingOrderId: event.orderId,
          eligibilityAt: event.confirmedAt,
          eligibilityAtIst: toIst(event.confirmedAt),
        },
        actor
      );
    } else if (outcome.reason === "already-placed") {
      placementAudit(
        "duplicate-attempt",
        event.memberId,
        { qualifyingOrderId: event.orderId, reason: outcome.reason },
        actor
      );
    }

    return outcome;
  } catch (error) {
    // UNIQUE(memberId) violation = a concurrent writer placed the
    // member first. Record it; never place twice, never exceed three.
    if (String(error.message || "").includes("UNIQUE")) {
      placementAudit(
        "duplicate-attempt",
        event.memberId,
        { qualifyingOrderId: event.orderId, reason: "unique-member-placement" },
        actor
      );
      return { placed: false, reason: "duplicate" };
    }
    throw error;
  }
}

// Drain the confirmed-eligibility queue in chronological order
// (identical timestamps → orderId ascending, the unique stable
// tie-break). memberIdFilter narrows the drain (admin reprocess).
function processPendingEligiblePlacements(memberIdFilter = null, actor = "system") {
  const pending = db.prepare(`
    SELECT e.*
    FROM mlm_eligibility_events e
    JOIN mlm_members m ON m.memberId = e.memberId
    WHERE e.status = 'Confirmed'
      AND m.parentId IS NULL
      AND NOT EXISTS (
        SELECT 1 FROM mlm_placements p WHERE p.memberId = e.memberId
      )
      AND (? IS NULL OR e.memberId = ?)
    ORDER BY e.confirmedAt ASC, e.orderId ASC
  `).all(memberIdFilter || null, memberIdFilter || null);

  const results = [];
  for (const event of pending) {
    results.push(placeEligibleMember(event, actor));
  }
  return results;
}

// =====================================
// SHOPPING-ELIGIBILITY CONFIRMATION
// =====================================
// Uses the EXISTING verified business rules — no invented joining
// fee or qualifying amount:
//   • the order must reach Delivered (same rule Family commission
//     already uses),
//   • a cancelled / returned / refunded order never qualifies,
//   • a fully refunded payment (paymentStatus 'Refunded') never
//     qualifies,
//   • the buyer must map to an active MLM member (mobile match —
//     exactly how commission upline resolution already works),
//   • a zero-value order never qualifies (same guard as commission).
// Partial refunds: the existing data model has only full-refund
// states ('Refunded' status / paymentStatus); no partial-refund rule
// exists in the approved business rules, so none is invented here.
function confirmShoppingEligibility(order, actor = "system") {
  if (!order) return { confirmed: false, reason: "no-order" };

  if (["Cancelled", "Returned", "Refunded"].includes(order.status)) {
    return { confirmed: false, reason: "order-not-deliverable" };
  }

  if (order.paymentStatus === "Refunded") {
    return { confirmed: false, reason: "payment-refunded" };
  }

  const buyerAsMember = db
    .prepare(
      `SELECT * FROM mlm_members WHERE mobile = ? AND status = 'active' LIMIT 1`
    )
    .get(clean(order.phone));

  if (!buyerAsMember) {
    return { confirmed: false, reason: "no-member" };
  }

  const orderTotal =
    Number(String(order.totalAmount || "0").replace(/[^0-9.]/g, "")) || 0;

  if (orderTotal <= 0) {
    return { confirmed: false, reason: "zero-value-order" };
  }

  // Authoritative server-side confirmation timestamp.
  const confirmedAt = now();

  let eventId = null;

  try {
    const result = db.prepare(`
      INSERT INTO mlm_eligibility_events (
        orderId, memberId, status, confirmedAt, createdAt
      )
      VALUES (?, ?, 'Confirmed', ?, ?)
    `).run(order.id, buyerAsMember.memberId, confirmedAt, confirmedAt);

    eventId = result.lastInsertRowid;
  } catch (error) {
    if (String(error.message || "").includes("UNIQUE")) {
      // Same order confirmed before — duplicate event, never
      // double-processed. Audit and stop.
      placementAudit(
        "duplicate-event",
        buyerAsMember.memberId,
        { qualifyingOrderId: order.id },
        actor
      );
      return { confirmed: false, reason: "duplicate-event" };
    }
    throw error;
  }

  placementAudit(
    "eligibility-confirmed",
    buyerAsMember.memberId,
    {
      qualifyingOrderId: order.id,
      confirmedAt,
      confirmedAtIst: toIst(confirmedAt),
    },
    actor
  );

  // Place every pending member in chronological order (this member
  // included) so queue order is always eligibility-confirmation
  // order, not registration order.
  const outcomes = processPendingEligiblePlacements(null, actor);

  return {
    confirmed: true,
    eventId,
    memberId: buyerAsMember.memberId,
    confirmedAt,
    confirmedAtIst: toIst(confirmedAt),
    placements: outcomes.filter((outcome) => outcome.placed).length,
  };
}

// A qualifying order that is later cancelled / returned / refunded
// must stop counting: the event and any placement it produced are
// marked Revoked (permanent audit). The member is NOT moved or
// removed — existing valid placements are never rearranged.
function recordEligibilityRevocation(orderId, reason, actor = "system") {
  const event = db
    .prepare(`SELECT * FROM mlm_eligibility_events WHERE orderId = ? LIMIT 1`)
    .get(orderId);

  if (!event) return { revoked: false, reason: "no-event" };

  const revoke = db.transaction(() => {
    db.prepare(`
      UPDATE mlm_eligibility_events
      SET status = 'Revoked', revokedAt = ?, revokeReason = ?
      WHERE id = ? AND status = 'Confirmed'
    `).run(now(), reason, event.id);

    db.prepare(`
      UPDATE mlm_placements
      SET status = 'Revoked', reason = ?
      WHERE qualifyingOrderId = ? AND status = 'Placed'
    `).run(`Qualifying order ${orderId} ${reason}`, orderId);
  });

  revoke();

  placementAudit(
    "eligibility-revoked",
    event.memberId,
    { qualifyingOrderId: orderId, reason },
    actor
  );

  return { revoked: true, memberId: event.memberId };
}

// =====================================
// MLM COMMISSION ENGINE
// =====================================
// Commission lifecycle (preserves existing business rules):
//   1. Order placed            -> no commission
//   2. Order Delivered         -> commission records created as Pending
//   3. Return window passes    -> Pending becomes Payable (wallet credited)
//   4. Cancelled / Returned    -> no commission (Pending records are voided)
// Payment of Payable commissions to bank/UPI stays a restricted
// Super Admin / Accountant action (mlm_commissions.status -> 'Paid').

function releaseDueCommissions() {
  const due = db
    .prepare(`
      SELECT id, memberId, amount
      FROM mlm_commissions
      WHERE status = 'Pending'
      AND payableAt IS NOT NULL
      AND payableAt <= ?
    `)
    .all(now());

  due.forEach((commission) => {
    const markPayable = db.transaction(() => {
      db.prepare(
        `UPDATE mlm_commissions SET status = 'Payable' WHERE id = ?`
      ).run(commission.id);

      db.prepare(`
        INSERT INTO mlm_wallets (memberId, balance, totalEarned, updatedAt)
        VALUES (?, ?, ?, ?)
        ON CONFLICT(memberId) DO UPDATE SET
          balance = balance + excluded.balance,
          totalEarned = totalEarned + excluded.totalEarned,
          updatedAt = excluded.updatedAt
      `).run(commission.memberId, commission.amount, commission.amount, now());
    });

    markPayable();
  });
}

function voidCommissionsForOrder(orderId) {
  db.prepare(`
    UPDATE mlm_commissions
    SET status = 'Void'
    WHERE orderId = ? AND status = 'Pending'
  `).run(orderId);
}

function generateCommissionsForOrder(order) {
  const rules = getMlmRules();

  // Cancelled / returned orders never generate commission.
  if (["Cancelled", "Returned", "Refunded"].includes(order.status)) {
    return;
  }

  // Already generated? Do not duplicate.
  const existing = db
    .prepare(`SELECT id FROM mlm_commissions WHERE orderId = ? LIMIT 1`)
    .get(order.id);

  if (existing) return;

  // Find the MLM member linked to the buyer, if any.
  const buyerAsMember = db
    .prepare(
      `SELECT * FROM mlm_members WHERE mobile = ? AND status = 'active' LIMIT 1`
    )
    .get(clean(order.phone));

  const orderTotal =
    Number(String(order.totalAmount || "0").replace(/[^0-9.]/g, "")) || 0;

  if (orderTotal <= 0) return;

  const payableAt = rules.commissionAfterReturn
    ? new Date(
        new Date(order.deliveredAt || order.createdAt).getTime() +
          (Number(rules.returnPeriodDays) || 0) * 24 * 60 * 60 * 1000
      ).toISOString()
    : now();

  const records = [];

  if (buyerAsMember) {
    // Shopping commission for the member who purchased.
    if (rules.shoppingCommission > 0) {
      records.push({
        memberId: buyerAsMember.memberId,
        type: "shopping",
        description: `Shopping commission (${rules.shoppingCommission}%) on order ${order.orderNumber}`,
        amount: (orderTotal * rules.shoppingCommission) / 100,
      });
    }

    // Upline commissions: direct referrer (level 1) and above.
    let current = buyerAsMember.parentId
      ? db
          .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
          .get(buyerAsMember.parentId)
      : null;

    let level = 1;

    // Level-wise overrides (admin-configurable, additive). Falls back
    // to the flat rules values when no override exists, so existing
    // behaviour and data are unchanged.
    let levelOverrides = {};
    try {
      const row = db
        .prepare(`SELECT value FROM mlm_settings WHERE key = 'level_commissions'`)
        .get();
      if (row && row.value) {
        const parsed = JSON.parse(row.value);
        if (parsed && typeof parsed === "object") levelOverrides = parsed;
      }
    } catch {
      levelOverrides = {};
    }

    while (current && level <= 3) {
      const override = Number(levelOverrides[`level${level}`]);
      const percentage = Number.isFinite(override) && override >= 0
        ? override
        : level === 1
        ? rules.directCommission
        : rules.levelCommission;

      if (percentage > 0) {
        records.push({
          memberId: current.memberId,
          type: level === 1 ? "direct" : "level",
          description: `Level ${level} commission (${percentage}%) on order ${order.orderNumber}`,
          amount: (orderTotal * percentage) / 100,
        });
      }

      current = current.parentId
        ? db
            .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
            .get(current.parentId)
        : null;

      level += 1;
    }
  }

  if (records.length === 0) return;

  const insertAll = db.transaction(() => {
    records.forEach((record) => {
      db.prepare(`
        INSERT INTO mlm_commissions (
          memberId, orderId, type, description, amount, status, createdAt, payableAt
        )
        VALUES (?, ?, ?, ?, ?, 'Pending', ?, ?)
      `).run(
        record.memberId,
        order.id,
        record.type,
        record.description,
        record.amount,
        now(),
        payableAt
      );
    });
  });

  insertAll();
}

function orderWithItems(order) {
  const items = db
    .prepare(`SELECT * FROM order_items WHERE orderId = ?`)
    .all(order.id);

  // SECURITY: never expose the delivery OTP hash to any customer/seller/
  // public API response. It is an internal bcrypt digest used only by the
  // delivery module (deliveryOrderShape keeps its own safe field list).
  const { deliveryOtpHash, ...safeOrder } = order;

  return { ...safeOrder, items };
}

// =====================================================
// PAYMENT CONFIG (NON-SECRET DISPLAY DATA ONLY)
// =====================================================
// Secret merchant credentials never leave the backend. Only the
// display identifiers needed by the UPI / bank-transfer checkout
// flow are returned. Configure via backend environment variables:
//   PAYMENT_MODE, PAYMENT_UPI_ID, PAYMENT_BANK_NAME,
//   PAYMENT_BANK_ACCOUNT_NAME, PAYMENT_BANK_ACCOUNT_NUMBER,
//   PAYMENT_BANK_IFSC

businessRouter.get("/api/payment/config", (req, res) => {
  // Admin-saved payment settings (DB) take priority; the legacy env
  // vars (PAYMENT_MODE, …) remain the fallback until an admin saves —
  // the response shape and buyer behaviour are identical to before.
  res.json(buildPaymentConfig());
});

// =====================================================
// SELLER REGISTRATION
// =====================================================

businessRouter.post(
  "/api/sellers/register",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const name = clean(req.body.name || req.body.sellerName);
      const shopName = clean(req.body.shopName);
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const password = String(req.body.password || "");

      const panInput = cleanTaxText(req.body.panNumber || req.body.pan, 10).toUpperCase();
      const gstinInput = cleanTaxText(req.body.gstin || req.body.gstNumber, 15).toUpperCase();
      const address = cleanTaxText(req.body.address, 400);
      const city = cleanTaxText(req.body.city, 100);
      const state = cleanTaxText(req.body.state, 100);
      const pincode = cleanTaxText(req.body.pincode, 6);
      const businessType = ["goods", "services"].includes(clean(req.body.businessType))
        ? clean(req.body.businessType)
        : "goods";
      const enrolmentNumber = cleanTaxText(req.body.enrolmentNumber, 40).toUpperCase();
      const turnoverBelowThreshold =
        req.body.turnoverBelowThreshold === true ||
        req.body.turnoverBelowThreshold === "true" ||
        req.body.turnoverBelowThreshold === 1 ||
        req.body.turnoverBelowThreshold === "1";

      // PAN is mandatory for new sellers in production and in the Seller
      // UI. The legacy API fallback (no PAN → taxProfileConfigured = 0)
      // exists only for old test clients and grandfathered records; set
      // JB_REQUIRE_SELLER_PAN=1 to force it in any environment.
      const panRequired =
        process.env.NODE_ENV === "production" || process.env.JB_REQUIRE_SELLER_PAN === "1";

      if (!panInput && panRequired) {
        return res.status(400).json({
          success: false,
          code: "PAN_REQUIRED",
          message: "PAN number is required for seller registration.",
        });
      }

      let pan = "";
      if (panInput) {
        const checkedPan = validatePan(panInput);
        if (!checkedPan.ok) {
          return res.status(400).json({ success: false, code: "INVALID_PAN", message: checkedPan.message });
        }
        pan = checkedPan.value;
      }

      let gstin = "";
      if (gstinInput) {
        if (!pan) {
          return res.status(400).json({
            success: false,
            code: "PAN_REQUIRED_FOR_GSTIN",
            message: "PAN is required before adding a GSTIN.",
          });
        }
        const checkedGstin = validateGstin(gstinInput);
        if (!checkedGstin.ok) {
          return res.status(400).json({ success: false, code: "INVALID_GSTIN", message: checkedGstin.message });
        }
        gstin = checkedGstin.value;
      }

      if (pan && !address) {
        return res.status(400).json({
          success: false,
          code: "ADDRESS_REQUIRED",
          message: "Business address is required for PAN-based registration.",
        });
      }
      if (pan && !state) {
        return res.status(400).json({
          success: false,
          code: "STATE_REQUIRED",
          message: "Business State is required for PAN-based registration.",
        });
      }
      if (pincode && !/^\d{6}$/.test(pincode)) {
        return res.status(400).json({ success: false, message: "PIN code must be exactly 6 digits." });
      }

      if (!name) {
        return res.status(400).json({ success: false, message: "Seller name is required." });
      }

      if (!shopName) {
        return res.status(400).json({ success: false, message: "Shop / business name is required." });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required." });
      }

      if (!email || !email.includes("@")) {
        return res.status(400).json({ success: false, message: "A valid email address is required." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }

      const existingMobile = db
        .prepare(`SELECT id FROM sellers WHERE mobile = ?`)
        .get(mobile);

      if (existingMobile) {
        return res.status(409).json({ success: false, message: "This mobile number is already registered." });
      }

      const existingEmail = db
        .prepare(`SELECT id FROM sellers WHERE LOWER(email) = ?`)
        .get(email);

      if (existingEmail) {
        return res.status(409).json({ success: false, message: "This email is already registered." });
      }

      const passwordHash = await hashPassword(password);

      const sellerCode = `SELLER-${Date.now()}`;

      const result = db.prepare(`
        INSERT INTO sellers (sellerCode, name, shopName, mobile, email, passwordHash, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(sellerCode, name, shopName, mobile, email, passwordHash, now());

      // Seed KYC + tax profile with registration data. NOTHING is
      // auto-verified: PAN starts Pending, and a GSTIN starts GST
      // Verification Pending. Only an admin can change those statuses.
      const taxProfileConfigured = pan ? 1 : 0;
      const gstStatus = gstin
        ? GST_STATUS.PENDING
        : GST_STATUS.UNREGISTERED;

      db.prepare(`
        INSERT INTO seller_kyc (
          sellerId, shopName, address, city, state, pincode, gstNumber, panNumber,
          kycStatus, updatedAt, panStatus, gstStatus, businessType, enrolmentNumber,
          enrolmentStatus, turnoverBelowThreshold, taxProfileConfigured, gstSubmittedAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        result.lastInsertRowid,
        shopName,
        address || null,
        city || null,
        state || null,
        pincode || null,
        gstin || null,
        pan || null,
        now(),
        PAN_STATUS.PENDING,
        gstStatus,
        businessType,
        enrolmentNumber || null,
        enrolmentNumber ? ENROLMENT_STATUS.PENDING : ENROLMENT_STATUS.NOT_PROVIDED,
        turnoverBelowThreshold ? 1 : 0,
        taxProfileConfigured,
        gstin ? now() : null
      );

      const seller = db
        .prepare(`SELECT * FROM sellers WHERE id = ?`)
        .get(result.lastInsertRowid);

      const profile = getSellerTaxProfile(seller.id);

      writeSellerAudit({
        sellerId: seller.id,
        action: "seller_registered",
        actorType: "seller",
        actorId: String(seller.id),
        before: null,
        after: {
          pan: maskTaxId(pan),
          gstin: maskTaxId(gstin),
          gstStatus,
          panStatus: pan ? PAN_STATUS.PENDING : null,
          businessType,
          state,
        },
        note: "Seller registration",
      });

      res.status(201).json({
        success: true,
        message: "Seller account created. Please login.",
        seller: {
          ...publicSeller(seller),
          kycStatus: "Pending",
          taxProfile: profile
            ? publicSellerTaxProfile(profile.row, profile.eligibility)
            : null,
        },
      });
    } catch (error) {
      console.error("SELLER REGISTER ERROR:", error);
      res.status(500).json({ success: false, message: "Seller registration failed." });
    }
  }
);

// =====================================================
// SELLER LOGIN
// =====================================================

businessRouter.post(
  "/api/sellers/login",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const loginId = clean(req.body.loginId || req.body.mobile || req.body.email);
      const password = String(req.body.password || "");

      if (!loginId || !password) {
        return res.status(400).json({ success: false, message: "Mobile/email and password are required." });
      }

      const seller = db
        .prepare(
          `SELECT * FROM sellers WHERE mobile = ? OR LOWER(email) = LOWER(?)`
        )
        .get(loginId, loginId);

      if (!seller || !(await comparePassword(password, seller.passwordHash))) {
        return res.status(401).json({ success: false, message: "Invalid credentials." });
      }

      if (seller.status !== "active") {
        return res.status(403).json({ success: false, message: "This seller account is suspended." });
      }

      db.prepare(`UPDATE sellers SET lastLoginAt = ? WHERE id = ?`).run(
        now(),
        seller.id
      );

      const token = createToken({
        type: "seller",
        sellerId: seller.id,
        sellerCode: seller.sellerCode,
        name: seller.name,
      });

      const profile = getSellerTaxProfile(seller.id);

      res.json({
        success: true,
        message: "Login successful.",
        token,
        seller: {
          ...publicSeller(seller),
          kycStatus: profile?.row?.kycStatus || "Pending",
          taxProfile: profile
            ? publicSellerTaxProfile(profile.row, profile.eligibility)
            : null,
        },
      });
    } catch (error) {
      console.error("SELLER LOGIN ERROR:", error);
      res.status(500).json({ success: false, message: "Seller login failed." });
    }
  }
);

// =====================================================
// SELLER PROFILE
// =====================================================

businessRouter.get(
  "/api/sellers/me",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const profile = getSellerTaxProfile(seller.id);

    res.json({
      success: true,
      seller: {
        ...publicSeller(seller),
        kycStatus: profile?.row?.kycStatus || "Pending",
        taxProfile: profile
          ? publicSellerTaxProfile(profile.row, profile.eligibility)
          : null,
      },
    });
  }
);

// =====================================================
// SELLER KYC
// =====================================================

businessRouter.get(
  "/api/sellers/kyc",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const kyc = db
      .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
      .get(req.user.sellerId);

    res.json({ success: true, kyc: kyc || { kycStatus: "Pending" } });
  }
);

businessRouter.put(
  "/api/sellers/kyc",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const existing = db
        .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
        .get(req.user.sellerId);

      const fields = {
        shopName: cleanTaxText(req.body.shopName, 200),
        address: cleanTaxText(req.body.address, 400),
        city: cleanTaxText(req.body.city, 100),
        state: cleanTaxText(req.body.state, 100),
        pincode: cleanTaxText(req.body.pincode, 6),
        aadhaarNumber: cleanTaxText(req.body.aadhaarNumber, 20),
      };

      // A seller may correct PAN here, but it can never become Verified
      // through this route: any change resets it to Pending Verification
      // and needs a fresh admin review. GSTIN changes use the dedicated
      // /api/sellers/gst submission route.
      let pan = cleanTaxText(existing?.panNumber, 10).toUpperCase();
      let panChanged = false;
      const panInput = cleanTaxText(req.body.panNumber || req.body.pan, 10).toUpperCase();
      if (panInput) {
        const checked = validatePan(panInput);
        if (!checked.ok) {
          return res.status(400).json({ success: false, code: "INVALID_PAN", message: checked.message });
        }
        if (checked.value !== pan) {
          pan = checked.value;
          panChanged = true;
        }
      }

      const businessType = ["goods", "services"].includes(clean(req.body.businessType))
        ? clean(req.body.businessType)
        : existing?.businessType || "goods";

      if (fields.pincode && !/^\d{6}$/.test(fields.pincode)) {
        return res.status(400).json({ success: false, message: "PIN code must be exactly 6 digits." });
      }

      // Sellers can update their KYC details, but approval is admin-only.
      // Any material change (PAN/address/State) sends an approved KYC back
      // to Pending instead of silently keeping the old approval.
      const materialChange =
        panChanged ||
        Boolean(fields.address && fields.address !== (existing?.address || "")) ||
        Boolean(fields.state && fields.state !== (existing?.state || "")) ||
        (businessType !== (existing?.businessType || "goods"));
      const kycStatus = existing
        ? materialChange && existing.kycStatus === "Approved"
          ? "Pending"
          : existing.kycStatus
        : "Pending";

      const beforeProfile = existing
        ? publicSellerTaxProfile(
            { ...existing, sellerId: req.user.sellerId },
            computeSellerTaxEligibility(existing)
          )
        : null;

      if (existing) {
        db.prepare(`
          UPDATE seller_kyc
          SET shopName = ?, address = ?, city = ?, state = ?, pincode = ?,
              panNumber = ?, aadhaarNumber = ?, businessType = ?, kycStatus = ?,
              panStatus = ?, panVerifiedAt = ?, panVerifiedBy = ?,
              panRejectionReason = ?, taxProfileConfigured = ?, updatedAt = ?
          WHERE sellerId = ?
        `).run(
          fields.shopName || existing.shopName,
          fields.address || existing.address,
          fields.city || existing.city,
          fields.state || existing.state,
          fields.pincode || existing.pincode,
          pan || null,
          fields.aadhaarNumber || existing.aadhaarNumber,
          businessType,
          kycStatus,
          panChanged ? PAN_STATUS.PENDING : existing.panStatus || PAN_STATUS.PENDING,
          panChanged ? null : existing.panVerifiedAt || null,
          panChanged ? null : existing.panVerifiedBy || null,
          panChanged ? null : existing.panRejectionReason || null,
          pan ? 1 : Number(existing.taxProfileConfigured) || 0,
          now(),
          req.user.sellerId
        );
      } else {
        db.prepare(`
          INSERT INTO seller_kyc (
            sellerId, shopName, address, city, state, pincode,
            panNumber, aadhaarNumber, businessType, kycStatus, updatedAt,
            panStatus, gstStatus, taxProfileConfigured
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?)
        `).run(
          req.user.sellerId,
          fields.shopName,
          fields.address,
          fields.city,
          fields.state,
          fields.pincode,
          pan || null,
          fields.aadhaarNumber,
          businessType,
          now(),
          PAN_STATUS.PENDING,
          GST_STATUS.UNREGISTERED,
          pan ? 1 : 0
        );
      }

      const profile = getSellerTaxProfile(req.user.sellerId);
      const afterProfile = publicSellerTaxProfile(profile.row, profile.eligibility);

      writeSellerAudit({
        sellerId: req.user.sellerId,
        action: "kyc_updated",
        actorType: "seller",
        actorId: String(req.user.sellerId),
        before: beforeProfile,
        after: afterProfile,
        note: materialChange ? "KYC details changed; approval reset to Pending where applicable." : "KYC details updated.",
      });

      res.json({
        success: true,
        message: materialChange
          ? "KYC details saved. Material changes need admin approval again."
          : "KYC details saved. Approval pending with admin.",
        kyc: db
          .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
          .get(req.user.sellerId),
        taxProfile: afterProfile,
      });
    } catch (error) {
      console.error("SELLER KYC ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save KYC details." });
    }
  }
);

// =====================================================
// SELLER TAX PROFILE (PAN / GST)
// =====================================================
businessRouter.get(
  "/api/sellers/tax-profile",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const profile = getSellerTaxProfile(req.user.sellerId);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }
    res.json({
      success: true,
      taxProfile: publicSellerTaxProfile(profile.row, profile.eligibility),
      kycStatus: profile.row.kycStatus || "Pending",
    });
  }
);

// GST registration is optional at signup. A seller adds/submits a GSTIN
// later here; it stays Pending until an admin verifies it.
businessRouter.post(
  "/api/sellers/gst",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const profile = getSellerTaxProfile(req.user.sellerId);
      if (!profile) {
        return res.status(404).json({ success: false, message: "Seller not found." });
      }

      const row = profile.row;
      if (!cleanTaxText(row.panNumber)) {
        return res.status(400).json({
          success: false,
          code: "PAN_REQUIRED",
          message: "Add and verify PAN before submitting GSTIN.",
        });
      }
      if ((row.panStatus || PAN_STATUS.PENDING) === PAN_STATUS.REJECTED) {
        return res.status(403).json({
          success: false,
          code: "PAN_REJECTED",
          message: "PAN was rejected. Correct PAN before adding GSTIN.",
        });
      }

      const checked = validateGstin(req.body.gstin || req.body.gstNumber);
      if (!checked.ok) {
        return res.status(400).json({ success: false, code: "INVALID_GSTIN", message: checked.message });
      }

      const before = publicSellerTaxProfile(row, profile.eligibility);
      const gstin = checked.value;

      db.prepare(`
        UPDATE seller_kyc
        SET gstNumber = ?, gstStatus = ?, gstSubmittedAt = ?, gstApprovedAt = NULL,
            gstApprovedBy = NULL, gstRejectionReason = NULL, taxProfileConfigured = 1,
            updatedAt = ?
        WHERE sellerId = ?
      `).run(gstin, GST_STATUS.PENDING, now(), now(), req.user.sellerId);

      // GSTIN is unverified: take approved products offline until admin
      // approval + product re-approval. Existing orders/invoices remain
      // untouched.
      db.prepare(`UPDATE products SET status = 'Pending' WHERE sellerId = ? AND status = 'Approved'`).run(
        row.sellerCode
      );

      const next = getSellerTaxProfile(req.user.sellerId);
      const after = publicSellerTaxProfile(next.row, next.eligibility);

      writeSellerAudit({
        sellerId: req.user.sellerId,
        action: "gst_submitted",
        actorType: "seller",
        actorId: String(req.user.sellerId),
        before,
        after,
        note: "GSTIN submitted for admin verification.",
      });

      res.json({
        success: true,
        message: "GSTIN submitted. Admin verification is pending — GST will not be charged until approved.",
        taxProfile: after,
      });
    } catch (error) {
      console.error("SELLER GST SUBMIT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to submit GSTIN." });
    }
  }
);

businessRouter.get(
  "/api/sellers/tax-eligibility",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const profile = getSellerTaxProfile(req.user.sellerId);
    if (!profile) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }
    res.json({
      success: true,
      kycStatus: profile.row.kycStatus || "Pending",
      taxProfile: publicSellerTaxProfile(profile.row, profile.eligibility),
    });
  }
);

// =====================================================
// SELLER BANK DETAILS
// =====================================================

businessRouter.get(
  "/api/sellers/bank",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const bank = db
      .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
      .get(req.user.sellerId);

    res.json({ success: true, bank: bank || null });
  }
);

businessRouter.put(
  "/api/sellers/bank",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const existing = db
        .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
        .get(req.user.sellerId);

      const accountNumber = clean(req.body.accountNumber);

      if (accountNumber && !/^\d{6,20}$/.test(accountNumber)) {
        return res.status(400).json({ success: false, message: "Account number must be 6-20 digits." });
      }

      const fields = {
        accountName: clean(req.body.accountName),
        accountNumber,
        ifscCode: clean(req.body.ifscCode).toUpperCase(),
        bankName: clean(req.body.bankName),
        upiId: clean(req.body.upiId),
      };

      if (existing) {
        db.prepare(`
          UPDATE seller_bank
          SET accountName = ?, accountNumber = ?, ifscCode = ?, bankName = ?, upiId = ?, updatedAt = ?
          WHERE sellerId = ?
        `).run(
          fields.accountName || existing.accountName,
          fields.accountNumber || existing.accountNumber,
          fields.ifscCode || existing.ifscCode,
          fields.bankName || existing.bankName,
          fields.upiId || existing.upiId,
          now(),
          req.user.sellerId
        );
      } else {
        db.prepare(`
          INSERT INTO seller_bank (sellerId, accountName, accountNumber, ifscCode, bankName, upiId, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?)
        `).run(
          req.user.sellerId,
          fields.accountName,
          fields.accountNumber,
          fields.ifscCode,
          fields.bankName,
          fields.upiId,
          now()
        );
      }

      const bank = db
        .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
        .get(req.user.sellerId);

      res.json({ success: true, message: "Bank details saved.", bank });
    } catch (error) {
      console.error("SELLER BANK ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save bank details." });
    }
  }
);

// =====================================================
// SELLER PRODUCTS (AUTHENTICATED)
// =====================================================

function sellerOwnsProduct(sellerId, productId) {
  const product = db
    .prepare(`SELECT * FROM products WHERE id = ?`)
    .get(productId);

  if (!product) return { product: null };

  // Ownership: backend seller id/code, or legacy name matching.
  const seller = db
    .prepare(`SELECT * FROM sellers WHERE id = ?`)
    .get(sellerId);

  const ownsById =
    product.sellerId &&
    (String(product.sellerId) === String(seller?.sellerCode) ||
      String(product.sellerId) === String(sellerId));

  const ownsByName =
    seller &&
    product.sellerName &&
    String(product.sellerName).toLowerCase().trim() ===
      String(seller.name).toLowerCase().trim();

  return { product, owns: Boolean(ownsById || ownsByName) };
}

businessRouter.get(
  "/api/sellers/products",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    const byId = db
      .prepare(`SELECT * FROM products WHERE sellerId = ? ORDER BY id DESC`)
      .all(seller.sellerCode);

    const byLegacyId = db
      .prepare(`SELECT * FROM products WHERE sellerId = ? ORDER BY id DESC`)
      .all(String(seller.id));

    const byName = db
      .prepare(
        `SELECT * FROM products WHERE LOWER(sellerName) = LOWER(?) ORDER BY id DESC`
      )
      .all(seller.name);

    const merged = new Map();

    [...byId, ...byLegacyId, ...byName].forEach((product) =>
      merged.set(String(product.id), product)
    );

    // Additive multi-image support: each product carries its ordered
    // `images` array (first entry = primary). Legacy `image` column
    // stays untouched and keeps working as before.
    res.json({
      success: true,
      products: Array.from(merged.values()).map((product) =>
        withProductImages(stripSupplierCost(product))
      ),
    });
  }
);

businessRouter.get(
  "/api/sellers/pricing-rules",
  requireAuth,
  requireType("seller"),
  (req, res) => res.json({ success: true, rules: getPricingRules() })
);

// Seller-facing GST suggestion: category + optional subcategory/HSN →
// the admin-approved mapping (or an explicit "needs review" answer).
// Never invents a rate.
businessRouter.get(
  "/api/sellers/gst-suggestions",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const category = clean(req.query.category);
      const subCategory = clean(req.query.subCategory);
      const hsnCode = clean(req.query.hsnCode).replace(/\s+/g, "");
      const found = findApprovedMapping({ category, subCategory, hsnCode });
      const mapping = found.mapping;

      res.json({
        success: true,
        suggestion: mapping
          ? {
              category: mapping.category,
              subcategory: mapping.subcategory,
              hsnCode: mapping.hsnCode,
              gstRate: mapping.gstRate,
              gstType: mapping.gstType,
              level: found.level,
              effectiveFrom: mapping.effectiveFrom,
            }
          : null,
        requiresReview: !mapping || Boolean(found.hsnMismatch),
        reason: found.hsnMismatch
          ? "This HSN does not match the approved category mapping — admin review required."
          : mapping
          ? "Admin-approved GST mapping."
          : "No approved GST mapping for this category/HSN — admin review required.",
        validGstSlabs: GST_RATE_SLABS,
      });
    } catch (error) {
      console.error("Seller GST suggestion error:", error);
      res.status(500).json({ success: false, message: "Failed to load GST suggestions." });
    }
  }
);

businessRouter.post(
  "/api/sellers/products",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const seller = db
        .prepare(`SELECT * FROM sellers WHERE id = ?`)
        .get(req.user.sellerId);
      const kyc = db.prepare(`SELECT kycStatus FROM seller_kyc WHERE sellerId = ?`).get(seller.id);

      if (!kyc || kyc.kycStatus !== "Approved") {
        return res.status(403).json({
          success: false,
          code: "KYC_REQUIRED",
          message: "Seller KYC approval is required before submitting products.",
          kycStatus: kyc?.kycStatus || "Pending",
        });
      }

      // GST is mandatory before a product can even be submitted. This is
      // stricter than the old pending-product flow: KYC alone is not enough.
      const sellerTax = getSellerTaxProfile(seller.id);
      if (!sellerTax || !sellerTax.eligibility.canSell) {
        return res.status(403).json({
          success: false,
          code: "SELLER_GST_REQUIRED",
          message:
            "PAN verification and Admin GSTIN approval are required before listing products.",
          blockers: sellerTax?.eligibility.blockers || [
            "Seller KYC, PAN and GSTIN approval are required.",
          ],
          taxProfile: sellerTax
            ? publicSellerTaxProfile(sellerTax.row, sellerTax.eligibility)
            : null,
        });
      }

      const name = clean(req.body.name);
      const category = clean(req.body.category);
      const subCategory = clean(req.body.subCategory ?? req.body.subcategory).slice(0, 100);
      const price = clean(req.body.price);
      const sku = clean(req.body.sku).slice(0, 64);
      const hsnCode = clean(req.body.hsnCode);
      const explicitGstRate = Math.max(0, Number(req.body.gstRate) || 0);

      if (!name || !category) return res.status(400).json({ success: false, message: "Product name and category are required." });
      if (!price || Number(String(price).replace(/[^0-9.]/g, "")) <= 0) return res.status(400).json({ success: false, message: "A valid price is required." });

      // SKU is optional, but when given it must be unique for THIS
      // seller (case-insensitive). Same rule the bulk importer and
      // supplier sync apply, so duplicates cannot slip in any path.
      if (sku) {
        const existingSku = db
          .prepare(
            `SELECT id FROM products
             WHERE (sellerId = ? OR sellerId = ?)
               AND LOWER(COALESCE(sku, '')) = ?
             LIMIT 1`
          )
          .get(seller.sellerCode, String(seller.id), sku.toLowerCase());

        if (existingSku) {
          return res.status(409).json({
            success: false,
            code: "DUPLICATE_SKU",
            message: `SKU \"${sku}\" already exists in your catalog.`,
          });
        }
      }

      // GST resolution: explicit product rate (if it is a valid slab)
      // → admin category default → none + review flag. Rates are never
      // guessed for an unclear classification.
      // A seller-entered rate is a PROPOSAL: it stays unapproved
      // (gstApproved = 0) and never overrides an approved mapping.
      const gst = resolveSellerProductTax(seller.id, {
        category,
        subCategory,
        gstRate: explicitGstRate,
        hsnCode,
        gstSource: explicitGstRate > 0 ? "product" : null,
        gstApproved: 0,
      });

      const pricing = calculateCustomerPricing(price, gst.gstRate, gst.priceIncludesGst);

      // Multi-image (1–6): images[0] is the primary/main image. The
      // legacy `image` column is kept in sync (image = images[0]).
      const images = resolveProductImages(null, req.body.images ?? req.body.image ?? "");
      const imageError = validateProductImages(images);
      if (imageError) {
        return res.status(400).json({ success: false, message: imageError });
      }

      // LIMITED STOCK TRACKING: optional seller-entered quantity.
      // Omitted/blank → NULL (untracked = unlimited, today's behaviour).
      // Negative / fractional / non-numeric values are rejected.
      const stockInput = validateStockInput(req.body.stock);
      if (!stockInput.ok) {
        return res.status(400).json({ success: false, message: stockInput.message });
      }
      const stock = stockInput.unset ? null : stockInput.stock;

      const result = db.prepare(`
        INSERT INTO products (
          sellerId, sellerName, sku, name, category, subCategory, price, comparePrice,
          image, images, description, shortDetails, status, createdAt,
          hsnCode, gstRate, gstSource, gstApproved, deliveryCharge, platformCharge, mlmCommission,
          customerPrice, pricingUpdatedAt, stock,
          taxTreatment, gstInvoiceAllowed, sellerTaxSnapshot, taxTreatmentReason
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Pending', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        seller.sellerCode,
        seller.name,
        sku || null,
        name,
        category,
        subCategory,
        price,
        clean(req.body.comparePrice),
        images[0],
        JSON.stringify(images),
        clean(req.body.description),
        clean(req.body.shortDetails),
        now(),
        hsnCode, gst.gstRate, gst.source, 0, pricing.deliveryCharge, pricing.platformCharge,
        pricing.mlmCommission, pricing.customerPrice, now(), stock,
        gst.taxTreatment ?? null, gst.gstInvoiceAllowed ?? 1,
        gst.sellerTaxSnapshot ?? null, gst.taxTreatmentReason ?? null
      );

      const product = withProductImages(
        db.prepare(`SELECT * FROM products WHERE id = ?`).get(result.lastInsertRowid)
      );

      res.status(201).json({
        success: true,
        message: "Product submitted for admin approval.",
        pricing,
        product,
      });
    } catch (error) {
      console.error("SELLER ADD PRODUCT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to add product." });
    }
  }
);

businessRouter.put(
  "/api/sellers/products/:id",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const productId = Number(req.params.id);

      const { product, owns } = sellerOwnsProduct(req.user.sellerId, productId);

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      if (!owns) {
        return res.status(403).json({ success: false, message: "You can only edit your own products." });
      }

      const seller = db
        .prepare(`SELECT * FROM sellers WHERE id = ?`)
        .get(req.user.sellerId);

      const name = req.body.name !== undefined ? clean(req.body.name) : product.name;
      const category = req.body.category !== undefined ? clean(req.body.category) : product.category;
      const subCategory =
        req.body.subCategory !== undefined || req.body.subcategory !== undefined
          ? clean(req.body.subCategory ?? req.body.subcategory).slice(0, 100)
          : clean(product.subCategory);
      const price = req.body.price !== undefined ? clean(req.body.price) : product.price;
      const sku = req.body.sku !== undefined ? clean(req.body.sku).slice(0, 64) : (product.sku || "");
      const comparePrice = req.body.comparePrice !== undefined ? clean(req.body.comparePrice) : product.comparePrice;
      const description = req.body.description !== undefined ? clean(req.body.description) : product.description;
      const shortDetails = req.body.shortDetails !== undefined ? clean(req.body.shortDetails) : product.shortDetails;
      const hsnCode = req.body.hsnCode !== undefined ? clean(req.body.hsnCode) : (product.hsnCode || "");
      // Preserve the seller's intent across edits: an explicit
      // product-level rate survives; an inherited (category) rate keeps
      // inheriting from the admin-configured default.
      const explicitGstRate =
        req.body.gstRate !== undefined
          ? Math.max(0, Number(req.body.gstRate) || 0)
          : product.gstSource === "product"
          ? Number(product.gstRate || 0)
          : 0;

      if (!name) {
        return res.status(400).json({ success: false, message: "Product name is required." });
      }

      // SKU change must not collide with another product of this seller.
      if (sku) {
        const duplicateSku = db
          .prepare(
            `SELECT id FROM products
             WHERE (sellerId = ? OR sellerId = ?)
               AND LOWER(COALESCE(sku, '')) = ?
               AND id != ?
             LIMIT 1`
          )
          .get(String(seller?.sellerCode ?? ""), String(req.user.sellerId), sku.toLowerCase(), productId);
        if (duplicateSku) {
          return res.status(409).json({
            success: false,
            code: "DUPLICATE_SKU",
            message: `SKU \"${sku}\" already exists in your catalog.`,
          });
        }
      }

      // Multi-image edit: existing images arrive in `images`; when only
      // the legacy `image` field is sent it replaces the primary image.
      // Omitted image fields mean "keep the existing gallery". Only an
      // explicit images/image value replaces it — otherwise any unrelated
      // edit would silently collapse a multi-image product to one image.
      const incomingImages = req.body.images ?? req.body.image;
      const existingImages = parseProductImages(product.images);
      const images =
        incomingImages === undefined
          ? existingImages.length > 0
            ? existingImages
            : [String(product.image || "").trim()].filter(Boolean)
          : resolveProductImages(product, incomingImages);
      const imageError = validateProductImages(images);
      if (imageError) {
        return res.status(400).json({ success: false, message: imageError });
      }

      // Any seller edit resets the classification approval: the product
      // goes back to Pending and its rate must be re-approved by an
      // admin before it can regain an override.
      const gst = resolveSellerProductTax(seller.id, {
        category,
        subCategory,
        gstRate: explicitGstRate,
        hsnCode,
        gstSource:
          explicitGstRate > 0
            ? "product"
            : product.gstSource === "product"
            ? "product"
            : null,
        gstApproved: 0,
      });

      // LIMITED STOCK TRACKING: omitted → keep current value; blank →
      // untracked; otherwise validated non-negative integer.
      const stockInput = validateStockInput(req.body.stock);
      if (!stockInput.ok) {
        return res.status(400).json({ success: false, message: stockInput.message });
      }
      const stock = stockInput.unset ? product.stock ?? null : stockInput.stock;

      const pricing = calculateCustomerPricing(price, gst.gstRate, gst.priceIncludesGst);

      // Edited products go back to admin approval and pricing is recalculated.
      db.prepare(`
        UPDATE products
        SET name = ?, category = ?, subCategory = ?, price = ?, comparePrice = ?, sku = ?,
            image = ?, images = ?, description = ?, shortDetails = ?, status = 'Pending',
            rejectionReason = NULL,
            hsnCode = ?, gstRate = ?, gstSource = ?, gstApproved = 0,
            deliveryCharge = ?, platformCharge = ?,
            mlmCommission = ?, customerPrice = ?, pricingUpdatedAt = ?, stock = ?,
            taxTreatment = ?, gstInvoiceAllowed = ?, sellerTaxSnapshot = ?, taxTreatmentReason = ?
        WHERE id = ?
      `).run(
        name, category, subCategory, price, comparePrice, sku || null, images[0], JSON.stringify(images),
        description, shortDetails,
        hsnCode, gst.gstRate, gst.source, pricing.deliveryCharge, pricing.platformCharge,
        pricing.mlmCommission, pricing.customerPrice, now(), stock,
        gst.taxTreatment ?? null, gst.gstInvoiceAllowed ?? 1,
        gst.sellerTaxSnapshot ?? null, gst.taxTreatmentReason ?? null,
        productId
      );

      const updated = withProductImages(
        db.prepare(`SELECT * FROM products WHERE id = ?`).get(productId)
      );

      res.json({
        success: true,
        message: "Product updated and resubmitted for admin approval.",
        product: updated,
      });
    } catch (error) {
      console.error("SELLER EDIT PRODUCT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update product." });
    }
  }
);

// Seller deletes own product (ownership enforced).
businessRouter.delete(
  "/api/sellers/products/:id",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const productId = Number(req.params.id);

      const { product, owns } = sellerOwnsProduct(req.user.sellerId, productId);

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      if (!owns) {
        return res.status(403).json({ success: false, message: "You can only delete your own products." });
      }

      db.prepare(`DELETE FROM products WHERE id = ?`).run(productId);

      res.json({ success: true, message: "Product deleted." });
    } catch (error) {
      console.error("SELLER DELETE PRODUCT ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to delete product." });
    }
  }
);

// =====================================================
// SELLER ORDERS (OWN PRODUCTS ONLY)
// =====================================================

businessRouter.get(
  "/api/sellers/orders",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    // Orders that contain at least one item of this seller.
    const orders = db.prepare(`
      SELECT DISTINCT orders.*
      FROM orders
      JOIN order_items ON order_items.orderId = orders.id
      WHERE order_items.sellerId = ? OR order_items.sellerId = ?
      ORDER BY orders.id DESC
    `).all(seller.sellerCode, String(seller.id));

    // Additive delivery visibility: seller sees delivery status and the
    // partner name (no contact data) for their own orders only.
    const partnerNames = new Map(
      db.prepare(`SELECT id, name FROM delivery_partners`).all().map((p) => [p.id, p.name])
    );

    res.json({
      success: true,
      orders: orders.map((order) => ({
        ...orderWithItems(order),
        deliveryStatus: order.deliveryStatus || null,
        deliveryPartnerName: order.deliveryPartnerId
          ? partnerNames.get(order.deliveryPartnerId) || null
          : null,
        deliveryFailureReason: order.deliveryFailureReason || null,
        pickedUpAt: order.pickedUpAt || null,
        outForDeliveryAt: order.outForDeliveryAt || null,
        returnedToSellerAt: order.returnedToSellerAt || null,
      })),
    });
  }
);

// Seller sees only their own immutable invoice snapshots. This is how
// pre-GST vs post-GST sales stay distinguishable after an upgrade.
businessRouter.get(
  "/api/sellers/orders/:id/invoices",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(req.user.sellerId);
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(Number(req.params.id));
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const ownsOrderItem = db
      .prepare(`SELECT 1 FROM order_items WHERE orderId = ? AND (sellerId = ? OR sellerId = ?) LIMIT 1`)
      .get(order.id, seller.sellerCode, String(seller.id));
    if (!ownsOrderItem) {
      return res.status(403).json({ success: false, message: "This order does not contain your products." });
    }

    const invoices = db
      .prepare(`SELECT * FROM order_invoices WHERE orderId = ? AND (sellerId = ? OR sellerId = ?) ORDER BY id`)
      .all(order.id, seller.sellerCode, String(seller.id))
      .map((invoice) => ({
        ...invoice,
        snapshot: invoice.snapshotJson ? JSON.parse(invoice.snapshotJson) : null,
      }));

    res.json({ success: true, orderNumber: order.orderNumber, invoices });
  }
);

// =====================================================
// SELLER DASHBOARD SUMMARY (READ-ONLY)
// =====================================================
// Counts and totals for the seller home page. Computed from the
// seller's own products and order items only — no cross-seller data.

businessRouter.get(
  "/api/sellers/summary",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(req.user.sellerId);

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const productCounts = db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'Approved' THEN 1 ELSE 0 END), 0) AS approved,
          COALESCE(SUM(CASE WHEN status = 'Pending' THEN 1 ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'Rejected' THEN 1 ELSE 0 END), 0) AS rejected
        FROM products
        WHERE sellerId = ? OR sellerId = ?
      `)
      .get(seller.sellerCode, String(seller.id));

    const kyc = db
      .prepare(`SELECT kycStatus FROM seller_kyc WHERE sellerId = ?`)
      .get(seller.id);

    const orderStats = db
      .prepare(`
        SELECT
          COUNT(DISTINCT orders.id) AS orders,
          COALESCE(SUM(CASE WHEN orders.status != 'Cancelled'
            THEN order_items.price * order_items.quantity ELSE 0 END), 0) AS sales
        FROM orders
        JOIN order_items ON order_items.orderId = orders.id
        WHERE order_items.sellerId = ? OR order_items.sellerId = ?
      `)
      .get(seller.sellerCode, String(seller.id));

    res.json({
      success: true,
      summary: {
        totalProducts: productCounts?.total || 0,
        approvedProducts: productCounts?.approved || 0,
        pendingProducts: productCounts?.pending || 0,
        rejectedProducts: productCounts?.rejected || 0,
        orders: orderStats?.orders || 0,
        sales: Number(orderStats?.sales) || 0,
        kycStatus: kyc?.kycStatus || "Pending",
      },
    });
  }
);

// Seller updates fulfilment status of orders containing their products.
businessRouter.put(
  "/api/sellers/orders/:id/status",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const newStatus = clean(req.body.status);

      const allowed = ["Processing", "Ready for Pickup", "Shipped", "Delivered", "Cancelled"];

      if (!allowed.includes(newStatus)) {
        return res.status(400).json({ success: false, message: "Invalid order status." });
      }

      const seller = db
        .prepare(`SELECT * FROM sellers WHERE id = ?`)
        .get(req.user.sellerId);

      const order = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      const ownItem = db
        .prepare(`
          SELECT id FROM order_items
          WHERE orderId = ? AND (sellerId = ? OR sellerId = ?)
          LIMIT 1
        `)
        .get(orderId, seller.sellerCode, String(seller.id));

      if (!ownItem) {
        return res.status(403).json({ success: false, message: "This order does not contain your products." });
      }

      // Delivery lifecycle coordination (additive): when a delivery partner
      // is assigned, the final delivery milestone belongs to the delivery
      // flow — the seller cannot pre-mark Delivered. Orders WITHOUT any
      // delivery assignment keep the existing behaviour unchanged.
      if (
        newStatus === "Delivered" &&
        order.deliveryStatus &&
        order.deliveryStatus !== "Delivered"
      ) {
        return res.status(409).json({
          success: false,
          code: "DELIVERY_IN_PROGRESS",
          message: "Delivery partner has not completed delivery yet.",
        });
      }

      applyOrderStatus(orderId, newStatus);

      const updated = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      res.json({
        success: true,
        message: `Order status updated to ${newStatus}.`,
        order: orderWithItems(updated),
      });
    } catch (error) {
      console.error("SELLER ORDER STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update order status." });
    }
  }
);

// =====================================
// ORDER STATUS STATE MACHINE + COMMISSION HOOKS
// =====================================
// applyOrderStatus is exported (additive, zero behaviour change) so the
// delivery module can route partner-driven deliveries through the SAME
// engine — keeping deliveredAt and Family commission behaviour identical
// to every other delivery path.

export function applyOrderStatus(orderId, newStatus) {
  const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

  if (!order) return;

  const updates = {
    status: newStatus,
    updatedAt: now(),
  };

  if (newStatus === "Delivered") {
    updates.deliveredAt = order.deliveredAt || now();
  }

  db.prepare(`
    UPDATE orders
    SET status = ?, updatedAt = ?, deliveredAt = ?
    WHERE id = ?
  `).run(newStatus, updates.updatedAt, updates.deliveredAt || order.deliveredAt, orderId);

  if (newStatus === "Delivered") {
    // SPILLOVER FIRST: confirm shopping eligibility (same delivery
    // trigger) and place the member chronologically when unplaced.
    // This MUST run before commission generation so the buyer's
    // upline chain (parent → grandparent → …) already exists when
    // commissions resolve levels — percentages and rules unchanged.
    confirmShoppingEligibility({ ...order, ...updates });

    generateCommissionsForOrder({
      ...order,
      ...updates,
    });

    // Additive 3×3 layer. It uses its own source-scoped rows and its
    // own one-per-order/member guard; legacy rows above are untouched.
    generateMlm3x3CommissionsForOrder({
      ...order,
      ...updates,
    });
  }

  if (["Cancelled", "Returned", "Refunded"].includes(newStatus)) {
    // Cancelled / returned orders do not generate commission.
    voidCommissionsForOrder(orderId);
    voidMlm3x3CommissionsForOrder(
      orderId,
      `order ${String(newStatus).toLowerCase()}`,
      "order-status-engine"
    );

    // …and must not count for placement either: revoke the
    // eligibility event + audit the placement (member stays put).
    recordEligibilityRevocation(
      orderId,
      `order ${String(newStatus).toLowerCase()}`
    );
  }
}

// =====================================================
// CUSTOMER REGISTRATION
// =====================================================

businessRouter.post(
  "/api/customers/register",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const name = clean(req.body.name);
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const password = String(req.body.password || "");
      const referralCode = clean(req.body.referralCode);

      if (!name) {
        return res.status(400).json({ success: false, message: "Name is required." });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }

      const existing = db
        .prepare(`SELECT id FROM customers WHERE mobile = ?`)
        .get(mobile);

      if (existing) {
        return res.status(409).json({ success: false, message: "This mobile number is already registered." });
      }

      let referredByMemberId = null;

      if (referralCode) {
        const member = db
          .prepare(
            `SELECT memberId FROM mlm_members WHERE referralCode = ? OR memberId = ?`
          )
          .get(referralCode, referralCode);

        if (!member) {
          return res.status(400).json({ success: false, message: "Invalid referral code." });
        }

        referredByMemberId = member.memberId;
      }

      const passwordHash = await hashPassword(password);

      const result = db.prepare(`
        INSERT INTO customers (name, mobile, email, passwordHash, referredByMemberId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(name, mobile, email || null, passwordHash, referredByMemberId, now());

      const customer = db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(result.lastInsertRowid);

      const token = createToken({
        type: "customer",
        customerId: customer.id,
        name: customer.name,
      });

      res.status(201).json({
        success: true,
        message: "Account created successfully.",
        token,
        customer: publicCustomer(customer),
      });
    } catch (error) {
      console.error("CUSTOMER REGISTER ERROR:", error);
      res.status(500).json({ success: false, message: "Registration failed." });
    }
  }
);

// =====================================================
// CUSTOMER LOGIN
// =====================================================

businessRouter.post(
  "/api/customers/login",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const mobile = clean(req.body.mobile);
      const password = String(req.body.password || "");

      if (!mobile || !password) {
        return res.status(400).json({ success: false, message: "Mobile and password are required." });
      }

      const customer = db
        .prepare(`SELECT * FROM customers WHERE mobile = ?`)
        .get(mobile);

      if (
        !customer ||
        !(await comparePassword(password, customer.passwordHash))
      ) {
        return res.status(401).json({ success: false, message: "Invalid mobile number or password." });
      }

      if (customer.status !== "active") {
        return res.status(403).json({ success: false, message: "This account is blocked." });
      }

      db.prepare(`UPDATE customers SET lastLoginAt = ? WHERE id = ?`).run(
        now(),
        customer.id
      );

      const token = createToken({
        type: "customer",
        customerId: customer.id,
        name: customer.name,
      });

      res.json({
        success: true,
        message: "Login successful.",
        token,
        customer: publicCustomer(customer),
      });
    } catch (error) {
      console.error("CUSTOMER LOGIN ERROR:", error);
      res.status(500).json({ success: false, message: "Login failed." });
    }
  }
);

// =====================================================
// CUSTOMER PROFILE
// =====================================================

businessRouter.get(
  "/api/customers/me",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    const customer = db
      .prepare(`SELECT * FROM customers WHERE id = ?`)
      .get(req.user.customerId);

    if (!customer) {
      return res.status(404).json({ success: false, message: "Customer not found." });
    }

    res.json({ success: true, customer: publicCustomer(customer) });
  }
);

// Customer updates their own profile (name / email / default address).
// Mobile and password are intentionally NOT editable here — mobile is
// the login identity and password changes deserve a dedicated flow.
businessRouter.put(
  "/api/customers/me",
  requireAuth,
  requireType("customer"),
  async (req, res) => {
    try {
      const customer = db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(req.user.customerId);

      if (!customer) {
        return res.status(404).json({ success: false, message: "Customer not found." });
      }

      const fields = {
        name: clean(req.body.name),
        email: clean(req.body.email).toLowerCase(),
        address: clean(req.body.address),
        city: clean(req.body.city),
        state: clean(req.body.state),
        pincode: clean(req.body.pincode),
      };

      if (fields.name !== undefined && !fields.name) {
        return res.status(400).json({ success: false, message: "Name cannot be empty." });
      }

      if (fields.email && !fields.email.includes("@")) {
        return res.status(400).json({ success: false, message: "A valid email address is required." });
      }

      if (fields.pincode && !/^\d{6}$/.test(fields.pincode)) {
        return res.status(400).json({ success: false, message: "PIN code must be exactly 6 digits." });
      }

      const next = {
        name: fields.name || customer.name,
        email: fields.email || customer.email,
        address: fields.address || customer.address,
        city: fields.city || customer.city,
        state: fields.state || customer.state,
        pincode: fields.pincode || customer.pincode,
      };

      db.prepare(`
        UPDATE customers
        SET name = ?, email = ?, address = ?, city = ?, state = ?, pincode = ?
        WHERE id = ?
      `).run(
        next.name,
        next.email,
        next.address,
        next.city,
        next.state,
        next.pincode,
        customer.id
      );

      const updated = db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(customer.id);

      res.json({
        success: true,
        message: "Profile updated.",
        customer: publicCustomer(updated),
      });
    } catch (error) {
      console.error("CUSTOMER PROFILE UPDATE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update profile." });
    }
  }
);

// =====================================================
// PLACE ORDER (CUSTOMER)
// =====================================================
// Prices are always taken from approved backend products —
// never from client input.

businessRouter.post(
  "/api/orders",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const items = Array.isArray(req.body.items) ? req.body.items : [];

      if (items.length === 0) {
        return res.status(400).json({ success: false, message: "Your cart is empty." });
      }

      const customer = db
        .prepare(`SELECT * FROM customers WHERE id = ?`)
        .get(req.user.customerId);

      if (!customer) {
        return res.status(404).json({ success: false, message: "Customer not found." });
      }

      const address = clean(req.body.address);
      const phone = clean(req.body.phone);

      // Optional structured address fields (additive; the full one-line
      // address remains the canonical shipping string).
      const city = clean(req.body.city);
      const state = clean(req.body.state);
      const pincode = clean(req.body.pincode);
      const email = clean(req.body.email).toLowerCase();

      if (!address || address.length < 10) {
        return res.status(400).json({ success: false, message: "A complete shipping address is required." });
      }

      if (!/^\d{10}$/.test(phone)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit phone number is required." });
      }

      if (pincode && !/^\d{6}$/.test(pincode)) {
        return res.status(400).json({ success: false, message: "PIN code must be exactly 6 digits." });
      }

      const paymentMethod = ["COD", "UPI", "BankTransfer"].includes(
        req.body.paymentMethod
      )
        ? req.body.paymentMethod
        : "COD";

      // Validate all items against approved products.
      const resolvedItems = [];

      for (const item of items) {
        const productId = Number(item.productId || item.id);
        const quantity = Math.max(1, Math.min(99, Number(item.quantity) || 1));

        const product = db
          .prepare(
            `SELECT * FROM products WHERE id = ? AND status = 'Approved'`
          )
          .get(productId);

        if (!product) {
          return res.status(400).json({
            success: false,
            message: `Product is unavailable: ${item.name || productId}`,
          });
        }

        // Supplier stock was not confirmed by the last sync / checkout
        // refresh — never sell it as available.
        if (Number(product.stockUnverified) === 1) {
          return res.status(409).json({
            success: false,
            code: "STOCK_UNVERIFIED",
            message: `"${product.name}" is temporarily unavailable — its supplier stock could not be confirmed. Please remove it or try again shortly.`,
          });
        }

        resolvedItems.push({ product, quantity });
      }

      // PAN/GST seller eligibility + intra-State-only enforcement. This
      // runs before stock and payment so an ineligible/non-GST seller's
      // product can never create an order.
      for (const { product } of resolvedItems) {
        const taxGuard = checkoutSellerTaxGuard(product);
        if (taxGuard) {
          return res.status(taxGuard.status).json({
            success: false,
            code: taxGuard.code,
            message: taxGuard.message,
          });
        }
      }

      // LIMITED STOCK TRACKING — PRE-CHECK (fast, friendly message).
      // The authoritative guarded decrement still happens atomically
      // inside the order transaction below; this check only avoids
      // starting one when the shortfall is already visible.
      for (const { product, quantity } of resolvedItems) {
        if (product.stock === null || product.stock === undefined) continue;
        if (Number(product.stock) < quantity) {
          return res.status(400).json({
            success: false,
            code: "OUT_OF_STOCK",
            message:
              Number(product.stock) <= 0
                ? `"${product.name}" is out of stock.`
                : `Only ${Number(product.stock)} left of "${product.name}" — reduce the quantity or remove it from your cart.`,
          });
        }
      }

      // Authoritative order totals — the SAME calculator behind the
      // checkout quote endpoint. Whatever the client sends can never
      // set the price; it can only be cross-checked against it.
      const totals = calculateOrderTotals(resolvedItems, {
        state,
        deliveryMethod: clean(req.body.deliveryMethod),
      });

      // Optional integrity check: when the buyer's checkout displayed
      // a total, it must equal the server total or the order is
      // rejected with PRICE_MISMATCH instead of silently charging a
      // different amount than the buyer saw.
      if (
        req.body.clientGrandTotal !== undefined &&
        req.body.clientGrandTotal !== null &&
        req.body.clientGrandTotal !== ""
      ) {
        const clientTotal = Number(req.body.clientGrandTotal);

        if (!Number.isFinite(clientTotal) || Math.abs(clientTotal - totals.grandTotal) > 0.01) {
          return res.status(400).json({
            success: false,
            code: "PRICE_MISMATCH",
            message: `Checkout total ₹${
              Number.isFinite(clientTotal) ? clientTotal.toFixed(2) : "?"
            } does not match the server total ₹${totals.grandTotal.toFixed(
              2
            )}. Please review the refreshed amount and try again.`,
          });
        }
      }

      const totalAmount = totals.grandTotal;
      const chargesJson = JSON.stringify({ ...totals, version: 1, savedAt: now() });

      const orderNumber = `JB${Date.now()}${Math.floor(100 + Math.random() * 900)}`;

      const createOrder = db.transaction(() => {
        // LIMITED STOCK TRACKING — ATOMIC RESERVATION.
        // Each tracked product is decremented with a guarded UPDATE
        // ("stock >= quantity") inside the SAME transaction as the
        // order rows. Concurrent orders therefore can never drive
        // stock negative (the guard simply matches 0 rows and we
        // roll back), and a failed order NEVER leaves stock reduced:
        // any thrown error rolls the whole transaction back.
        let stockDeducted = 0;

        for (const { product, quantity } of resolvedItems) {
          if (product.stock === null || product.stock === undefined) continue;

          const info = db.prepare(`
            UPDATE products
            SET stock = stock - ?
            WHERE id = ? AND stock >= ?
          `).run(quantity, product.id, quantity);

          if (info.changes !== 1) {
            const error = new Error(
              `Not enough stock left for "${product.name}".`
            );
            error.code = "OUT_OF_STOCK";
            throw error;
          }

          stockDeducted = 1;
        }

        const result = db.prepare(`
          INSERT INTO orders (
            orderNumber, customerId, customerName, phone, address,
            totalAmount, chargesJson, paymentMethod, paymentStatus, status, createdAt, updatedAt,
            city, state, pincode, email, stockDeducted
          )
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Pending', 'Pending', ?, ?, ?, ?, ?, ?, ?)
        `).run(
          orderNumber,
          customer.id,
          customer.name,
          phone,
          address,
          String(totalAmount),
          chargesJson,
          paymentMethod,
          now(),
          now(),
          city,
          state,
          pincode,
          email || customer.email || null,
          stockDeducted
        );

        const orderId = result.lastInsertRowid;

        // 3×3 Family earnings: freeze the rule and calculation bases
        // at shopping time. A later admin percentage change can never
        // alter this order's rate. This does not touch order totals.
        captureMlm3x3OrderSnapshot({
          orderId,
          orderNumber,
          shoppingAt: now(),
          phone,
          bases: {
            order_total: totals.grandTotal,
            product_total: totals.baseTotal,
            items_total: totals.itemsTotal,
            taxable_total:
              totals.tax?.totals?.taxableValue ?? totals.baseTotal,
          },
        });

        resolvedItems.forEach(({ product, quantity }) => {
          db.prepare(`
            INSERT INTO order_items (orderId, productId, productName, sellerId, price, quantity)
            VALUES (?, ?, ?, ?, ?, ?)
          `).run(
            orderId,
            product.id,
            product.name,
            product.sellerId,
            product.price,
            quantity
          );
        });

        createOrderInvoices({
          orderId,
          orderNumber,
          resolvedItems,
          totals,
          destinationState: state,
        });

        return orderId;
      });

      const orderId = createOrder();

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

      res.status(201).json({
        success: true,
        message: "Order placed successfully.",
        order: orderWithItems(order),
      });
    } catch (error) {
      if (error && error.code === "OUT_OF_STOCK") {
        // The transaction already rolled back — no order row, no
        // stock change. Answer with the exact shortfall reason.
        return res.status(409).json({
          success: false,
          code: "OUT_OF_STOCK",
          message: error.message,
        });
      }

      console.error("PLACE ORDER ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to place order." });
    }
  }
);

// =====================================================
// CUSTOMER ORDERS
// =====================================================

businessRouter.get(
  "/api/customer/orders",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    const orders = db
      .prepare(`SELECT * FROM orders WHERE customerId = ? ORDER BY id DESC`)
      .all(req.user.customerId);

    // Customer tracking visibility: the partner's NAME only (no phone,
    // bank or other partner details) so buyers can see who will deliver.
    const partnerNames = new Map(
      db.prepare(`SELECT id, name FROM delivery_partners`).all().map((p) => [p.id, p.name])
    );

    // Courier (logistics COMPANY) tracking fields — additive. Buyers
    // see the courier NAME + their own AWB (tracking number), nothing else.
    const courierNames = courierPartnerNames();

    res.json({
      success: true,
      orders: orders.map((order) => ({
        ...orderWithItems(order),
        deliveryPartnerName: order.deliveryPartnerId
          ? partnerNames.get(order.deliveryPartnerId) || null
          : null,
        courierPartnerName: order.courierPartnerId
          ? courierNames.get(order.courierPartnerId) || null
          : null,
        // VERIFIED courier tracking (status + public history + tracking
        // URL). Additive — never includes API errors or credentials.
        courierTracking: courierPublicTracking(order),
      })),
    });
  }
);

// Customer invoice view: immutable per-seller snapshots. A non-GST
// seller's row has invoiceType NON_GST_INVOICE and zero tax fields.
businessRouter.get(
  "/api/customer/orders/:id/invoice",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ? AND customerId = ?`)
      .get(Number(req.params.id), req.user.customerId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const invoices = db
      .prepare(`SELECT * FROM order_invoices WHERE orderId = ? ORDER BY id`)
      .all(order.id)
      .map((invoice) => ({
        ...invoice,
        snapshot: invoice.snapshotJson ? JSON.parse(invoice.snapshotJson) : null,
      }));

    res.json({
      success: true,
      orderNumber: order.orderNumber,
      invoices,
      note:
        invoices.length === 0
          ? "No invoice snapshot exists for this legacy order. Existing order records were not modified."
          : "Invoice snapshots are immutable; later GST changes never alter them.",
    });
  }
);

// Customer cancellation (own orders, before shipping).
businessRouter.put(
  "/api/customer/orders/:id/cancel",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);

      const order = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      if (!order || order.customerId !== req.user.customerId) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      if (!["Pending", "Processing"].includes(order.status)) {
        return res.status(400).json({
          success: false,
          message: "This order can no longer be cancelled. Please contact support.",
        });
      }

      // LIMITED STOCK TRACKING — verified-rule restore only.
      // Existing business rule (unchanged): a customer may cancel
      // while the order is still Pending/Processing, i.e. BEFORE it
      // ships. On that exact path the reserved units never left, so
      // orders that actually decremented stock (stockDeducted = 1)
      // get it back — atomically, and only once (the status guard
      // above blocks a second cancel). Returned/Refunded flows are
      // deliberately NOT touched: no verified restore rule exists
      // for them yet.
      const cancelWithRestore = db.transaction(() => {
        applyOrderStatus(orderId, "Cancelled");

        if (Number(order.stockDeducted) === 1) {
          const orderItems = db
            .prepare(`SELECT productId, quantity FROM order_items WHERE orderId = ?`)
            .all(orderId);

          for (const item of orderItems) {
            db.prepare(`
              UPDATE products
              SET stock = stock + ?
              WHERE id = ? AND stock IS NOT NULL
            `).run(item.quantity, item.productId);
          }

          db.prepare(`UPDATE orders SET stockDeducted = 0 WHERE id = ?`).run(orderId);
        }
      });

      cancelWithRestore();

      const updated = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      res.json({
        success: true,
        message: "Order cancelled.",
        order: orderWithItems(updated),
      });
    } catch (error) {
      console.error("CUSTOMER CANCEL ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to cancel order." });
    }
  }
);

// =====================================================
// MLM SETTINGS (PUBLIC READ — powers member UI)
// =====================================================

businessRouter.get("/api/mlm/settings", (req, res) => {
  res.json({ success: true, rules: getMlmRules() });
});

// =====================================================
// MLM MEMBER REGISTRATION
// =====================================================

businessRouter.post(
  "/api/mlm/register",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const name = clean(req.body.name);
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const password = String(req.body.password || "");
      const referralCode = clean(
        req.body.referralCode || req.body.sponsorId || req.body.referrerId
      ).toUpperCase();

      if (!name) {
        return res.status(400).json({ success: false, message: "Please enter member name." });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({ success: false, message: "A valid 10-digit mobile number is required." });
      }

      if (password.length < 6) {
        return res.status(400).json({ success: false, message: "Password must be at least 6 characters." });
      }

      const existing = db
        .prepare(`SELECT id FROM mlm_members WHERE mobile = ?`)
        .get(mobile);

      if (existing) {
        return res.status(409).json({ success: false, message: "This mobile number is already registered." });
      }

      // Sponsor / referral ID is mandatory for every public member
      // registration. MLM_ALLOW_ROOT_REGISTRATION=1 is an explicit
      // server-level bootstrap/testing switch only; it is never set by
      // the buyer app and never bypasses invalid/self referrals.
      const allowRoot = process.env.MLM_ALLOW_ROOT_REGISTRATION === "1";

      if (!referralCode && !allowRoot) {
        return res.status(400).json({
          success: false,
          code: "SPONSOR_REQUIRED",
          message: "Sponsor / Referral Member ID is required.",
        });
      }

      let referrer = null;

      if (referralCode) {
        referrer = db
          .prepare(
            `SELECT * FROM mlm_members
             WHERE UPPER(referralCode) = ? OR UPPER(memberId) = ?
             LIMIT 1`
          )
          .get(referralCode, referralCode);

        if (!referrer) {
          return res.status(400).json({
            success: false,
            code: "INVALID_SPONSOR",
            message: "Invalid Sponsor / Referral Member ID.",
          });
        }

        if (referrer.status !== "active") {
          return res.status(400).json({
            success: false,
            code: "INACTIVE_SPONSOR",
            message: "This sponsor is not active.",
          });
        }

        if (
          String(referrer.mobile || "") === mobile ||
          (email && String(referrer.email || "").toLowerCase() === email)
        ) {
          return res.status(400).json({
            success: false,
            code: "SELF_REFERRAL",
            message: "Self-referral is not allowed.",
          });
        }
      }

      const memberId = generateMemberId();
      const passwordHash = await hashPassword(password);

      // SPILLOVER JOINING FLOW: registration records the SPONSOR
      // only. The tree placement happens automatically later, when
      // this member's shopping eligibility is confirmed (first
      // Delivered order) — see confirmShoppingEligibility(). Members
      // may join from anywhere in India; no location restriction.
      //
      // Referral attribution is stored separately from placement. The
      // first three introductions are direct; the fourth and later are
      // recorded as spillover introductions and are NEVER rejected.
      const insertMember = db.transaction(() => {
        const introduction = referrer
          ? classifyIntroduction(referrer.memberId)
          : { introductionType: null, directSlot: null, priorCount: 0 };

        const result = db.prepare(`
          INSERT INTO mlm_members (
            memberId, name, mobile, email, passwordHash, referralCode, parentId, position, sponsorId, createdAt
          )
          VALUES (?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
        `).run(
          memberId,
          name,
          mobile,
          email || null,
          passwordHash,
          memberId, // Member ID is also the referral ID
          referrer ? referrer.memberId : null,
          now()
        );

        db.prepare(`
          INSERT INTO mlm_wallets (memberId, balance, totalEarned, totalPaid, updatedAt)
          VALUES (?, 0, 0, 0, ?)
        `).run(memberId, now());

        if (referrer) {
          recordMlmReferral({
            sponsorId: referrer.memberId,
            memberId,
            introductionType: introduction.introductionType,
            directSlot: introduction.directSlot,
            note: `referral attribution; prior sponsored members: ${introduction.priorCount}`,
          });
        }

        placementAudit(
          "member-registered",
          memberId,
          {
            sponsorId: referrer ? referrer.memberId : null,
            introductionType: introduction.introductionType,
            directSlot: introduction.directSlot,
            priorSponsoredMembers: introduction.priorCount,
            note: "referral attribution recorded; tree placement deferred until shopping eligibility is confirmed",
          },
          "member-registration"
        );

        return result.lastInsertRowid;
      });

      insertMember();

      const member = db
        .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
        .get(memberId);

      const token = createToken({
        type: "member",
        memberId: member.memberId,
        name: member.name,
      });

      res.status(201).json({
        success: true,
        message: `Registration successful! Member ID: ${memberId} | Placement: pending — confirmed automatically on your first eligible shopping`,
        token,
        member: publicMember(member),
      });
    } catch (error) {
      console.error("MLM REGISTER ERROR:", error);
      res.status(500).json({ success: false, message: "Member registration failed." });
    }
  }
);

// =====================================================
// MLM MEMBER LOGIN
// =====================================================

businessRouter.post(
  "/api/mlm/login",
  rateLimit(20, 5 * 60 * 1000),
  async (req, res) => {
    try {
      const memberId = clean(req.body.memberId).toUpperCase();
      const password = String(req.body.password || "");

      if (!memberId || !password) {
        return res.status(400).json({ success: false, message: "Member ID and password are required." });
      }

      const member = db
        .prepare(`SELECT * FROM mlm_members WHERE UPPER(memberId) = ?`)
        .get(memberId);

      if (!member || !(await comparePassword(password, member.passwordHash))) {
        return res.status(401).json({ success: false, message: "Member ID not found or incorrect password." });
      }

      if (member.status === "blocked") {
        return res.status(403).json({
          success: false,
          message: "Your Member Account is blocked. Please contact JustBrand Admin.",
        });
      }

      const token = createToken({
        type: "member",
        memberId: member.memberId,
        name: member.name,
      });

      res.json({
        success: true,
        message: `Welcome ${member.name}!`,
        token,
        member: publicMember(member),
      });
    } catch (error) {
      console.error("MLM LOGIN ERROR:", error);
      res.status(500).json({ success: false, message: "Login failed." });
    }
  }
);

// =====================================
// MLM MEMBER MIDDLEWARE (LOAD MEMBER ROW)
// =====================================

function loadMember(req, res, next) {
  const member = db
    .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
    .get(req.user.memberId);

  if (!member) {
    return res.status(404).json({ success: false, message: "Member not found." });
  }

  if (member.status === "blocked") {
    return res.status(403).json({ success: false, message: "Your Member Account is blocked." });
  }

  req.member = member;
  next();
}

// =====================================================
// MLM DASHBOARD DATA
// =====================================================

businessRouter.get(
  "/api/mlm/me",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    releaseDueCommissions();

    const member = req.member;

    const parent = member.parentId
      ? db
          .prepare(`SELECT memberId, name FROM mlm_members WHERE memberId = ?`)
          .get(member.parentId)
      : null;

    const children = db
      .prepare(
        `SELECT memberId, name, position, createdAt FROM mlm_members WHERE parentId = ? ORDER BY id ASC`
      )
      .all(member.memberId);

    const teamSizeRow = db
      .prepare(`SELECT COUNT(*) AS count FROM mlm_members WHERE parentId = ?`)
      .get(member.memberId);

    const wallet = db
      .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
      .get(member.memberId) || {
      balance: 0,
      totalEarned: 0,
      totalPaid: 0,
    };

    const pendingRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM mlm_commissions WHERE memberId = ? AND status = 'Pending'`
      )
      .get(member.memberId);

    res.json({
      success: true,
      member: publicMember({ ...member, parentName: parent?.name || null }),
      directTeam: children,
      teamSize: teamSizeRow?.count || 0,
      wallet: {
        balance: wallet.balance || 0,
        totalEarned: wallet.totalEarned || 0,
        totalPaid: wallet.totalPaid || 0,
        pending: pendingRow?.total || 0,
      },
      rules: getMlmRules(),
    });
  }
);

// =====================================================
// MLM TREE (SUBTREE OF THE MEMBER)
// =====================================================

function buildSubtree(rootMember, depth) {
  const children = db
    .prepare(
      `SELECT memberId, name, position, createdAt FROM mlm_members WHERE parentId = ? ORDER BY id ASC`
    )
    .all(rootMember.memberId);

  if (depth <= 0) return children;

  return children.map((child) => ({
    ...child,
    children: buildSubtree(child, depth - 1),
  }));
}

businessRouter.get(
  "/api/mlm/tree",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    const member = req.member;

    res.json({
      success: true,
      member: publicMember(member),
      maxDirect: MAX_DIRECT,
      children: buildSubtree(member, 2),
    });
  }
);

// =====================================================
// MLM WALLET
// =====================================================

businessRouter.get(
  "/api/mlm/wallet",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    releaseDueCommissions();

    const wallet = db
      .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
      .get(req.member.memberId) || {
      balance: 0,
      totalEarned: 0,
      totalPaid: 0,
    };

    const pendingRow = db
      .prepare(
        `SELECT COALESCE(SUM(amount), 0) AS total FROM mlm_commissions WHERE memberId = ? AND status = 'Pending'`
      )
      .get(req.member.memberId);

    res.json({
      success: true,
      wallet: {
        balance: wallet.balance || 0,
        totalEarned: wallet.totalEarned || 0,
        totalPaid: wallet.totalPaid || 0,
        pending: pendingRow?.total || 0,
      },
    });
  }
);

// =====================================================
// MLM PAYOUT REQUEST HISTORY (MEMBER — OWN ONLY)
// =====================================================
// Members can see the status of their own withdrawal requests.
// Only the member's own rows are returned — never another member's.

businessRouter.get(
  "/api/mlm/payout-requests",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    const requests = db
      .prepare(
        `SELECT id, amount, method, status, createdAt FROM payout_requests WHERE memberId = ? ORDER BY id DESC LIMIT 50`
      )
      .all(req.member.memberId);

    res.json({ success: true, requests });
  }
);

// =====================================================
// MLM COMMISSION RECORDS
// =====================================================

businessRouter.get(
  "/api/mlm/commissions",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    releaseDueCommissions();

    const commissions = db
      .prepare(
        `SELECT * FROM mlm_commissions WHERE memberId = ? ORDER BY id DESC LIMIT 100`
      )
      .all(req.member.memberId);

    res.json({ success: true, commissions });
  }
);

// =====================================================
// MLM PAYOUT REQUEST (MEMBER)
// =====================================================
// Members can request a payout of their payable balance.
// The actual payment remains a restricted financial action
// performed by Super Admin / Accountant.

businessRouter.post(
  "/api/mlm/payout-request",
  requireAuth,
  requireType("member"),
  loadMember,
  (req, res) => {
    try {
      releaseDueCommissions();

      const amount = Number(req.body.amount);
      const method = clean(req.body.method) || "Bank Account";

      if (!Number.isFinite(amount) || amount <= 0) {
        return res.status(400).json({ success: false, message: "Please enter a valid withdrawal amount." });
      }

      if (amount < 100) {
        return res.status(400).json({ success: false, message: "Minimum withdrawal amount is ₹100." });
      }

      const wallet = db
        .prepare(`SELECT * FROM mlm_wallets WHERE memberId = ?`)
        .get(req.member.memberId);

      if (!wallet || wallet.balance < amount) {
        return res.status(400).json({ success: false, message: "Insufficient available wallet balance." });
      }

      db.prepare(`
        INSERT INTO payout_requests (memberId, amount, method, status, createdAt)
        VALUES (?, ?, ?, 'Processing', ?)
      `).run(req.member.memberId, amount, method, now());

      res.json({
        success: true,
        message: "Payout request recorded. The JustBrand accounts team will process your payout.",
      });
    } catch (error) {
      console.error("MLM PAYOUT REQUEST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to record payout request." });
    }
  }
);

// =====================================================
// ADMIN: SELLER MANAGEMENT
// =====================================================

businessRouter.get(
  "/api/admin/sellers",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const sellers = db
      .prepare(`SELECT * FROM sellers ORDER BY id DESC`)
      .all();

    const withKyc = sellers.map((seller) => {
      const profile = getSellerTaxProfile(seller.id);
      return {
        ...publicSeller(seller),
        kycStatus: profile?.row?.kycStatus || "Pending",
        taxProfile: profile
          ? publicSellerTaxProfile(profile.row, profile.eligibility)
          : null,
      };
    });

    res.json({ success: true, sellers: withKyc });
  }
);

// Must be declared before /api/admin/sellers/:id.
businessRouter.get(
  "/api/admin/sellers/tax-summary",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const rows = db.prepare(`SELECT id FROM sellers ORDER BY id DESC`).all();
    const summary = {
      total: rows.length,
      gstRegistered: 0,
      gstUnregistered: 0,
      gstPending: 0,
      gstRejected: 0,
      panPending: 0,
      panVerified: 0,
      kycPending: 0,
      approved: 0,
      rejected: 0,
      legacy: 0,
    };

    for (const row of rows) {
      const profile = getSellerTaxProfile(row.id);
      if (!profile) continue;
      const p = publicSellerTaxProfile(profile.row, profile.eligibility);
      if (p.legacy) summary.legacy += 1;
      if (p.gstStatus === GST_STATUS.REGISTERED) summary.gstRegistered += 1;
      if (p.gstStatus === GST_STATUS.UNREGISTERED) summary.gstUnregistered += 1;
      if (p.gstStatus === GST_STATUS.PENDING) summary.gstPending += 1;
      if (p.gstStatus === GST_STATUS.REJECTED) summary.gstRejected += 1;
      if (p.panStatus === PAN_STATUS.PENDING) summary.panPending += 1;
      if (p.panStatus === PAN_STATUS.VERIFIED) summary.panVerified += 1;
      if (p.kycStatus === "Pending") summary.kycPending += 1;
      if (p.kycStatus === "Approved") summary.approved += 1;
      if (p.kycStatus === "Rejected") summary.rejected += 1;
    }

    res.json({ success: true, summary });
  }
);

// Seller detail including private KYC/bank data (staff only, never customers).
businessRouter.get(
  "/api/admin/sellers/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(Number(req.params.id));

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const kyc = db
      .prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`)
      .get(seller.id);

    const bank = db
      .prepare(`SELECT * FROM seller_bank WHERE sellerId = ?`)
      .get(seller.id);

    const profile = getSellerTaxProfile(seller.id);

    res.json({
      success: true,
      seller: publicSeller(seller),
      kyc: kyc || null,
      bank: bank || null,
      taxProfile: profile
        ? publicSellerTaxProfile(profile.row, profile.eligibility)
        : null,
    });
  }
);

businessRouter.put(
  "/api/admin/sellers/:id/status",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(Number(req.params.id));

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const status = req.body.status === "suspended" ? "suspended" : "active";

    db.prepare(`UPDATE sellers SET status = ? WHERE id = ?`).run(status, seller.id);

    res.json({ success: true, message: `Seller ${status === "active" ? "activated" : "suspended"}.` });
  }
);

// KYC approve/reject (manager or super admin).
businessRouter.put(
  "/api/admin/sellers/:id/kyc",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db
      .prepare(`SELECT * FROM sellers WHERE id = ?`)
      .get(Number(req.params.id));

    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const kycStatus = ["Approved", "Rejected", "Pending"].includes(req.body.kycStatus)
      ? req.body.kycStatus
      : "Pending";

    db.prepare(`
      INSERT INTO seller_kyc (sellerId, kycStatus, rejectionReason, updatedAt)
      VALUES (?, ?, ?, ?)
      ON CONFLICT(sellerId) DO UPDATE SET
        kycStatus = excluded.kycStatus,
        rejectionReason = excluded.rejectionReason,
        updatedAt = excluded.updatedAt
    `).run(seller.id, kycStatus, clean(req.body.rejectionReason) || null, now());

    // A seller without approved KYC must not keep live products. This
    // also covers a previously approved seller whose KYC is reset.
    if (kycStatus !== "Approved") {
      db.prepare(`UPDATE products SET status = 'Pending' WHERE sellerId = ? AND status = 'Approved'`).run(
        seller.sellerCode
      );
      db.prepare(`UPDATE products SET status = 'Pending' WHERE sellerId = ? AND status = 'Approved'`).run(
        String(seller.id)
      );
    }

    writeSellerTaxAudit({ sellerId: seller.id, actor: req.user, action: "kyc_status", before: seller.kycStatus || null, after: kycStatus, reason: req.body.rejectionReason });

    res.json({ success: true, message: `Seller KYC marked ${kycStatus}.` });
  }
);

// Manual PAN verification (no provider is configured in preview).
businessRouter.put(
  "/api/admin/sellers/:id/pan",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(Number(req.params.id));
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const profile = getSellerTaxProfile(seller.id);
    if (!profile || profile.row.taxProfileConfigured !== 1 || !profile.row.panNumber) {
      return res.status(400).json({ success: false, message: "This seller has no PAN on file." });
    }

    const panStatus = ["Verified", "Rejected"].includes(req.body.panStatus)
      ? req.body.panStatus
      : null;
    if (!panStatus) {
      return res.status(400).json({ success: false, message: "panStatus must be Verified or Rejected." });
    }
    const reason = clean(req.body.reason);
    if (panStatus === "Rejected" && !reason) {
      return res.status(400).json({ success: false, message: "A rejection reason is required." });
    }

    const timestamp = now();
    db.prepare(`
      UPDATE seller_kyc SET
        panStatus = ?,
        panVerifiedAt = CASE WHEN ? = 'Verified' THEN ? ELSE panVerifiedAt END,
        panVerifiedBy = CASE WHEN ? = 'Verified' THEN ? ELSE panVerifiedBy END,
        panRejectionReason = ?,
        updatedAt = ?
      WHERE sellerId = ?
    `).run(
      panStatus,
      panStatus,
      timestamp,
      panStatus,
      req.user.adminId || req.user.name || "admin",
      panStatus === "Rejected" ? reason : null,
      timestamp,
      seller.id
    );

    // A rejected PAN must not keep selling.
    if (panStatus === "Rejected") {
      db.prepare(`UPDATE products SET status = 'Pending' WHERE sellerId = ? AND status = 'Approved'`).run(seller.sellerCode);
    }

    writeSellerTaxAudit({
      sellerId: seller.id,
      actor: req.user,
      action: "pan_verification",
      before: profile.row.panStatus,
      after: panStatus,
      reason,
    });

    res.json({ success: true, message: `PAN marked ${panStatus}.` });
  }
);

// Manual GSTIN verification + approval. Tax mapping only starts after this.
businessRouter.put(
  "/api/admin/sellers/:id/gst",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(Number(req.params.id));
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const profile = getSellerTaxProfile(seller.id);
    if (!profile || !profile.row.gstNumber) {
      return res.status(400).json({ success: false, message: "This seller has not submitted a GSTIN." });
    }

    const gstStatus = ["Approved", "Rejected"].includes(req.body.gstStatus)
      ? req.body.gstStatus
      : null;
    if (!gstStatus) {
      return res.status(400).json({ success: false, message: "gstStatus must be Approved or Rejected." });
    }
    const reason = clean(req.body.reason);
    if (gstStatus === "Rejected" && !reason) {
      return res.status(400).json({ success: false, message: "A rejection reason is required." });
    }

    const timestamp = now();
    const registered = gstStatus === "Approved" ? GST_STATUS.REGISTERED : GST_STATUS.REJECTED;
    db.prepare(`
      UPDATE seller_kyc SET
        gstStatus = ?,
        gstApprovedAt = CASE WHEN ? = ? THEN ? ELSE gstApprovedAt END,
        gstApprovedBy = CASE WHEN ? = ? THEN ? ELSE gstApprovedBy END,
        gstRejectionReason = ?,
        updatedAt = ?
      WHERE sellerId = ?
    `).run(
      registered,
      registered,
      GST_STATUS.REGISTERED,
      timestamp,
      registered,
      GST_STATUS.REGISTERED,
      req.user.adminId || req.user.name || "admin",
      registered === GST_STATUS.REJECTED ? reason : null,
      timestamp,
      seller.id
    );

    // Do not silently re-price or re-publish. Products go back to admin
    // approval so GST mapping/re-pricing is reviewed first.
    db.prepare(`UPDATE products SET status = 'Pending' WHERE sellerId = ? AND status = 'Approved'`).run(seller.sellerCode);
    for (const product of db.prepare(`SELECT * FROM products WHERE sellerId = ?`).all(seller.sellerCode)) {
      applyProductSellerTax(product.id);
    }

    writeSellerTaxAudit({
      sellerId: seller.id,
      actor: req.user,
      action: gstStatus === "Approved" ? "gstin_approved" : "gstin_rejected",
      before: profile.row.gstStatus,
      after: registered,
      reason,
    });

    res.json({
      success: true,
      message:
        gstStatus === "Approved"
          ? "GSTIN approved. Seller products are Pending for tax re-approval."
          : "GSTIN rejected. Seller products are Pending.",
    });
  }
);

// The GST-unregistered selling route is permanently disabled. Keep this
// endpoint as an explicit refusal so an old Admin bundle cannot re-enable
// selling behind the new policy. No row is changed here.
businessRouter.put(
  "/api/admin/sellers/:id/tax-status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = db.prepare(`SELECT id FROM sellers WHERE id = ?`).get(Number(req.params.id));
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    return res.status(409).json({
      success: false,
      code: "GST_REQUIRED",
      message:
        "GST-unregistered selling is disabled. Submit and approve a GSTIN before this seller can list or sell.",
    });
  }
);

businessRouter.get(
  "/api/admin/sellers/:id/audit",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const seller = db.prepare(`SELECT id FROM sellers WHERE id = ?`).get(Number(req.params.id));
    if (!seller) {
      return res.status(404).json({ success: false, message: "Seller not found." });
    }

    const logs = db
      .prepare(`SELECT * FROM seller_audit_log WHERE sellerId = ? ORDER BY id DESC LIMIT 200`)
      .all(seller.id);

    res.json({ success: true, logs });
  }
);

// =====================================================
// ADMIN: ORDER MANAGEMENT
// =====================================================

businessRouter.get(
  "/api/admin/orders",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const orders = db
      .prepare(`SELECT * FROM orders ORDER BY id DESC LIMIT 500`)
      .all();

    // Additive delivery visibility for the admin orders table (same
    // partner-name pattern as the seller/customer order endpoints).
    const partnerNames = new Map(
      db.prepare(`SELECT id, name FROM delivery_partners`).all().map((p) => [p.id, p.name])
    );

    // Courier (logistics COMPANY) visibility — additive fields; the
    // person-based deliveryPartnerName above is untouched.
    const courierNames = courierPartnerNames();

    res.json({
      success: true,
      orders: orders.map((order) => ({
        ...orderWithItems(order),
        deliveryPartnerName: order.deliveryPartnerId
          ? partnerNames.get(order.deliveryPartnerId) || null
          : null,
        courierPartnerName: order.courierPartnerId
          ? courierNames.get(order.courierPartnerId) || null
          : null,
      })),
    });
  }
);

businessRouter.get(
  "/api/admin/orders/:id/invoices",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ?`)
      .get(Number(req.params.id));

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const invoices = db
      .prepare(`SELECT * FROM order_invoices WHERE orderId = ? ORDER BY id`)
      .all(order.id)
      .map((invoice) => ({
        ...invoice,
        snapshot: invoice.snapshotJson ? JSON.parse(invoice.snapshotJson) : null,
      }));

    res.json({ success: true, orderNumber: order.orderNumber, invoices });
  }
);

businessRouter.put(
  "/api/admin/orders/:id/status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const newStatus = clean(req.body.status);

      const allowed = [
        "Pending",
        "Processing",
        "Shipped",
        "Delivered",
        "Cancelled",
        "Returned",
        "Refunded",
      ];

      if (!allowed.includes(newStatus)) {
        return res.status(400).json({ success: false, message: "Invalid order status." });
      }

      const order = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      applyOrderStatus(orderId, newStatus);

      const updated = db
        .prepare(`SELECT * FROM orders WHERE id = ?`)
        .get(orderId);

      res.json({
        success: true,
        message: `Order status updated to ${newStatus}.`,
        order: orderWithItems(updated),
      });
    } catch (error) {
      console.error("ADMIN ORDER STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update order status." });
    }
  }
);

// Payment verification is a FINANCIAL SETTLEMENT action: super_admin only.
// (Read-only financial reporting stays available to accountant — see GETs.)
businessRouter.put(
  "/api/admin/orders/:id/payment",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const orderId = Number(req.params.id);

    const order = db
      .prepare(`SELECT * FROM orders WHERE id = ?`)
      .get(orderId);

    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    const paymentStatus = ["Pending", "Paid", "Refunded"].includes(req.body.paymentStatus)
      ? req.body.paymentStatus
      : "Pending";

    db.prepare(`
      UPDATE orders
      SET paymentStatus = ?, paymentRef = ?, updatedAt = ?
      WHERE id = ?
    `).run(paymentStatus, clean(req.body.paymentRef) || order.paymentRef, now(), orderId);

    // A FULLY REFUNDED payment must not keep earning: void any
    // still-pending commission and revoke the shopping-eligibility
    // event (audit only — the member's tree position is untouched).
    if (paymentStatus === "Refunded") {
      voidCommissionsForOrder(orderId);
      voidMlm3x3CommissionsForOrder(
        orderId,
        "payment refunded",
        "staff-payment-settlement"
      );
      recordEligibilityRevocation(orderId, "payment refunded", "staff-payment-settlement");
    }

    res.json({ success: true, message: `Payment marked ${paymentStatus}.` });
  }
);

// =====================================================
// ADMIN: PAN-INDIA SPILLOVER PLACEMENT INSPECTION
// =====================================================
// Read endpoints (super_admin + manager) for auditing placements,
// three-slot downlines, eligibility timestamps (IST), qualifying
// orders and failure/duplicate attempts. One manual correction
// endpoint (super_admin only) — it NEVER rearranges existing
// members; it only (re)runs the chronological placement engine for
// a still-unplaced member, and it always writes an audit record.

businessRouter.get(
  "/api/admin/mlm/placements",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const status = clean(req.query.status);
      const memberId = clean(req.query.memberId).toUpperCase();
      const limit = Math.min(Number(req.query.limit) || 200, 500);

      const rows = db.prepare(`
        SELECT
          p.*,
          m.name AS memberName,
          m.mobile AS memberMobile,
          m.sponsorId,
          pm.name AS parentName,
          o.status AS orderStatus,
          o.paymentStatus AS orderPaymentStatus,
          o.totalAmount AS orderTotalAmount
        FROM mlm_placements p
        LEFT JOIN mlm_members m ON m.memberId = p.memberId
        LEFT JOIN mlm_members pm ON pm.memberId = p.parentId
        LEFT JOIN orders o ON o.id = p.qualifyingOrderId
        WHERE (? = '' OR p.status = ?)
          AND (? = '' OR p.memberId = ?)
        ORDER BY p.id DESC
        LIMIT ?
      `).all(status, status, memberId, memberId, limit);

      const placements = rows.map((row) => ({
        id: row.id,
        memberId: row.memberId,
        memberName: row.memberName,
        memberMobile: row.memberMobile,
        parentId: row.parentId,
        parentName: row.parentName,
        position: row.position,
        sponsorId: row.sponsorId,
        qualifyingOrderId: row.qualifyingOrderId,
        orderStatus: row.orderStatus,
        orderPaymentStatus: row.orderPaymentStatus,
        orderTotalAmount: row.orderTotalAmount,
        eligibilityAt: row.eligibilityAt,
        eligibilityAtIst: toIst(row.eligibilityAt),
        status: row.status,
        reason: row.reason,
        createdAt: row.createdAt,
        createdAtIst: toIst(row.createdAt),
      }));

      res.json({ success: true, count: placements.length, placements });
    } catch (error) {
      console.error("ADMIN PLACEMENTS LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to list placements." });
    }
  }
);

businessRouter.get(
  "/api/admin/mlm/members/:memberId/placement",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const memberId = clean(req.params.memberId).toUpperCase();

      const member = db
        .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
        .get(memberId);

      if (!member) {
        return res.status(404).json({ success: false, message: "Member not found." });
      }

      const parent = member.parentId
        ? db
            .prepare(
              `SELECT memberId, name, position FROM mlm_members WHERE memberId = ?`
            )
            .get(member.parentId)
        : null;

      // THREE DIRECT SLOTS (A / B / C) — filled or vacant.
      const children = db
        .prepare(`
          SELECT
            c.memberId, c.name, c.position, c.sponsorId, c.createdAt,
            p.qualifyingOrderId, p.eligibilityAt, p.status AS placementStatus
          FROM mlm_members c
          LEFT JOIN mlm_placements p ON p.memberId = c.memberId
          WHERE c.parentId = ?
          ORDER BY c.id ASC
        `)
        .all(memberId);

      const slotOf = (position, index) => position || ["A", "B", "C"][index] || null;
      const directSlots = ["A", "B", "C"].map((slot, index) => {
        const child = children[index] || null;
        return {
          slot,
          occupied: Boolean(child),
          memberId: child?.memberId || null,
          name: child?.name || null,
          childPosition: child ? slotOf(child.position, index) : null,
          joinedAt: child?.createdAt || null,
          joinedAtIst: toIst(child?.createdAt),
          qualifyingOrderId: child?.qualifyingOrderId ?? null,
          eligibilityAt: child?.eligibilityAt || null,
          eligibilityAtIst: toIst(child?.eligibilityAt),
          placementStatus: child?.placementStatus || "legacy",
        };
      });

      const placements = db
        .prepare(`SELECT * FROM mlm_placements WHERE memberId = ? ORDER BY id ASC`)
        .all(memberId)
        .map((row) => ({
          ...row,
          eligibilityAtIst: toIst(row.eligibilityAt),
          createdAtIst: toIst(row.createdAt),
        }));

      const eligibilityEvents = db
        .prepare(`
          SELECT e.*,
                 o.status AS orderStatus,
                 o.paymentStatus AS orderPaymentStatus,
                 o.totalAmount AS orderTotalAmount
          FROM mlm_eligibility_events e
          LEFT JOIN orders o ON o.id = e.orderId
          WHERE e.memberId = ?
          ORDER BY e.confirmedAt ASC, e.orderId ASC
        `)
        .all(memberId)
        .map((row) => ({
          ...row,
          confirmedAtIst: toIst(row.confirmedAt),
          revokedAtIst: toIst(row.revokedAt),
        }));

      // Failed / duplicate attempts + full action history for this
      // member (audit trail).
      const audit = db
        .prepare(`
          SELECT * FROM mlm_placement_audit
          WHERE memberId = ?
          ORDER BY id ASC
          LIMIT 500
        `)
        .all(memberId)
        .map((row) => ({
          ...row,
          atIst: toIst(row.at),
          details: (() => {
            try {
              return JSON.parse(row.details || "{}");
            } catch {
              return {};
            }
          })(),
        }));

      res.json({
        success: true,
        member: {
          memberId: member.memberId,
          name: member.name,
          mobile: member.mobile,
          status: member.status,
          sponsorId: member.sponsorId,
          parentId: member.parentId,
          position: member.position,
          placed: isMemberPlaced(member),
          createdAt: member.createdAt,
          createdAtIst: toIst(member.createdAt),
        },
        parent,
        directSlots,
        directChildrenCount: children.length,
        placements,
        eligibilityEvents,
        audit,
      });
    } catch (error) {
      console.error("ADMIN MEMBER PLACEMENT ERROR:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to load member placement." });
    }
  }
);

// Manual correction (super_admin only): (re)run the chronological
// placement engine for a still-unplaced member. Requires an explicit
// reason; every run writes an audit record. Existing placements are
// never rearranged and already-placed members are never touched.
businessRouter.post(
  "/api/admin/mlm/members/:memberId/reprocess-placement",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const memberId = clean(req.params.memberId).toUpperCase();
      const reason = clean(req.body.reason);

      if (!reason || reason.length < 5) {
        return res.status(400).json({
          success: false,
          message: "A reason (min 5 characters) is required for manual corrections.",
        });
      }

      const member = db
        .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
        .get(memberId);

      if (!member) {
        return res.status(404).json({ success: false, message: "Member not found." });
      }

      if (isMemberPlaced(member)) {
        placementAudit(
          "manual-reprocess-rejected",
          memberId,
          { reason, note: "member already placed — existing placements are never rearranged" },
          `staff:${req.user.username || req.user.role || "admin"}`
        );
        return res.status(409).json({
          success: false,
          message:
            "Member is already placed. Existing placements are never rearranged automatically.",
        });
      }

      // Confirm eligibility from the member's own qualifying orders
      // (earliest first), then drain the chronological queue.
      const qualifyingOrders = db.prepare(`
        SELECT * FROM orders
        WHERE phone = ?
          AND status = 'Delivered'
          AND IFNULL(paymentStatus, 'Pending') != 'Refunded'
          AND REPLACE(REPLACE(totalAmount, '₹', ''), ',', '') NOT IN ('', '0')
        ORDER BY id ASC
      `).all(member.mobile);

      const actor = `staff:${req.user.username || req.user.role || "admin"}`;

      for (const order of qualifyingOrders) {
        const outcome = confirmShoppingEligibility(order, actor);
        if (outcome.confirmed) break; // earliest qualifying order wins
      }

      // Drain the WHOLE chronological queue (not just this member) so
      // tie-broken order stays deterministic: identical confirmation
      // timestamps fall back to the unique orderId regardless of which
      // member an admin reprocesses first.
      const placements = processPendingEligiblePlacements(null, actor);

      placementAudit(
        "manual-reprocess",
        memberId,
        { reason, placements: placements.filter((p) => p.placed).length },
        actor
      );

      const placement = db
        .prepare(`SELECT * FROM mlm_placements WHERE memberId = ?`)
        .get(memberId);

      if (!placement) {
        return res.json({
          success: true,
          placed: false,
          message:
            "No qualifying delivered order found — member remains unplaced. Eligibility is confirmed automatically on delivery.",
        });
      }

      res.json({
        success: true,
        placed: true,
        message: `Member placed under ${placement.parentId || "ROOT"} (${placement.position}).`,
        placement: {
          ...placement,
          eligibilityAtIst: toIst(placement.eligibilityAt),
          createdAtIst: toIst(placement.createdAt),
        },
      });
    } catch (error) {
      console.error("ADMIN REPROCESS PLACEMENT ERROR:", error);
      res
        .status(500)
        .json({ success: false, message: "Failed to reprocess placement." });
    }
  }
);

// =====================================================
// ADMIN: CUSTOMERS
// =====================================================

businessRouter.get(
  "/api/admin/customers",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const customers = db
      .prepare(`SELECT * FROM customers ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, customers: customers.map(publicCustomer) });
  }
);

// =====================================================
// ADMIN: MLM MANAGEMENT
// =====================================================

businessRouter.get(
  "/api/admin/mlm/members",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const members = db
      .prepare(`SELECT * FROM mlm_members ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, members: members.map(publicMember) });
  }
);

businessRouter.put(
  "/api/admin/mlm/members/:memberId/status",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const member = db
      .prepare(`SELECT * FROM mlm_members WHERE memberId = ?`)
      .get(clean(req.params.memberId));

    if (!member) {
      return res.status(404).json({ success: false, message: "Member not found." });
    }

    const status = req.body.status === "blocked" ? "blocked" : "active";

    db.prepare(`UPDATE mlm_members SET status = ? WHERE memberId = ?`).run(
      status,
      member.memberId
    );

    res.json({ success: true, message: `Member ${status === "blocked" ? "blocked" : "activated"}.` });
  }
);

businessRouter.get(
  "/api/admin/mlm/settings",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    res.json({ success: true, rules: getMlmRules() });
  }
);

businessRouter.put(
  "/api/admin/mlm/settings",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const current = getMlmRules();

      const numericKeys = [
        "directCommission",
        "levelCommission",
        "binaryCommission",
        "shoppingCommission",
        "returnPeriodDays",
        "directMemberLimit",
      ];

      const next = { ...current };

      numericKeys.forEach((key) => {
        if (req.body[key] !== undefined) {
          const value = Number(req.body[key]);
          if (Number.isFinite(value) && value >= 0) {
            next[key] = value;
          }
        }
      });

      [
        "commissionAfterReturn",
        "cancelCommission",
        "returnCommission",
      ].forEach((key) => {
        if (typeof req.body[key] === "boolean") {
          next[key] = req.body[key];
        }
      });

      // Business guard: cancelled/returned orders must not earn commission.
      next.cancelCommission = false;
      next.returnCommission = false;

      saveMlmRules(next);

      res.json({ success: true, message: "Commission rules updated.", rules: next });
    } catch (error) {
      console.error("ADMIN MLM SETTINGS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update commission rules." });
    }
  }
);

// =====================================================
// ADMIN: 3×3 FAMILY EARNING SETTINGS + REPORTS
// =====================================================
// Settings are editable by super_admin only. Managers/accountants can
// read the configuration; financial commission rows are limited to
// super_admin/accountant, matching the existing commission ledger.

businessRouter.get(
  "/api/admin/mlm/3x3/settings",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    res.json({
      success: true,
      settings: getMlm3x3Settings(),
      audit: listMlm3x3SettingsAudit(100),
    });
  }
);

businessRouter.put(
  "/api/admin/mlm/3x3/settings",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const actor = `staff:${req.user.username || req.user.role || "admin"}`;
      const result = saveMlm3x3Settings(
        req.body?.settings || req.body,
        actor,
        clean(req.body?.note)
      );

      res.json({
        success: true,
        changed: result.changed,
        message: result.changed
          ? "3×3 Family earning settings saved. Existing orders keep their saved rates."
          : "No setting changed.",
        settings: result.settings,
        audit: listMlm3x3SettingsAudit(100),
      });
    } catch (error) {
      console.error("ADMIN 3X3 SETTINGS ERROR:", error);
      res.status(error.status || 500).json({
        success: false,
        message: error.message || "Failed to update 3×3 earning settings.",
        errors: error.errors || undefined,
      });
    }
  }
);

businessRouter.get(
  "/api/admin/mlm/3x3/audit",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    res.json({
      success: true,
      audit: listMlm3x3SettingsAudit(req.query.limit || 100),
    });
  }
);

businessRouter.get(
  "/api/admin/mlm/3x3/commissions",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    res.json({
      success: true,
      commissions: listMlm3x3Commissions({
        type: clean(req.query.type),
        status: clean(req.query.status),
        from: clean(req.query.from),
        to: clean(req.query.to),
        limit: req.query.limit,
      }),
      summary: getMlm3x3Summary(),
    });
  }
);

// Release due commissions (also runs automatically on member reads).
// Releasing rewards moves money: super_admin only (403 for everyone else).
businessRouter.post(
  "/api/admin/mlm/commissions/release",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    releaseDueCommissions();

    const totals = db
      .prepare(
        `SELECT status, COUNT(*) AS count, COALESCE(SUM(amount), 0) AS amount FROM mlm_commissions GROUP BY status`
      )
      .all();

    res.json({ success: true, message: "Due commissions processed.", totals });
  }
);

// All commissions (restricted financial view).
businessRouter.get(
  "/api/admin/mlm/commissions",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const commissions = db
      .prepare(`SELECT * FROM mlm_commissions ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, commissions });
  }
);

// Payout requests (financial action).
businessRouter.get(
  "/api/admin/mlm/payouts",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const payouts = db
      .prepare(`SELECT * FROM payout_requests ORDER BY id DESC LIMIT 500`)
      .all();

    res.json({ success: true, payouts });
  }
);

// Process a payout request: debit wallet and mark paid.
// Financial settlement: super_admin only (403 for everyone else).
businessRouter.put(
  "/api/admin/mlm/payouts/:id",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const payout = db
      .prepare(`SELECT * FROM payout_requests WHERE id = ?`)
      .get(Number(req.params.id));

    if (!payout) {
      return res.status(404).json({ success: false, message: "Payout request not found." });
    }

    if (payout.status !== "Processing") {
      return res.status(400).json({ success: false, message: "This payout request was already processed." });
    }

    const processPayout = db.transaction(() => {
      db.prepare(
        `UPDATE payout_requests SET status = 'Paid', processedAt = ? WHERE id = ?`
      ).run(now(), payout.id);

      db.prepare(`
        UPDATE mlm_wallets
        SET balance = balance - ?, totalPaid = totalPaid + ?, updatedAt = ?
        WHERE memberId = ?
      `).run(payout.amount, payout.amount, now(), payout.memberId);
    });

    processPayout();

    res.json({ success: true, message: "Payout marked as paid." });
  }
);

// Mark a payable commission as actually paid (financial settlement):
// super_admin only (403 for everyone else).
businessRouter.put(
  "/api/admin/mlm/commissions/:id/paid",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    const commission = db
      .prepare(`SELECT * FROM mlm_commissions WHERE id = ?`)
      .get(Number(req.params.id));

    if (!commission) {
      return res.status(404).json({ success: false, message: "Commission record not found." });
    }

    if (commission.status !== "Payable") {
      return res.status(400).json({
        success: false,
        message: "Only Payable commissions can be marked paid.",
      });
    }

    const markPaid = db.transaction(() => {
      db.prepare(
        `UPDATE mlm_commissions SET status = 'Paid', paidAt = ? WHERE id = ?`
      ).run(now(), commission.id);

      db.prepare(`
        UPDATE mlm_wallets
        SET balance = balance - ?, totalPaid = totalPaid + ?, updatedAt = ?
        WHERE memberId = ?
      `).run(commission.amount, commission.amount, now(), commission.memberId);
    });

    markPaid();

    res.json({ success: true, message: "Commission marked as paid." });
  }
);

// =====================================================
// SELLER SCHEMES (additive — development/local-preview ready)
// =====================================================
// A scheme is a seller-declared discount offer that NEVER becomes
// active without explicit Admin approval. Status flow:
//   Draft → (seller submits) → Pending Approval → (admin) → Approved | Rejected
//   Approved + endDate in the past → surfaced as Expired
// Ownership is enforced SERVER-SIDE on every seller route (foreign
// scheme ids return 404, never a permission-leaking 403).
// This block does NOT modify the existing pricing pipeline
// (calculateCustomerPricing): scheme discounts are computed and
// displayed by the clients; applying them to the live buyer feed is
// a separate, deliberately unimplemented product decision.
// Production note: this table/routes exist only where this backend
// source is deployed — the seller UI degrades gracefully otherwise.

const SCHEME_EDITABLE_STATUSES = ["Draft", "Rejected"];

db.prepare(`
  CREATE TABLE IF NOT EXISTS seller_schemes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerId TEXT NOT NULL,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    discountType TEXT NOT NULL DEFAULT 'percent',
    discountValue REAL NOT NULL DEFAULT 0,
    productIds TEXT NOT NULL DEFAULT '[]',
    startDate TEXT,
    endDate TEXT,
    status TEXT NOT NULL DEFAULT 'Draft',
    adminNote TEXT DEFAULT '',
    createdAt TEXT,
    updatedAt TEXT
  )
`).run();

console.log("Seller schemes table ready.");

function schemeEffectiveStatus(row) {
  if (row.status === "Approved" && row.endDate) {
    const today = new Date().toISOString().slice(0, 10);
    if (row.endDate < today) return "Expired";
  }
  return row.status;
}

function publicScheme(row) {
  let productIds = [];

  try {
    const parsed = JSON.parse(row.productIds || "[]");

    if (Array.isArray(parsed)) {
      productIds = parsed.map(Number).filter((value) => Number.isInteger(value));
    }
  } catch {
    productIds = [];
  }

  return {
    id: row.id,
    sellerId: row.sellerId,
    name: row.name,
    description: row.description || "",
    discountType: row.discountType,
    discountValue: row.discountValue,
    productIds,
    startDate: row.startDate || null,
    endDate: row.endDate || null,
    status: schemeEffectiveStatus(row),
    storedStatus: row.status,
    adminNote: row.adminNote || "",
    createdAt: row.createdAt || null,
    updatedAt: row.updatedAt || null,
  };
}

// Validates + normalises a scheme payload. Returns { error } or { data }.
function parseSchemePayload(body) {
  const source = body || {};
  const name = clean(source.name);

  if (!name) return { error: "Scheme name is required." };

  const description = clean(source.description).slice(0, 500);

  const discountType =
    source.discountType === "percent"
      ? "percent"
      : source.discountType === "flat"
      ? "flat"
      : null;

  if (!discountType) {
    return { error: "Discount type must be 'percent' or 'flat'." };
  }

  const discountValue = Number(source.discountValue);

  if (!Number.isFinite(discountValue) || discountValue < 0) {
    return { error: "Discount value must be zero or more." };
  }

  if (discountType === "percent" && discountValue > 100) {
    return { error: "A percent discount cannot exceed 100%." };
  }

  const rawIds = Array.isArray(source.productIds) ? source.productIds : [];
  const productIds = [
    ...new Set(rawIds.map(Number).filter((value) => Number.isInteger(value))),
  ].slice(0, 50);

  const startDate = clean(source.startDate) || null;
  const endDate = clean(source.endDate) || null;
  const isoDate = /^\d{4}-\d{2}-\d{2}$/;

  if (startDate && !isoDate.test(startDate)) {
    return { error: "Start date must be in YYYY-MM-DD format." };
  }

  if (endDate && !isoDate.test(endDate)) {
    return { error: "End date must be in YYYY-MM-DD format." };
  }

  if (startDate && endDate && endDate < startDate) {
    return { error: "End date must be on or after the start date." };
  }

  return {
    data: { name, description, discountType, discountValue, productIds, startDate, endDate },
  };
}

// =====================================================
// SELLER SCHEME ROUTES — ownership enforced server-side
// =====================================================

businessRouter.get(
  "/api/sellers/schemes",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const rows = db
        .prepare(`SELECT * FROM seller_schemes WHERE sellerId = ? ORDER BY id DESC`)
        .all(req.user.sellerId);

      res.json({ success: true, schemes: rows.map(publicScheme) });
    } catch (error) {
      console.error("Seller schemes list error:", error);
      res.status(500).json({ success: false, message: "Failed to load schemes." });
    }
  }
);

// Create — always Draft. There is no seller path to an active scheme.
businessRouter.post(
  "/api/sellers/schemes",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const parsed = parseSchemePayload(req.body);

      if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error });
      }

      const data = parsed.data;
      const timestamp = now();

      const result = db
        .prepare(`
          INSERT INTO seller_schemes
            (sellerId, name, description, discountType, discountValue,
             productIds, startDate, endDate, status, adminNote, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'Draft', '', ?, ?)
        `)
        .run(
          req.user.sellerId,
          data.name,
          data.description,
          data.discountType,
          data.discountValue,
          JSON.stringify(data.productIds),
          data.startDate,
          data.endDate,
          timestamp,
          timestamp
        );

      const row = db
        .prepare(`SELECT * FROM seller_schemes WHERE id = ?`)
        .get(result.lastInsertRowid);

      res.json({ success: true, scheme: publicScheme(row) });
    } catch (error) {
      console.error("Seller scheme create error:", error);
      res.status(500).json({ success: false, message: "Failed to create scheme." });
    }
  }
);

// Update — own schemes only, and only while Draft/Rejected.
businessRouter.put(
  "/api/sellers/schemes/:id",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const row = db
        .prepare(`SELECT * FROM seller_schemes WHERE id = ? AND sellerId = ?`)
        .get(id, req.user.sellerId);

      if (!row) {
        return res.status(404).json({ success: false, message: "Scheme not found." });
      }

      if (!SCHEME_EDITABLE_STATUSES.includes(row.status)) {
        return res.status(409).json({
          success: false,
          message: `A ${row.status} scheme cannot be edited by the seller.`,
        });
      }

      const parsed = parseSchemePayload(req.body);

      if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error });
      }

      const data = parsed.data;
      const timestamp = now();

      db.prepare(`
        UPDATE seller_schemes
        SET name = ?, description = ?, discountType = ?, discountValue = ?,
            productIds = ?, startDate = ?, endDate = ?, updatedAt = ?
        WHERE id = ? AND sellerId = ?
      `).run(
        data.name,
        data.description,
        data.discountType,
        data.discountValue,
        JSON.stringify(data.productIds),
        data.startDate,
        data.endDate,
        timestamp,
        id,
        req.user.sellerId
      );

      const updated = db
        .prepare(`SELECT * FROM seller_schemes WHERE id = ?`)
        .get(id);

      res.json({ success: true, scheme: publicScheme(updated) });
    } catch (error) {
      console.error("Seller scheme update error:", error);
      res.status(500).json({ success: false, message: "Failed to update scheme." });
    }
  }
);

// Submit for approval — Draft/Rejected → Pending Approval.
businessRouter.post(
  "/api/sellers/schemes/:id/submit",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    try {
      const id = Number(req.params.id);

      const row = db
        .prepare(`SELECT * FROM seller_schemes WHERE id = ? AND sellerId = ?`)
        .get(id, req.user.sellerId);

      if (!row) {
        return res.status(404).json({ success: false, message: "Scheme not found." });
      }

      if (!SCHEME_EDITABLE_STATUSES.includes(row.status)) {
        return res.status(409).json({
          success: false,
          message: `Only Draft or Rejected schemes can be submitted (this one is ${row.status}).`,
        });
      }

      if (!row.endDate) {
        return res.status(400).json({
          success: false,
          message: "An end date is required before submitting a scheme.",
        });
      }

      const today = new Date().toISOString().slice(0, 10);

      if (row.endDate < today) {
        return res.status(400).json({
          success: false,
          message: "The end date is in the past — update the scheme before submitting.",
        });
      }

      let productIds = [];

      try {
        const parsedIds = JSON.parse(row.productIds || "[]");
        if (Array.isArray(parsedIds)) productIds = parsedIds;
      } catch {
        productIds = [];
      }

      if (productIds.length === 0) {
        return res.status(400).json({
          success: false,
          message: "Select at least one product before submitting.",
        });
      }

      db.prepare(`
        UPDATE seller_schemes
        SET status = 'Pending Approval', adminNote = '', updatedAt = ?
        WHERE id = ? AND sellerId = ?
      `).run(now(), id, req.user.sellerId);

      const updated = db
        .prepare(`SELECT * FROM seller_schemes WHERE id = ?`)
        .get(id);

      res.json({ success: true, scheme: publicScheme(updated) });
    } catch (error) {
      console.error("Seller scheme submit error:", error);
      res.status(500).json({ success: false, message: "Failed to submit scheme." });
    }
  }
);

// =====================================================
// ADMIN SCHEME APPROVAL — the only path to an active scheme.
// (Path prefix /api/admin/seller-schemes avoids colliding with the
// existing /api/admin/sellers/:id literal-parameter route.)
// =====================================================

businessRouter.get(
  "/api/admin/seller-schemes",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const rows = db
        .prepare(`SELECT * FROM seller_schemes ORDER BY id DESC LIMIT 500`)
        .all();

      const filter = clean(req.query.status);
      const schemes = rows
        .map(publicScheme)
        .filter((scheme) => !filter || scheme.status === filter);

      res.json({ success: true, schemes });
    } catch (error) {
      console.error("Admin schemes list error:", error);
      res.status(500).json({ success: false, message: "Failed to load schemes." });
    }
  }
);

businessRouter.post(
  "/api/admin/seller-schemes/:id/approve",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = db.prepare(`SELECT * FROM seller_schemes WHERE id = ?`).get(id);

      if (!row) {
        return res.status(404).json({ success: false, message: "Scheme not found." });
      }

      if (row.status !== "Pending Approval") {
        return res.status(409).json({
          success: false,
          message: `Only schemes Pending Approval can be approved (this one is ${row.status}).`,
        });
      }

      db.prepare(`
        UPDATE seller_schemes
        SET status = 'Approved', adminNote = ?, updatedAt = ?
        WHERE id = ?
      `).run(clean(req.body?.note) || row.adminNote || "", now(), id);

      const updated = db.prepare(`SELECT * FROM seller_schemes WHERE id = ?`).get(id);

      res.json({ success: true, scheme: publicScheme(updated) });
    } catch (error) {
      console.error("Admin scheme approve error:", error);
      res.status(500).json({ success: false, message: "Failed to approve scheme." });
    }
  }
);

businessRouter.post(
  "/api/admin/seller-schemes/:id/reject",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const row = db.prepare(`SELECT * FROM seller_schemes WHERE id = ?`).get(id);

      if (!row) {
        return res.status(404).json({ success: false, message: "Scheme not found." });
      }

      if (row.status !== "Pending Approval") {
        return res.status(409).json({
          success: false,
          message: `Only schemes Pending Approval can be rejected (this one is ${row.status}).`,
        });
      }

      db.prepare(`
        UPDATE seller_schemes
        SET status = 'Rejected', adminNote = ?, updatedAt = ?
        WHERE id = ?
      `).run(clean(req.body?.note) || "Rejected by admin", now(), id);

      const updated = db.prepare(`SELECT * FROM seller_schemes WHERE id = ?`).get(id);

      res.json({ success: true, scheme: publicScheme(updated) });
    } catch (error) {
      console.error("Admin scheme reject error:", error);
      res.status(500).json({ success: false, message: "Failed to reject scheme." });
    }
  }
);

// =====================================================
// CHARGES & TAX SETTINGS (delivery, platform fee, GST)
// =====================================================
// Additive module — the single source of truth for order-level
// charges and category-wise GST:
//   - Delivery charge: flat ₹ or % of order value, free-above
//     threshold, optional order-value band / delivery-method rules.
//   - Platform fee: flat ₹ or %, charged on a per_order OR
//     per_product basis — exactly once, never in both places.
//   - GST: admin category rates (default) + product-level override
//     (HSN/GST classification), inclusive/exclusive pricing,
//     CGST/SGST (intra-state) vs IGST (inter-state) breakup.
//   - Unclear classifications are FLAGGED for review; a rate is
//     never guessed (0% until an admin classifies the product).
// Defaults reproduce the legacy pricing byte-for-byte (platform 5%,
// delivery ₹40, GST 0% exclusive) so existing tests/flows keep
// passing until an admin changes a setting.
// Old orders are NEVER rewritten: every order snapshots its full
// breakdown into orders.chargesJson at placement time.

const GST_RATE_SLABS = [0, 0.1, 0.25, 1.5, 3, 5, 12, 18, 28];

const INDIAN_STATES = [
  "Andhra Pradesh", "Arunachal Pradesh", "Assam", "Bihar", "Chhattisgarh",
  "Goa", "Gujarat", "Haryana", "Himachal Pradesh", "Jharkhand", "Karnataka",
  "Kerala", "Madhya Pradesh", "Maharashtra", "Manipur", "Meghalaya", "Mizoram",
  "Nagaland", "Odisha", "Punjab", "Rajasthan", "Sikkim", "Tamil Nadu",
  "Telangana", "Tripura", "Uttar Pradesh", "Uttarakhand", "West Bengal",
  "Andaman and Nicobar Islands", "Chandigarh", "Dadra and Nagar Haveli and Daman and Diu",
  "Delhi", "Jammu and Kashmir", "Ladakh", "Lakshadweep", "Puducherry",
];

const STATE_ALIASES = {
  orissa: "Odisha",
  uttaranchal: "Uttarakhand",
  "nct of delhi": "Delhi",
  delhi: "Delhi",
  pondicherry: "Puducherry",
  "jammu & kashmir": "Jammu and Kashmir",
};

const DEFAULT_DELIVERY_SETTINGS = {
  mode: "flat", // flat ₹ | percent of order value
  value: 40,
  freeAboveOrderValue: 0, // 0 = never free
  rules: [], // [{ method, minOrderValue, maxOrderValue, mode, value }]
};

const DEFAULT_PLATFORM_FEE_SETTINGS = {
  enabled: true,
  mode: "percent", // percent | flat
  value: 5,
  basis: "per_product", // per_product (per unit) | per_order (once)
};

const DEFAULT_GST_SETTINGS = {
  originState: "", // place-of-supply origin → decides CGST/SGST vs IGST
  priceIncludesGst: false,
};

db.prepare(`
  CREATE TABLE IF NOT EXISTS charges_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    previousValue TEXT,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS category_gst_rates (
    category TEXT PRIMARY KEY,
    gstRate REAL NOT NULL,
    hsnCode TEXT DEFAULT '',
    updatedAt TEXT
  )
`).run();

// GST mapping store (category / subcategory / HSN) with approval gate,
// effective dates and an append-only audit history. Existing legacy
// category rates are backfilled as approved rows inside this call.
initGstMappings();

// orders.chargesJson — additive column (guarded, existing DBs included).
{
  const columns = db.prepare("PRAGMA table_info(orders)").all();
  if (!columns.some((column) => column.name === "chargesJson")) {
    db.prepare("ALTER TABLE orders ADD COLUMN chargesJson TEXT").run();
  }
}

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

function sanitizePriceNumber(value) {
  return Math.max(0, Number(String(value ?? "").replace(/[^0-9.]/g, "")) || 0);
}

// ------------------------------------------
// Settings storage (current + previous value)
// ------------------------------------------

function readChargeSetting(key) {
  const row = db
    .prepare(`SELECT value, previousValue FROM charges_settings WHERE key = ?`)
    .get(key);

  if (!row) return { current: null, previous: null };

  const parse = (raw) => {
    if (!raw) return null;
    try {
      return JSON.parse(raw);
    } catch {
      return null;
    }
  };

  return { current: parse(row.value), previous: parse(row.previousValue) };
}

function writeChargeSetting(key, next) {
  const before = readChargeSetting(key).current;
  const timestamp = now();

  db.prepare(`
    INSERT INTO charges_settings (key, value, previousValue, updatedAt)
    VALUES (?, ?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET
      value = excluded.value,
      previousValue = charges_settings.value,
      updatedAt = excluded.updatedAt
  `).run(key, JSON.stringify(next), before ? JSON.stringify(before) : null, timestamp);

  return before;
}

// Legacy pricing_settings (deliveryFlat/platformPercent) is honoured
// until an admin saves an explicit charges setting — no silent reset
// of an existing local configuration.
function getDeliverySettings() {
  const stored = readChargeSetting("delivery").current;
  if (stored) return { ...DEFAULT_DELIVERY_SETTINGS, ...stored };
  return {
    ...DEFAULT_DELIVERY_SETTINGS,
    value: Number(getPricingRules().deliveryFlat) || DEFAULT_DELIVERY_SETTINGS.value,
  };
}

function getPlatformFeeSettings() {
  const stored = readChargeSetting("platform_fee").current;
  if (stored) return { ...DEFAULT_PLATFORM_FEE_SETTINGS, ...stored };
  return {
    ...DEFAULT_PLATFORM_FEE_SETTINGS,
    value: Number(getPricingRules().platformPercent) || DEFAULT_PLATFORM_FEE_SETTINGS.value,
  };
}

function getGstSettings() {
  const stored = readChargeSetting("gst").current;
  if (stored) return { ...DEFAULT_GST_SETTINGS, ...stored };
  return { ...DEFAULT_GST_SETTINGS };
}

function getCategoryGstRates() {
  return db
    .prepare(`SELECT category, gstRate, hsnCode, updatedAt FROM category_gst_rates ORDER BY category`)
    .all();
}

function getCategoryGstRate(category) {
  const key = clean(category);
  if (!key) return null;
  return (
    db
      .prepare(`SELECT category, gstRate, hsnCode, updatedAt FROM category_gst_rates WHERE category = ?`)
      .get(key) || null
  );
}

// ------------------------------------------
// Validation — strict, no guessed values
// ------------------------------------------

function isValidGstSlab(rate) {
  const value = Number(rate);
  return GST_RATE_SLABS.some((slab) => Math.abs(value - slab) < 1e-9);
}

function normalizeStateName(value) {
  const raw = clean(value).toLowerCase().replace(/\s+/g, " ").trim();
  if (!raw) return "";
  if (STATE_ALIASES[raw]) return STATE_ALIASES[raw];
  const match = INDIAN_STATES.find((state) => state.toLowerCase() === raw);
  return match || ""; // unknown → caller flags; never guessed
}

function validateChargeValue(mode, value, label) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric) || numeric < 0) {
    return `${label} must be zero or more.`;
  }
  if (mode === "percent" && numeric > 100) {
    return `${label} percentage cannot exceed 100%.`;
  }
  if (mode === "flat" && numeric > 100000) {
    return `${label} cannot exceed ₹100000.`;
  }
  return null;
}

function validateDeliverySettings(body) {
  const source = body || {};
  const mode = source.mode === "flat" ? "flat" : source.mode === "percent" ? "percent" : null;
  if (!mode) return { error: "Delivery mode must be 'flat' or 'percent'." };

  const valueError = validateChargeValue(mode, source.value, "Delivery charge");
  if (valueError) return { error: valueError };

  const freeAbove = Number(source.freeAboveOrderValue ?? 0);
  if (!Number.isFinite(freeAbove) || freeAbove < 0 || freeAbove > 10000000) {
    return { error: "Free-delivery threshold must be zero or more." };
  }

  const rawRules = Array.isArray(source.rules) ? source.rules : [];
  if (rawRules.length > 20) return { error: "At most 20 delivery rules are allowed." };

  const rules = [];
  for (let i = 0; i < rawRules.length; i += 1) {
    const rule = rawRules[i] || {};
    const ruleMode = rule.mode === "flat" ? "flat" : rule.mode === "percent" ? "percent" : null;
    if (!ruleMode) return { error: `Rule ${i + 1}: mode must be 'flat' or 'percent'.` };

    const ruleError = validateChargeValue(ruleMode, rule.value, `Rule ${i + 1}`);
    if (ruleError) return { error: ruleError };

    const min = Number(rule.minOrderValue ?? 0);
    if (!Number.isFinite(min) || min < 0) {
      return { error: `Rule ${i + 1}: minimum order value must be zero or more.` };
    }

    const maxRaw = rule.maxOrderValue;
    const max =
      maxRaw === null || maxRaw === undefined || maxRaw === "" ? null : Number(maxRaw);
    if (max !== null && (!Number.isFinite(max) || max < 0)) {
      return { error: `Rule ${i + 1}: maximum order value must be zero or more.` };
    }
    if (max !== null && max < min) {
      return { error: `Rule ${i + 1}: maximum order value must be at least the minimum.` };
    }

    rules.push({
      method: clean(rule.method).slice(0, 40),
      minOrderValue: min,
      maxOrderValue: max,
      mode: ruleMode,
      value: Number(rule.value),
    });
  }

  return { data: { mode, value: Number(source.value), freeAboveOrderValue: freeAbove, rules } };
}

function validatePlatformFeeSettings(body) {
  const source = body || {};
  const mode = source.mode === "flat" ? "flat" : source.mode === "percent" ? "percent" : null;
  if (!mode) return { error: "Platform fee mode must be 'flat' or 'percent'." };

  const valueError = validateChargeValue(mode, source.value, "Platform fee");
  if (valueError) return { error: valueError };

  const basis =
    source.basis === "per_order" ? "per_order" : source.basis === "per_product" ? "per_product" : null;
  if (!basis) return { error: "Platform fee basis must be 'per_order' or 'per_product'." };

  const enabled = source.enabled === undefined ? true : Boolean(source.enabled);

  return { data: { enabled, mode, value: Number(source.value), basis } };
}

function validateGstSettings(body) {
  const source = body || {};
  const rawOrigin = source.originState === undefined ? undefined : clean(source.originState);

  let originState = "";
  if (rawOrigin !== undefined && rawOrigin !== "") {
    originState = normalizeStateName(rawOrigin);
    if (!originState) {
      return { error: "Origin state must be a valid Indian state or union territory." };
    }
  }

  const priceIncludesGst =
    source.priceIncludesGst === undefined ? false : Boolean(source.priceIncludesGst);

  return { data: { originState, priceIncludesGst } };
}

// ------------------------------------------
// GST resolution (product → category → flag)
// ------------------------------------------

export function resolveProductGst(productLike) {
  // PAN/GST seller tax treatment is authoritative: an unregistered
  // seller's product is 0% and never inherits a category/HSN GST rate.
  if (clean(productLike.taxTreatment) === "non_gst") {
    return {
      gstRate: 0,
      source: "non_gst",
      gstType: "exclusive",
      priceIncludesGst: false,
      hsnCode: clean(productLike.hsnCode || ""),
      needsReview: false,
      flags: [],
    };
  }

  if (clean(productLike.taxTreatment) === "blocked") {
    return {
      gstRate: 0,
      source: "none",
      gstType: "exclusive",
      priceIncludesGst: false,
      hsnCode: clean(productLike.hsnCode || ""),
      needsReview: false,
      flags: [],
    };
  }

  const category = clean(productLike.category);
  const subCategory = clean(productLike.subCategory ?? productLike.subcategory);
  const declared = productLike.gstSource || null; // 'product' | 'category' | 'none' | null(legacy)
  const rawRate = Number(productLike.gstRate) || 0;
  const ownHsn = clean(productLike.hsnCode || "");
  const gstCfg = getGstSettings();
  const productGstType = clean(productLike.gstType).toLowerCase();

  // GST type is snapshotted per product only when an admin sets it;
  // otherwise the global admin setting is inherited.
  const priceIncludesGst =
    productGstType === "inclusive"
      ? true
      : productGstType === "exclusive"
      ? false
      : Boolean(gstCfg.priceIncludesGst);

  // Admin-verified mapping: HSN → subcategory → category, and only a
  // currently-effective approved row. A rate is never guessed.
  const found = findApprovedMapping({ category, subCategory, hsnCode: ownHsn });
  const mapping = found.mapping;
  const hsnMismatch = Boolean(found.hsnMismatch);

  const legacyCategoryRate = getCategoryGstRate(category);

  const noHsnFlag =
    ownHsn || (mapping && mapping.hsnCode) || (legacyCategoryRate && legacyCategoryRate.hsnCode)
      ? []
      : ["no_hsn"];

  const declaredProduct = declared === "product" || declared === "product_unverified";
  const productClaim =
    (declaredProduct || (declared === null && rawRate > 0)) && rawRate > 0;
  const validProductRate = rawRate > 0 && isValidGstSlab(rawRate);
  // 2 = explicit admin classification, 1 = approved with the product,
  // 0 = seller proposal that has not been reviewed yet.
  const overrideApproved = Number(productLike.gstApproved) || 0;

  const inheritedHsn =
    ownHsn || (mapping ? mapping.hsnCode : "") || (legacyCategoryRate ? legacyCategoryRate.hsnCode : "");

  // 1. An explicit admin classification (GST Manager product editor,
  //    gstApproved = 2) wins over every mapping — it is the most
  //    specific, individually reviewed classification.
  if (productClaim && validProductRate && overrideApproved === 2) {
    return {
      gstRate: rawRate,
      source: "product",
      gstType: productGstType || null,
      priceIncludesGst,
      hsnCode: inheritedHsn,
      needsReview: noHsnFlag.length > 0,
      flags: noHsnFlag,
    };
  }

  // 2. Approved HSN / subcategory / category mapping.
  //    A mapping tied to a DIFFERENT HSN is never applied.
  if (mapping && !hsnMismatch) {
    const flags = [...noHsnFlag];
    if (productClaim && !validProductRate) flags.unshift("invalid_product_rate");
    // A seller-entered rate that disagrees with the approved mapping is
    // never applied — but it is reported so an admin can correct it.
    if (
      productClaim &&
      validProductRate &&
      Math.abs(rawRate - Number(mapping.gstRate)) > 1e-9
    ) {
      flags.unshift("seller_rate_ignored");
    }
    return {
      gstRate: Number(mapping.gstRate) || 0,
      source: found.level,
      gstType: productGstType || mapping.gstType || null,
      priceIncludesGst,
      hsnCode: inheritedHsn,
      needsReview: flags.length > 0,
      flags,
    };
  }

  // 3. Product rate approved together with the product (gstApproved = 1)
  //    applies ONLY when no approved mapping covers the product — an
  //    approved mapping is never overridden by a seller-entered rate.
  if (productClaim && validProductRate && overrideApproved === 1) {
    return {
      gstRate: rawRate,
      source: "product",
      gstType: productGstType || null,
      priceIncludesGst,
      hsnCode: inheritedHsn,
      needsReview: noHsnFlag.length > 0,
      flags: noHsnFlag,
    };
  }

  // 4. HSN mismatch against the category/subcategory mapping: the
  //    category rate must NOT be applied to a differently-classified
  //    product. A product's own (review-flagged) rate may still apply.
  if (hsnMismatch) {
    const flags = ["hsn_mismatch", ...noHsnFlag];
    if (productClaim && validProductRate) {
      flags.unshift("product_rate_unverified");
      return {
        gstRate: rawRate,
        source: "product",
        gstType: productGstType || null,
        priceIncludesGst,
        hsnCode: ownHsn,
        needsReview: true,
        flags,
      };
    }
    return {
      gstRate: 0,
      source: "none",
      gstType: productGstType || null,
      priceIncludesGst,
      hsnCode: ownHsn,
      needsReview: true,
      flags,
    };
  }

  // 5. A seller product rate is used only as an unverified fallback —
  //    it never overrides an approved mapping and always flags review.
  if (productClaim && validProductRate) {
    return {
      gstRate: rawRate,
      source: "product_unverified",
      gstType: productGstType || null,
      priceIncludesGst,
      hsnCode: inheritedHsn,
      needsReview: true,
      flags: ["product_rate_unverified", ...noHsnFlag],
    };
  }

  // 6. Legacy category row (pre-mapping table) — still admin-set.
  if (legacyCategoryRate) {
    return {
      gstRate: Number(legacyCategoryRate.gstRate) || 0,
      source: "category",
      gstType: productGstType || null,
      priceIncludesGst,
      hsnCode: inheritedHsn,
      needsReview: noHsnFlag.length > 0,
      flags: noHsnFlag,
    };
  }

  // Nothing classifies this product → 0% + review flag (NO guessing).
  const flags = [...noHsnFlag, "no_category_rate"];
  if (rawRate > 0 && !isValidGstSlab(rawRate)) flags.push("invalid_rate");
  if (rawRate > 0 && isValidGstSlab(rawRate) && declared === "category") {
    flags.push("stale_rate"); // rate row was cleared by the admin
  }

  return {
    gstRate: 0,
    source: "none",
    gstType: productGstType || null,
    priceIncludesGst,
    hsnCode: ownHsn,
    needsReview: true,
    flags,
  };
}

// Human-readable GST review state for the admin report. A product is
// Verified only when it has a rate AND no review flags. Any conflicting
// classification (wrong HSN, invalid slab, unverified seller rate) is
// Incorrect; a missing classification is Missing.
function gstReviewStatus(resolved) {
  if (!resolved.needsReview) return "Verified";
  const flags = resolved.flags || [];
  const incorrectFlags = [
    "invalid_product_rate",
    "invalid_rate",
    "stale_rate",
    "hsn_mismatch",
    "product_rate_unverified",
    "seller_rate_ignored",
  ];
  return flags.some((flag) => incorrectFlags.includes(flag)) ? "Incorrect" : "Missing";
}

// ------------------------------------------
// Delivery charge (order level)
// ------------------------------------------

function computeDeliveryCharge({ orderValue, deliveryMethod, cfg }) {
  if (!cfg) return 0;

  // The free-above threshold always wins (buyer-friendly, documented).
  if (cfg.freeAboveOrderValue > 0 && orderValue >= cfg.freeAboveOrderValue) {
    return 0;
  }

  const method = String(deliveryMethod || "standard").trim().toLowerCase();
  const rule = (cfg.rules || []).find((candidate) => {
    const ruleMethod = String(candidate.method || "").trim().toLowerCase();
    if (ruleMethod && ruleMethod !== method) return false;

    const min = Number(candidate.minOrderValue) || 0;
    const max = candidate.maxOrderValue;
    if (orderValue < min) return false;
    if (max !== null && max !== undefined && Number.isFinite(Number(max)) && orderValue > Number(max)) {
      return false;
    }
    return true;
  });

  const source = rule || { mode: cfg.mode, value: cfg.value };
  return source.mode === "percent"
    ? (orderValue * Number(source.value)) / 100
    : Number(source.value);
}

// ------------------------------------------
// Tax breakup (CGST/SGST vs IGST, incl/excl)
// ------------------------------------------

function computeTaxBreakup(itemLines, extras, gstCfg, destinationStateRaw) {
  const inclusive = Boolean(gstCfg.priceIncludesGst);
  const extrasTotal = Number(extras.platform || 0) + Number(extras.mlm || 0) + Number(extras.delivery || 0);

  // Group item bases by GST slab AND by the product's inclusive /
  // exclusive mode, so a mixed cart taxes every line correctly.
  const slabs = new Map();
  let totalBase = 0;
  for (const line of itemLines) {
    totalBase += line.lineBase;
    const lineInclusive =
      line.gst.priceIncludesGst === undefined || line.gst.priceIncludesGst === null
        ? inclusive
        : Boolean(line.gst.priceIncludesGst);
    const key = `${round2(line.gst.gstRate)}|${lineInclusive ? "inclusive" : "exclusive"}`;
    if (!slabs.has(key)) {
      slabs.set(key, { gstRate: line.gst.gstRate, inclusive: lineInclusive, base: 0 });
    }
    slabs.get(key).base += line.lineBase;
  }

  // Allocate order-level extras across slabs proportionally, with the
  // residual assigned to the final slab so the parts always sum
  // exactly to the whole (no paise drift between lines and totals).
  const slabList = [...slabs.values()];
  let allocated = 0;
  const lines = slabList.map((slab, index) => {
    const share =
      index === slabList.length - 1
        ? round2(extrasTotal - allocated)
        : totalBase > 0
        ? round2((slab.base / totalBase) * extrasTotal)
        : 0;
    allocated = round2(allocated + share);

    const gross = round2(slab.base + share);
    let taxableValue;
    let gstAmount;

    if (slab.inclusive) {
      taxableValue = round2(gross / (1 + slab.gstRate / 100));
      gstAmount = round2(gross - taxableValue);
    } else {
      taxableValue = gross;
      gstAmount = round2((taxableValue * slab.gstRate) / 100);
    }

    return {
      gstRate: Number(slab.gstRate) || 0,
      inclusive: slab.inclusive,
      taxableValue,
      gstAmount,
      lineTotal: round2(taxableValue + gstAmount),
      cgst: null,
      sgst: null,
      igst: null,
    };
  });

  // Intra-state (same state) → CGST + SGST halves.
  // Inter-state → IGST. Unknown/missing states → NO split is guessed;
  // the line is flagged and only the total GST is shown.
  const origin = normalizeStateName(gstCfg.originState);
  const destination = normalizeStateName(destinationStateRaw);

  let splitMode;
  if (!origin) splitMode = "origin_unconfigured";
  else if (!destination) splitMode = "destination_unknown";
  else splitMode = origin === destination ? "intra" : "inter";

  for (const line of lines) {
    if (splitMode === "intra") {
      line.cgst = round2(line.gstAmount / 2);
      line.sgst = round2(line.gstAmount - line.cgst);
      line.igst = 0;
    } else if (splitMode === "inter") {
      line.igst = line.gstAmount;
      line.cgst = 0;
      line.sgst = 0;
    }
  }

  const totals = {
    taxableValue: round2(lines.reduce((sum, line) => sum + line.taxableValue, 0)),
    gstAmount: round2(lines.reduce((sum, line) => sum + line.gstAmount, 0)),
    lineTotal: round2(lines.reduce((sum, line) => sum + line.lineTotal, 0)),
    cgst: splitMode === "intra" ? round2(lines.reduce((sum, line) => sum + line.cgst, 0)) : null,
    sgst: splitMode === "intra" ? round2(lines.reduce((sum, line) => sum + line.sgst, 0)) : null,
    igst: splitMode === "inter" ? round2(lines.reduce((sum, line) => sum + line.igst, 0)) : null,
    splitMode,
    originState: origin || null,
    destinationState: destination || null,
  };

  return { inclusive, lines, totals };
}

// ------------------------------------------
// Order totals — THE single source of truth
// ------------------------------------------

function calculateOrderTotals(resolvedItems, { state, deliveryMethod } = {}) {
  const platformCfg = getPlatformFeeSettings();
  const deliveryCfg = getDeliverySettings();
  const gstCfg = getGstSettings();
  const rules = getPricingRules(); // mlmPercent — commission logic untouched

  const items = resolvedItems.map(({ product, quantity }) => {
    const qty = Math.max(1, Math.min(99, Number(quantity) || 1));
    const base = sanitizePriceNumber(product.price);
    const compare = sanitizePriceNumber(product.comparePrice);
    const gst = resolveProductGst(product);

    return {
      productId: product.id,
      name: product.name,
      quantity: qty,
      base,
      lineBase: round2(base * qty),
      comparePrice: compare > 0 ? compare : null,
      discountLine: compare > base ? round2((compare - base) * qty) : 0,
      gst,
    };
  });

  const itemsGross = round2(items.reduce((sum, item) => sum + item.lineBase, 0));
  const discountTotal = round2(items.reduce((sum, item) => sum + item.discountLine, 0));

  // ---- Platform fee: charged on EXACTLY ONE basis, never both ----
  let platformFee = 0;
  if (platformCfg.enabled) {
    if (platformCfg.basis === "per_order") {
      platformFee =
        platformCfg.mode === "flat"
          ? platformCfg.value
          : (itemsGross * platformCfg.value) / 100;
    } else {
      platformFee = items.reduce((sum, item) => {
        const perUnit =
          platformCfg.mode === "flat"
            ? platformCfg.value
            : (item.base * platformCfg.value) / 100;
        return sum + perUnit * item.quantity;
      }, 0);
    }
  }

  platformFee = round2(platformFee);

  // MLM commission: same formula as always (percent of base per unit).
  const mlmCommission = round2(
    items.reduce((sum, item) => sum + (item.lineBase * rules.mlmPercent) / 100, 0)
  );

  const deliveryCharge = round2(
    computeDeliveryCharge({
      orderValue: itemsGross,
      deliveryMethod,
      cfg: deliveryCfg,
    })
  );

  const tax = computeTaxBreakup(
    items,
    { platform: platformFee, mlm: mlmCommission, delivery: deliveryCharge },
    gstCfg,
    state
  );

  // Grand total = exact sum of the tax lines (exclusive: taxable+GST;
  // inclusive: the GST is already inside the same figure).
  const grandTotal = round2(tax.lines.reduce((sum, line) => sum + line.lineTotal, 0));

  const needsReview = items
    .filter((item) => item.gst.needsReview)
    .map((item) => ({ productId: item.productId, name: item.name, flags: item.gst.flags }));

  return {
    items,
    baseTotal: itemsGross,
    discountTotal,
    // Buyer-facing "product price" row: base price + the embedded
    // membership commission (component detail kept for admin records).
    itemsTotal: round2(itemsGross + mlmCommission),
    mlmCommission,
    platformFee,
    platformBasis: platformCfg.basis,
    platformEnabled: Boolean(platformCfg.enabled),
    deliveryCharge,
    deliveryMethod: clean(deliveryMethod) || "Standard",
    tax,
    grandTotal,
    destinationState: clean(state) || null,
    priceIncludesGst: Boolean(gstCfg.priceIncludesGst),
    needsReview,
  };
}

// ------------------------------------------
// Immutable per-seller invoice snapshots
// ------------------------------------------
// This is a data record, not a statutory PDF generator. GST invoices
// are per seller; a GST-unregistered seller gets a NON_GST_INVOICE with
// zero tax fields and no GSTIN. Once written, a row is never updated.
function createOrderInvoices({ orderId, orderNumber, resolvedItems, totals, destinationState }) {
  const groups = new Map();
  for (const { product, quantity } of resolvedItems) {
    const key = String(product.sellerId ?? "unassigned");
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push({ product, quantity });
  }

  let index = 0;

  for (const [sellerRef, lines] of groups) {
    index += 1;
    const profile = getSellerTaxProfile(sellerRef);
    const eligibility = profile?.eligibility || {
      legacy: true,
      taxTreatment: "legacy",
      invoiceType: INVOICE_TYPE.TAX,
    };
    const isNonGst = eligibility.taxTreatment === "non_gst";

    let taxableValue = 0;
    let gstAmount = 0;
    const lineSnapshots = [];

    for (const { product, quantity } of lines) {
      const qty = Math.max(1, Math.min(99, Number(quantity) || 1));
      const base = round2(sanitizePriceNumber(product.price) * qty);
      const gst = resolveProductGst(product);
      const inclusive = Boolean(gst.priceIncludesGst);
      const lineTaxable = isNonGst
        ? base
        : inclusive
        ? round2(base / (1 + Number(gst.gstRate || 0) / 100))
        : base;
      const lineGst = isNonGst
        ? 0
        : round2(inclusive ? base - lineTaxable : (lineTaxable * Number(gst.gstRate || 0)) / 100);

      taxableValue = round2(taxableValue + lineTaxable);
      gstAmount = round2(gstAmount + lineGst);
      lineSnapshots.push({
        productId: product.id,
        productName: product.name,
        hsnCode: product.hsnCode || null,
        quantity: qty,
        unitPrice: sanitizePriceNumber(product.price),
        taxableValue: lineTaxable,
        gstRate: isNonGst ? 0 : Number(gst.gstRate || 0),
        gstAmount: lineGst,
      });
    }

    const invoiceType = isNonGst ? INVOICE_TYPE.NON_GST : INVOICE_TYPE.TAX;
    // Split by the SELLER's State, not the platform's configured origin:
    // each seller issues its own invoice and may sit in a different State.
    const intraState = isIntraState(profile?.row, destinationState);
    const splitCgst = !isNonGst && intraState ? round2(gstAmount / 2) : 0;
    const splitSgst = !isNonGst && intraState ? round2(gstAmount - splitCgst) : 0;
    const splitIgst = !isNonGst && !intraState && profile?.row?.state && destinationState
      ? gstAmount
      : 0;
    const sellerProfileSnapshot = profile
      ? publicSellerTaxProfile(profile.row, eligibility)
      : null;

    db.prepare(`
      INSERT INTO order_invoices (
        orderId, sellerId, invoiceNumber, invoiceType, sellerName, sellerGstin,
        sellerState, placeOfSupply, taxableValue, cgst, sgst, igst, gstAmount,
        total, snapshotJson, issuedAt
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      orderId,
      sellerRef,
      `INV-${orderNumber}-${index}`,
      invoiceType,
      profile?.row?.name || profile?.row?.shopName || null,
      isNonGst ? null : profile?.row?.gstNumber || null,
      profile?.row?.state || null,
      cleanTaxText(destinationState) || null,
      taxableValue,
      splitCgst,
      splitSgst,
      splitIgst,
      gstAmount,
      round2(taxableValue + gstAmount),
      JSON.stringify({
        version: 1,
        invoiceType,
        seller: sellerProfileSnapshot,
        lines: lineSnapshots,
        note: isNonGst
          ? "Seller is not GST registered. No GST charged; this is a NON-GST invoice/bill of supply."
          : "Tax invoice snapshot. GSTIN verification/legal review required before production use.",
      }),
      now()
    );
  }
}

// ------------------------------------------
// Repricing (derived columns only — base price never changes)
// ------------------------------------------

function repriceProductRow(product) {
  const gst = resolveProductGst(product);
  const pricing = calculateCustomerPricing(product.price, gst.gstRate, gst.priceIncludesGst);

  db.prepare(`
    UPDATE products
    SET gstRate = ?, gstSource = ?, deliveryCharge = ?, platformCharge = ?,
        mlmCommission = ?, customerPrice = ?, pricingUpdatedAt = ?
    WHERE id = ?
  `).run(
    gst.gstRate,
    gst.source,
    pricing.deliveryCharge,
    pricing.platformCharge,
    pricing.mlmCommission,
    pricing.customerPrice,
    now(),
    product.id
  );
}

function repriceAllProducts() {
  const rows = db.prepare(`SELECT * FROM products`).all();
  for (const product of rows) {
    repriceProductRow(product);
  }
  return rows.length;
}

// Called when an admin approves a product. A seller-entered rate only
// becomes binding when NO approved mapping covers the product; an
// approved category/subcategory/HSN mapping is never overridden here.
export function approveProductGstClassification(productId) {
  const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(Number(productId));
  if (!product) return null;

  const rate = Number(product.gstRate) || 0;
  const productSource = ["product", "product_unverified"].includes(product.gstSource);
  if (!productSource || !(rate > 0) || !isValidGstSlab(rate)) {
    repriceProductRow(product);
    return db.prepare(`SELECT * FROM products WHERE id = ?`).get(product.id);
  }

  const found = findApprovedMapping({
    category: product.category,
    subCategory: product.subCategory,
    hsnCode: product.hsnCode,
  });

  const approvedFlag = found.mapping && !found.hsnMismatch ? 0 : 1;
  db.prepare(`UPDATE products SET gstApproved = ? WHERE id = ?`).run(approvedFlag, product.id);

  const refreshed = db.prepare(`SELECT * FROM products WHERE id = ?`).get(product.id);
  repriceProductRow(refreshed);
  return db.prepare(`SELECT * FROM products WHERE id = ?`).get(product.id);
}

// =====================================================
// ADMIN ROUTES — Charges & Tax Settings
// =====================================================

businessRouter.get(
  "/api/admin/charges/settings",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const delivery = readChargeSetting("delivery");
      const platform = readChargeSetting("platform_fee");
      const gst = readChargeSetting("gst");

      res.json({
        success: true,
        delivery: { ...DEFAULT_DELIVERY_SETTINGS, ...(delivery.current || getDeliverySettings()) },
        platformFee: {
          ...DEFAULT_PLATFORM_FEE_SETTINGS,
          ...(platform.current || getPlatformFeeSettings()),
        },
        gst: { ...DEFAULT_GST_SETTINGS, ...(gst.current || getGstSettings()) },
        previous: {
          delivery: delivery.previous,
          platformFee: platform.previous,
          gst: gst.previous,
        },
        categoryRates: getCategoryGstRates(),
        originStates: INDIAN_STATES,
        validGstSlabs: GST_RATE_SLABS,
      });
    } catch (error) {
      console.error("Charges settings read error:", error);
      res.status(500).json({ success: false, message: "Failed to load charge settings." });
    }
  }
);

businessRouter.put(
  "/api/admin/charges/delivery",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const parsed = validateDeliverySettings(req.body);
      if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error });
      }

      const previous = writeChargeSetting("delivery", parsed.data);
      const repriced = repriceAllProducts();

      res.json({
        success: true,
        message: `Delivery charge settings saved — ${repriced} product prices refreshed.`,
        delivery: parsed.data,
        previous,
      });
    } catch (error) {
      console.error("Delivery settings save error:", error);
      res.status(500).json({ success: false, message: "Failed to save delivery settings." });
    }
  }
);

businessRouter.put(
  "/api/admin/charges/platform-fee",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const parsed = validatePlatformFeeSettings(req.body);
      if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error });
      }

      const previous = writeChargeSetting("platform_fee", parsed.data);
      const repriced = repriceAllProducts();

      res.json({
        success: true,
        message: `Platform fee settings saved — ${repriced} product prices refreshed.`,
        platformFee: parsed.data,
        previous,
      });
    } catch (error) {
      console.error("Platform fee settings save error:", error);
      res.status(500).json({ success: false, message: "Failed to save platform fee settings." });
    }
  }
);

businessRouter.put(
  "/api/admin/charges/gst",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const parsed = validateGstSettings(req.body);
      if (parsed.error) {
        return res.status(400).json({ success: false, message: parsed.error });
      }

      const previous = writeChargeSetting("gst", parsed.data);
      const repriced = repriceAllProducts();

      res.json({
        success: true,
        message: `GST settings saved — ${repriced} product prices refreshed.`,
        gst: parsed.data,
        previous,
      });
    } catch (error) {
      console.error("GST settings save error:", error);
      res.status(500).json({ success: false, message: "Failed to save GST settings." });
    }
  }
);

// Category GST rates (default per category/sub-category).
businessRouter.put(
  "/api/admin/charges/gst-rates",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const category = clean(req.body?.category).slice(0, 100);
      if (!category) {
        return res.status(400).json({ success: false, message: "Category is required." });
      }

      const hsnCode = clean(req.body?.hsnCode);
      if (hsnCode && !/^\d{4,8}$/.test(hsnCode)) {
        return res.status(400).json({
          success: false,
          message: "HSN code must be 4 to 8 digits.",
        });
      }

      const rawRate = req.body?.gstRate;
      const clearing =
        rawRate === null || rawRate === undefined || rawRate === "" || Number(rawRate) === 0
          ? true
          : false;

      if (!clearing) {
        const rate = Number(rawRate);
        if (!Number.isFinite(rate) || rate < 0 || !isValidGstSlab(rate)) {
          return res.status(400).json({
            success: false,
            message: `GST rate must be one of the statutory slabs: ${GST_RATE_SLABS.join(
              "%, "
            )}%.`,
          });
        }
      }

      const actor = clean(req.user?.name || req.user?.username || "admin");

      if (clearing) {
        const rows = listGstMappings().filter(
          (mapping) => mapping.scope === "category" && mapping.category === category
        );
        for (const mapping of rows) {
          deleteGstMapping(mapping.id, actor, "Category GST rate cleared from Charges & Tax");
        }
        db.prepare(`DELETE FROM category_gst_rates WHERE category = ?`).run(category);
      } else {
        // This admin screen writes a VERIFIED mapping (the admin entered
        // the rate + HSN), so it is approved immediately and mirrored into
        // the mapping store used by the GST Manager.
        const saved = saveGstMapping(
          {
            scope: "category",
            category,
            hsnCode,
            gstRate: Number(rawRate),
            gstType: "exclusive",
            notes: "Saved from Charges & Tax category GST rates",
          },
          actor,
          { approve: true, reason: "Charges & Tax category GST save" }
        );
        if (!saved.ok) {
          return res.status(400).json({ success: false, message: saved.message });
        }
      }

      const repriced = repriceAllProducts();

      res.json({
        success: true,
        message: clearing
          ? `Category rate cleared for “${category}” — products now flag for review.`
          : `GST ${Number(rawRate)}% saved for “${category}” — ${repriced} product prices refreshed.`,
        categoryRates: getCategoryGstRates(),
      });
    } catch (error) {
      console.error("Category GST rate save error:", error);
      res.status(500).json({ success: false, message: "Failed to save category GST rate." });
    }
  }
);

// Products whose GST classification/rate is unclear — FLAGGED, never
// auto-rated. Admin fixes them with an explicit, validated rate+HSN.
businessRouter.get(
  "/api/admin/charges/gst-review",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM products ORDER BY id DESC`).all();
      const flagged = [];
      const all = [];

      for (const product of rows) {
        const resolved = resolveProductGst(product);
        const statusLabel = gstReviewStatus(resolved);
        const row = {
          id: product.id,
          name: product.name,
          sku: product.sku || "",
          category: product.category,
          subCategory: product.subCategory || "",
          sellerName: product.sellerName || "",
          hsnCode: product.hsnCode || "",
          effectiveHsn: resolved.hsnCode || "",
          gstRate: resolved.gstRate,
          gstType: resolved.priceIncludesGst ? "inclusive" : "exclusive",
          source: resolved.source,
          flags: resolved.flags,
          status: product.status,
          statusLabel,
        };
        all.push(row);
        if (resolved.needsReview) flagged.push(row);
      }

      const pendingCount = flagged.length;
      const verifiedCount = all.filter((row) => row.statusLabel === "Verified").length;
      const incorrectCount = all.filter((row) => row.statusLabel === "Incorrect").length;

      res.json({
        success: true,
        // `count`/`products` keep their original meaning: products that
        // still need GST review. `items` (all=1) feeds the full report.
        count: pendingCount,
        pendingCount,
        verifiedCount,
        incorrectCount,
        missingCount: all.filter((row) => row.statusLabel === "Missing").length,
        products: flagged,
        items: req.query.all ? all : undefined,
        validGstSlabs: GST_RATE_SLABS,
      });
    } catch (error) {
      console.error("GST review list error:", error);
      res.status(500).json({ success: false, message: "Failed to load GST review list." });
    }
  }
);

// =====================================================
// ADMIN — GST MANAGER (category / subcategory / HSN mappings)
// =====================================================

function gstCategoryTree() {
  const rows = db.prepare(`SELECT id, name, parentId FROM categories ORDER BY name`).all();
  const productCategories = db
    .prepare(`SELECT DISTINCT category FROM products WHERE COALESCE(category, '') <> ''`)
    .all()
    .map((row) => row.category);

  const names = new Set([...rows.map((row) => row.name), ...productCategories]);
  const subcategories = rows
    .filter((row) => row.parentId)
    .map((row) => {
      const parent = rows.find((candidate) => candidate.id === row.parentId);
      return { name: row.name, parent: parent?.name || "" };
    });

  return { categories: [...names].sort(), subcategories };
}

businessRouter.get(
  "/api/admin/gst/mappings",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      res.json({
        success: true,
        mappings: listGstMappings(),
        summary: getGstMappingSummary(),
        history: listGstHistory(Number(req.query.history) || 100),
        ...gstCategoryTree(),
        validGstSlabs: GST_RATE_SLABS,
        gstTypes: ["exclusive", "inclusive"],
      });
    } catch (error) {
      console.error("GST mappings list error:", error);
      res.status(500).json({ success: false, message: "Failed to load GST mappings." });
    }
  }
);

businessRouter.post(
  "/api/admin/gst/mappings",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const actor = clean(req.user?.name || req.user?.username || "admin");
      const approve = Boolean(req.body?.approve);
      const result = saveGstMapping(req.body, actor, {
        approve,
        reason: clean(req.body?.reason) || (approve ? "Saved & approved by admin" : "Saved as draft"),
      });

      if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message });

      const repriced = result.applied ? repriceAllProducts() : 0;
      res.status(201).json({
        success: true,
        message: result.message,
        mapping: result.mapping,
        repriced,
        summary: getGstMappingSummary(),
      });
    } catch (error) {
      console.error("GST mapping save error:", error);
      res.status(500).json({ success: false, message: "Failed to save GST mapping." });
    }
  }
);

businessRouter.put(
  "/api/admin/gst/mappings/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const existing = getGstMapping(req.params.id);
      if (!existing) return res.status(404).json({ success: false, message: "GST mapping not found." });

      const actor = clean(req.user?.name || req.user?.username || "admin");
      const approve = Boolean(req.body?.approve);
      const merged = { ...existing, ...(req.body || {}) };

      const result = saveGstMapping(merged, actor, {
        approve,
        reason: clean(req.body?.reason) || (approve ? "Edited & approved by admin" : "Edited — awaiting approval"),
      });

      if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message });

      const repriced = result.applied ? repriceAllProducts() : 0;
      res.json({
        success: true,
        message: result.message,
        mapping: result.mapping,
        repriced,
        summary: getGstMappingSummary(),
      });
    } catch (error) {
      console.error("GST mapping update error:", error);
      res.status(500).json({ success: false, message: "Failed to update GST mapping." });
    }
  }
);

businessRouter.post(
  "/api/admin/gst/mappings/:id/approve",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const actor = clean(req.user?.name || req.user?.username || "admin");
      const result = approveGstMapping(req.params.id, actor, clean(req.body?.reason));
      if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message });

      const repriced = repriceAllProducts();
      res.json({
        success: true,
        message: result.message,
        mapping: result.mapping,
        repriced,
        summary: getGstMappingSummary(),
      });
    } catch (error) {
      console.error("GST mapping approve error:", error);
      res.status(500).json({ success: false, message: "Failed to approve GST mapping." });
    }
  }
);

businessRouter.delete(
  "/api/admin/gst/mappings/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const actor = clean(req.user?.name || req.user?.username || "admin");
      const result = deleteGstMapping(req.params.id, actor, clean(req.body?.reason));
      if (!result.ok) return res.status(result.status || 400).json({ success: false, message: result.message });

      const repriced = repriceAllProducts();
      res.json({ success: true, message: result.message, repriced, summary: getGstMappingSummary() });
    } catch (error) {
      console.error("GST mapping delete error:", error);
      res.status(500).json({ success: false, message: "Failed to remove GST mapping." });
    }
  }
);

businessRouter.get(
  "/api/admin/gst/history",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      res.json({ success: true, history: listGstHistory(Number(req.query.limit) || 200) });
    } catch (error) {
      console.error("GST history error:", error);
      res.status(500).json({ success: false, message: "Failed to load GST change history." });
    }
  }
);

// Read-only CGST/SGST vs IGST split for the admin GST Manager preview.
// The actual order calculation stays in calculateOrderTotals (one
// implementation); this endpoint only demonstrates the split.
businessRouter.get(
  "/api/admin/gst/preview",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const rate = Number(req.query.rate);
      if (!Number.isFinite(rate) || rate < 0 || !isValidGstSlab(rate)) {
        return res.status(400).json({
          success: false,
          message: `GST rate must be one of the statutory slabs: ${GST_RATE_SLABS.join("%, ")}%.`,
        });
      }

      const gstCfg = getGstSettings();
      const origin = normalizeStateName(req.query.originState || gstCfg.originState);
      const destination = normalizeStateName(req.query.destinationState);
      const taxableValue = Math.max(0, Number(req.query.taxableValue) || 1000);
      const inclusive = String(req.query.inclusive) === "true";

      const base = inclusive ? round2(taxableValue / (1 + rate / 100)) : round2(taxableValue);
      const gstAmount = inclusive ? round2(taxableValue - base) : round2((taxableValue * rate) / 100);

      let mode = "origin_unconfigured";
      if (!origin) mode = "origin_unconfigured";
      else if (!destination) mode = "destination_unconfigured";
      else mode = origin === destination ? "intra" : "inter";

      res.json({
        success: true,
        preview: {
          rate,
          inclusive,
          originState: origin || null,
          destinationState: destination || null,
          splitMode: mode,
          taxableValue: base,
          gstAmount,
          cgst: mode === "intra" ? round2(gstAmount / 2) : null,
          sgst: mode === "intra" ? round2(gstAmount - round2(gstAmount / 2)) : null,
          igst: mode === "inter" ? gstAmount : null,
          total: inclusive ? round2(taxableValue) : round2(base + gstAmount),
        },
      });
    } catch (error) {
      console.error("GST split preview error:", error);
      res.status(500).json({ success: false, message: "Failed to preview GST split." });
    }
  }
);

// Full GST review report (all products, with Verified / Missing /
// Incorrect status), used by the GST Manager. The legacy endpoint keeps
// returning only the pending rows.
businessRouter.get(
  "/api/admin/gst/review",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const rows = db.prepare(`SELECT * FROM products ORDER BY id DESC`).all();
      const items = rows.map((product) => {
        const resolved = resolveProductGst(product);
        return {
          id: product.id,
          name: product.name,
          sku: product.sku || "",
          category: product.category || "",
          subCategory: product.subCategory || "",
          sellerName: product.sellerName || "",
          hsnCode: product.hsnCode || "",
          effectiveHsn: resolved.hsnCode || "",
          gstRate: resolved.gstRate,
          gstType: resolved.priceIncludesGst ? "inclusive" : "exclusive",
          source: resolved.source,
          flags: resolved.flags,
          status: product.status,
          statusLabel: gstReviewStatus(resolved),
        };
      });

      res.json({
        success: true,
        count: items.filter((item) => item.statusLabel !== "Verified").length,
        pendingCount: items.filter((item) => item.statusLabel !== "Verified").length,
        missingCount: items.filter((item) => item.statusLabel === "Missing").length,
        incorrectCount: items.filter((item) => item.statusLabel === "Incorrect").length,
        verifiedCount: items.filter((item) => item.statusLabel === "Verified").length,
        items,
        validGstSlabs: GST_RATE_SLABS,
      });
    } catch (error) {
      console.error("GST review report error:", error);
      res.status(500).json({ success: false, message: "Failed to load the GST review report." });
    }
  }
);

// Admin product-level GST/HSN override (validated against statutory
// slabs — an invalid classification is rejected, never guessed).
businessRouter.put(
  "/api/admin/products/:id/tax",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const id = Number(req.params.id);
      const product = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);

      if (!product) {
        return res.status(404).json({ success: false, message: "Product not found." });
      }

      const hsnRaw = req.body?.hsnCode;
      const hsnCode = hsnRaw === undefined ? product.hsnCode || "" : clean(hsnRaw);
      if (hsnCode && !/^\d{4,8}$/.test(hsnCode)) {
        return res.status(400).json({
          success: false,
          message: "HSN code must be 4 to 8 digits.",
        });
      }

      const rateRaw = req.body?.gstRate;
      let explicitRate = 0;
      if (rateRaw !== undefined && rateRaw !== null && rateRaw !== "" && Number(rateRaw) !== 0) {
        const rate = Number(rateRaw);
        if (!Number.isFinite(rate) || rate < 0 || !isValidGstSlab(rate)) {
          return res.status(400).json({
            success: false,
            message: `GST rate must be one of the statutory slabs: ${GST_RATE_SLABS.join(
              "%, "
            )}%.`,
          });
        }
        explicitRate = rate;
      } else if (rateRaw !== undefined) {
        explicitRate = 0; // explicit clear of the product override
      }

      // Optional per-product GST type. Blank = inherit the global admin
      // GST mode; an explicit value is an admin decision.
      const rawType = clean(req.body?.gstType).toLowerCase();
      if (rawType && !["exclusive", "inclusive"].includes(rawType)) {
        return res.status(400).json({
          success: false,
          message: "GST type must be 'exclusive', 'inclusive' or blank (inherit).",
        });
      }
      const gstType = rawType || clean(product.gstType) || "";

      // gstApproved = 2 → explicit admin classification; this is the only
      // path that can override an approved mapping at product level.
      const gstApproved = explicitRate > 0 ? 2 : 0;
      const gst = resolveProductGst({
        category: product.category,
        subCategory: product.subCategory,
        gstRate: explicitRate,
        hsnCode,
        gstType,
        gstSource: explicitRate > 0 ? "product" : null,
        gstApproved,
      });

      const pricing = calculateCustomerPricing(product.price, gst.gstRate, gst.priceIncludesGst);

      db.prepare(`
        UPDATE products
        SET hsnCode = ?, gstRate = ?, gstSource = ?, gstType = ?, gstApproved = ?,
            deliveryCharge = ?, platformCharge = ?, mlmCommission = ?,
            customerPrice = ?, pricingUpdatedAt = ?
        WHERE id = ?
      `).run(
        hsnCode,
        gst.gstRate,
        gst.source,
        gstType || null,
        gstApproved,
        pricing.deliveryCharge,
        pricing.platformCharge,
        pricing.mlmCommission,
        pricing.customerPrice,
        now(),
        id
      );

      const updated = db.prepare(`SELECT * FROM products WHERE id = ?`).get(id);

      res.json({
        success: true,
        message: `GST classification saved for “${product.name}”.`,
        product: updated,
        resolved: gst,
      });
    } catch (error) {
      console.error("Product tax override error:", error);
      res.status(500).json({ success: false, message: "Failed to save product tax classification." });
    }
  }
);

// Order-wise platform fee breakdown + total platform revenue.
// (Only orders placed with the new calculator carry chargesJson; older
// orders are deliberately excluded rather than back-filled.)
businessRouter.get(
  "/api/admin/charges/platform-revenue",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const rows = db
        .prepare(
          `SELECT id, orderNumber, totalAmount, chargesJson, createdAt, status
           FROM orders WHERE chargesJson IS NOT NULL ORDER BY id DESC`
        )
        .all();

      let totalCollected = 0;
      let deliveryCollected = 0;
      let gstCollected = 0;
      const recent = [];

      for (const row of rows) {
        let charges = null;
        try {
          charges = JSON.parse(row.chargesJson);
        } catch {
          charges = null;
        }
        if (!charges) continue;

        totalCollected += Number(charges.platformFee) || 0;
        deliveryCollected += Number(charges.deliveryCharge) || 0;
        gstCollected += Number(charges.tax?.totals?.gstAmount) || 0;

        if (recent.length < 50) {
          recent.push({
            orderNumber: row.orderNumber,
            createdAt: row.createdAt,
            status: row.status,
            totalAmount: row.totalAmount,
            platformFee: round2(charges.platformFee),
            platformBasis: charges.platformBasis || null,
            deliveryCharge: round2(charges.deliveryCharge),
            gstAmount: round2(charges.tax?.totals?.gstAmount),
            splitMode: charges.tax?.totals?.splitMode || null,
          });
        }
      }

      res.json({
        success: true,
        totalCollected: round2(totalCollected),
        deliveryCollected: round2(deliveryCollected),
        gstCollected: round2(gstCollected),
        orderCount: rows.length,
        recent,
      });
    } catch (error) {
      console.error("Platform revenue error:", error);
      res.status(500).json({ success: false, message: "Failed to load platform revenue." });
    }
  }
);

// =====================================================
// CHECKOUT QUOTE — the same calculator the order uses
// =====================================================
// The buyer checkout displays THIS figure and echoes it back as
// clientGrandTotal; the order endpoint re-validates it server-side.

businessRouter.post(
  "/api/orders/quote",
  requireAuth,
  requireType("customer"),
  (req, res) => {
    try {
      const items = Array.isArray(req.body.items) ? req.body.items : [];
      if (items.length === 0) {
        return res.status(400).json({ success: false, message: "Your cart is empty." });
      }

      const resolvedItems = [];

      for (const item of items) {
        const productId = Number(item.productId || item.id);
        const quantity = Math.max(1, Math.min(99, Number(item.quantity) || 1));

        const product = db
          .prepare(`SELECT * FROM products WHERE id = ? AND status = 'Approved'`)
          .get(productId);

        if (!product) {
          return res.status(400).json({
            success: false,
            message: `Product is unavailable: ${item.name || productId}`,
          });
        }

        if (Number(product.stockUnverified) === 1) {
          return res.status(409).json({
            success: false,
            code: "STOCK_UNVERIFIED",
            message: `"${product.name}" is temporarily unavailable — its supplier stock could not be confirmed.`,
          });
        }

        // LIMITED STOCK TRACKING — quote-time availability so the
        // buyer sees the shortfall before pressing Place Order. The
        // order endpoint still re-checks atomically; this is the
        // friendly early warning, not the enforcement.
        if (
          product.stock !== null &&
          product.stock !== undefined &&
          Number(product.stock) < quantity
        ) {
          return res.status(400).json({
            success: false,
            code: "OUT_OF_STOCK",
            message:
              Number(product.stock) <= 0
                ? `"${product.name}" is out of stock.`
                : `Only ${Number(product.stock)} left of "${product.name}" — reduce the quantity to continue.`,
          });
        }

        const taxGuard = checkoutSellerTaxGuard(product);
        if (taxGuard) {
          return res.status(taxGuard.status).json({
            success: false,
            code: taxGuard.code,
            message: taxGuard.message,
          });
        }

        resolvedItems.push({ product, quantity });
      }

      const quote = calculateOrderTotals(resolvedItems, {
        state: clean(req.body.state),
        deliveryMethod: clean(req.body.deliveryMethod),
      });

      res.json({ success: true, quote });
    } catch (error) {
      console.error("ORDER QUOTE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to calculate the order total." });
    }
  }
);

// =====================================================
// INIT + DEFAULT EXPORT
// =====================================================
// All table creation statements above are CREATE TABLE IF NOT EXISTS
// and run idempotently when this module is loaded; initBusiness()
// is the explicit hook called by server.js so the initialization
// order stays visible in one place.

export function initBusiness() {
  // Must run after mlm_commissions exists: the 3×3 engine adds its
  // source columns and partial unique index to that existing ledger.
  initMlm3x3();
  console.log("Business tables ready (sellers, customers, orders, MLM, 3×3 Family earnings).");
}

export default businessRouter;
