// =====================================================
// JUSTBRAND — DELIVERY MODULE (FULLY ADDITIVE)
// =====================================================
// Delivery Partner system for the existing JustBrand platform.
//
// Design rules:
//   - All tables are CREATE TABLE IF NOT EXISTS (additive only).
//   - Order delivery fields are added with ALTER TABLE ADD COLUMN,
//     each guarded so existing databases migrate safely.
//   - Existing order schema/fields are NEVER renamed or replaced.
//   - Delivery status transitions are validated server-side
//     (invalid transitions are rejected with 409).
//   - Delivery partners can ONLY see orders assigned to them —
//     ownership is verified in every query (never frontend-only).
//   - passwordHash never leaves the backend (publicPartner()).
//   - Reuses the existing JWT auth architecture (auth.js):
//     partner tokens carry type "delivery_partner" and are gated
//     with the existing requireType() guard.
//   - Commission integrity: marking Delivered routes through the
//     existing applyOrderStatus() engine so Family commissions and
//     deliveredAt behave exactly like every other delivery path.
// =====================================================

import express from "express";
import db from "./db.js";
import {
  hashPassword,
  comparePassword,
  createToken,
  requireAuth,
  requireRole,
  requireType,
} from "./auth.js";
import { applyOrderStatus } from "./business.js";

export const deliveryRouter = express.Router();

// =====================================
// HELPERS (same conventions as business.js)
// =====================================

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function now() {
  return new Date().toISOString();
}

// Simple in-memory login limiter (same pattern as business.js rateLimit,
// kept local so the existing module is not modified).
const loginAttempts = new Map();

function loginRateLimit(maxAttempts, windowMs) {
  return (req, res, next) => {
    const key = `${req.ip || "unknown"}:delivery-login`;
    const currentTime = Date.now();
    const attempts = (loginAttempts.get(key) || []).filter(
      (timestamp) => currentTime - timestamp < windowMs
    );

    if (attempts.length >= maxAttempts) {
      return res.status(429).json({
        success: false,
        message: "Too many login attempts. Please try again later.",
      });
    }

    attempts.push(currentTime);
    loginAttempts.set(key, attempts);
    next();
  };
}

// =====================================
// TABLES (ALL ADDITIVE / IF NOT EXISTS)
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS delivery_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partnerCode TEXT UNIQUE,
    name TEXT NOT NULL,
    username TEXT NOT NULL UNIQUE,
    passwordHash TEXT NOT NULL,
    mobile TEXT NOT NULL,
    email TEXT,
    city TEXT,
    vehicleNumber TEXT,
    bankAccountName TEXT,
    bankAccountNumber TEXT,
    bankIfscCode TEXT,
    upiId TEXT,
    status TEXT NOT NULL DEFAULT 'active',
    createdAt TEXT NOT NULL,
    lastLoginAt TEXT
  )
`).run();

console.log("Delivery partners table ready.");

db.prepare(`
  CREATE TABLE IF NOT EXISTS delivery_earnings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    partnerId INTEGER NOT NULL,
    orderId INTEGER NOT NULL,
    amount REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'Pending',
    createdAt TEXT NOT NULL,
    deliveredAt TEXT,
    paidAt TEXT
  )
`).run();

console.log("Delivery earnings table ready.");

// Delivery settings follow the existing key/value settings pattern
// (same style as site_settings / mlm_settings).
db.prepare(`
  CREATE TABLE IF NOT EXISTS delivery_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT
  )
`).run();

console.log("Delivery settings table ready.");

// =====================================
// ADDITIVE ORDER COLUMNS (safe migration)
// =====================================
// Each column is added only if missing. Existing rows keep NULL
// (= "no delivery data yet"), which the UIs treat as "not tracked".

const DELIVERY_ORDER_COLUMNS = [
  { name: "deliveryPartnerId", decl: "INTEGER" },
  { name: "deliveryStatus", decl: "TEXT" },
  { name: "assignedAt", decl: "TEXT" },
  { name: "pickedUpAt", decl: "TEXT" },
  { name: "outForDeliveryAt", decl: "TEXT" },
  // orders.deliveredAt already exists in the base schema — not re-added.
  { name: "deliveryFailedAt", decl: "TEXT" },
  { name: "deliveryFailureReason", decl: "TEXT" },
  { name: "deliveryRetryCount", decl: "INTEGER NOT NULL DEFAULT 0" },
  { name: "deliveryOtpHash", decl: "TEXT" },
  { name: "deliveryOtpVerifiedAt", decl: "TEXT" },
  { name: "returnedToSellerAt", decl: "TEXT" },
];

for (const column of DELIVERY_ORDER_COLUMNS) {
  try {
    db.prepare(
      `ALTER TABLE orders ADD COLUMN ${column.name} ${column.decl}`
    ).run();
  } catch (error) {
    // "duplicate column name" simply means the column already exists.
    if (!String(error.message || "").includes("duplicate column")) {
      throw error;
    }
  }
}

console.log("Order delivery columns ready (additive migration).");

// =====================================
// DELIVERY SETTINGS (ADMIN CONFIGURABLE)
// =====================================

const DEFAULT_DELIVERY_SETTINGS = {
  // Display/config values only — actual order pricing is NOT changed here.
  deliveryCharge: 0,
  // Per-delivery partner earning. Clearly configurable; real payouts
  // continue to follow existing business/finance rules.
  partnerEarningPerDelivery: 40,
  // OTP must be verified by the partner before marking Delivered.
  otpRequired: true,
  // Maximum delivery attempts before return-to-seller is expected.
  maxDeliveryAttempts: 3,
  // COD handling mode (display/instruction for partners).
  codHandling: "collect-and-deposit",
};

function getDeliverySettings() {
  const row = db
    .prepare(`SELECT value FROM delivery_settings WHERE key = 'config'`)
    .get();

  if (!row) return { ...DEFAULT_DELIVERY_SETTINGS };

  try {
    const parsed = JSON.parse(row.value);
    return { ...DEFAULT_DELIVERY_SETTINGS, ...parsed };
  } catch {
    return { ...DEFAULT_DELIVERY_SETTINGS };
  }
}

function saveDeliverySettings(settings) {
  db.prepare(`
    INSERT INTO delivery_settings (key, value, updatedAt)
    VALUES ('config', ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(JSON.stringify(settings), now());
}

// =====================================
// DELIVERY STATUS STATE MACHINE
// =====================================
//  Assigned → Pickup Pending → Picked Up → Out for Delivery → Delivered
//  Failure: Out for Delivery → Delivery Failed
//           Delivery Failed → Out for Delivery (retry) | Return to Seller
//  Terminal states: Delivered, Returned to Seller.

const DELIVERY_TRANSITIONS = {
  Assigned: ["Pickup Pending"],
  "Pickup Pending": ["Picked Up"],
  "Picked Up": ["Out for Delivery"],
  "Out for Delivery": ["Delivered", "Delivery Failed"],
  "Delivery Failed": ["Out for Delivery", "Return to Seller"],
  "Return to Seller": ["Returned to Seller"],
};

const TERMINAL_DELIVERY_STATUSES = ["Delivered", "Returned to Seller"];

function canTransition(fromStatus, toStatus) {
  return (DELIVERY_TRANSITIONS[fromStatus] || []).includes(toStatus);
}

// =====================================
// PUBLIC SHAPES (NO passwordHash EVER)
// =====================================

function publicPartner(partner) {
  if (!partner) return null;

  return {
    id: partner.id,
    partnerCode: partner.partnerCode,
    name: partner.name,
    username: partner.username,
    mobile: partner.mobile,
    email: partner.email,
    city: partner.city,
    vehicleNumber: partner.vehicleNumber,
    // Bank details are shown truncated to admins (last 4 only).
    bankAccountName: partner.bankAccountName || "",
    bankAccountLast4: (partner.bankAccountNumber || "").slice(-4),
    bankIfscCode: partner.bankIfscCode || "",
    upiId: partner.upiId || "",
    status: partner.status,
    createdAt: partner.createdAt,
    lastLoginAt: partner.lastLoginAt,
  };
}

// Partner's own profile can include their own bank details in full
// (they own the data) but still never the passwordHash.
function ownPartnerProfile(partner) {
  if (!partner) return null;

  return {
    ...publicPartner(partner),
    bankAccountNumber: partner.bankAccountNumber || "",
  };
}

function maskPhone(phone) {
  const digits = String(phone || "");
  if (digits.length < 4) return "••••";
  return `${digits.slice(0, 2)}•••••${digits.slice(-4)}`;
}

// Pickup location is resolved from the order's items → seller → KYC
// (read-only joins; no existing data is modified).
function pickupInfoForOrder(orderId) {
  const row = db
    .prepare(`
      SELECT
        s.id            AS sellerId,
        s.sellerCode    AS sellerCode,
        s.name          AS sellerName,
        s.shopName      AS sellerShopName,
        s.mobile        AS sellerMobile,
        kyc.shopName    AS kycShopName,
        kyc.address     AS kycAddress,
        kyc.city        AS kycCity,
        kyc.state       AS kycState,
        kyc.pincode     AS kycPincode
      FROM order_items oi
      LEFT JOIN sellers s
        ON (CAST(s.id AS TEXT) = oi.sellerId OR s.sellerCode = oi.sellerId)
      LEFT JOIN seller_kyc kyc ON kyc.sellerId = s.id
      WHERE oi.orderId = ?
      LIMIT 1
    `)
    .get(orderId);

  if (!row || !row.sellerId) {
    return {
      sellerName: null,
      shopName: null,
      pickupAddress: null,
    };
  }

  return {
    sellerName: row.sellerName || null,
    shopName: row.kycShopName || row.sellerShopName || row.shopName || null,
    pickupAddress: [row.kycAddress, row.kycCity, row.kycState, row.kycPincode]
      .filter(Boolean)
      .join(", ") || null,
  };
}

function itemCountForOrder(orderId) {
  const row = db
    .prepare(`SELECT COALESCE(SUM(quantity), 0) AS count FROM order_items WHERE orderId = ?`)
    .get(orderId);
  return row ? row.count : 0;
}

// Full order shape for delivery views. Sensitive fields (KYC docs,
// passwordHash) are never selected — only delivery-relevant data.
function deliveryOrderShape(order, { includeContact = false } = {}) {
  const partner = order.deliveryPartnerId
    ? db
        .prepare(`SELECT id, name, partnerCode, mobile FROM delivery_partners WHERE id = ?`)
        .get(order.deliveryPartnerId)
    : null;

  const pickup = pickupInfoForOrder(order.id);

  // Customer phone is masked unless the partner is actively delivering.
  const activeDelivery = ["Picked Up", "Out for Delivery"].includes(
    order.deliveryStatus || ""
  );

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    customerName: order.customerName,
    // Masked by default; full number only for active delivery contact.
    phoneMasked: maskPhone(order.phone),
    phone: includeContact && activeDelivery ? order.phone : null,
    address: order.address,
    city: order.city,
    state: order.state,
    pincode: order.pincode,
    totalAmount: order.totalAmount,
    paymentMethod: order.paymentMethod,
    paymentStatus: order.paymentStatus,
    status: order.status,
    createdAt: order.createdAt,
    deliveredAt: order.deliveredAt,
    itemCount: itemCountForOrder(order.id),
    pickup,
    partner: partner
      ? { id: partner.id, name: partner.name, partnerCode: partner.partnerCode }
      : null,
    // Additive delivery tracking fields (null-safe for legacy orders).
    deliveryStatus: order.deliveryStatus || null,
    deliveryPartnerId: order.deliveryPartnerId || null,
    assignedAt: order.assignedAt || null,
    pickedUpAt: order.pickedUpAt || null,
    outForDeliveryAt: order.outForDeliveryAt || null,
    deliveryFailedAt: order.deliveryFailedAt || null,
    deliveryFailureReason: order.deliveryFailureReason || null,
    deliveryRetryCount: order.deliveryRetryCount || 0,
    deliveryOtpVerifiedAt: order.deliveryOtpVerifiedAt || null,
    returnedToSellerAt: order.returnedToSellerAt || null,
  };
}

function getAllDeliverySettingsRows() {
  return getDeliverySettings();
}

// =====================================
// PARTNER AUTH (existing JWT architecture)
// =====================================

deliveryRouter.post("/api/delivery/login", loginRateLimit(10, 5 * 60 * 1000), async (req, res) => {
  try {
    const username = String(req.body.username || "").trim();
    const password = String(req.body.password || "");

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        message: "Username and password are required.",
      });
    }

    const partner = db
      .prepare(`SELECT * FROM delivery_partners WHERE LOWER(username) = LOWER(?)`)
      .get(username);

    if (!partner || !(await comparePassword(password, partner.passwordHash))) {
      return res.status(401).json({
        success: false,
        message: "Invalid username or password.",
      });
    }

    if (partner.status !== "active") {
      return res.status(403).json({
        success: false,
        message: "This delivery partner account is inactive.",
      });
    }

    db.prepare(`UPDATE delivery_partners SET lastLoginAt = ? WHERE id = ?`).run(
      now(),
      partner.id
    );

    const token = createToken({
      type: "delivery_partner",
      deliveryPartnerId: partner.id,
      name: partner.name,
    });

    res.json({
      success: true,
      message: "Login successful.",
      token,
      partner: ownPartnerProfile(partner),
    });
  } catch (error) {
    console.error("DELIVERY LOGIN ERROR:", error);
    res.status(500).json({ success: false, message: "Login failed." });
  }
});

// Partner profile (own only). Uses the existing requireAuth + requireType
// guards so a staff/seller/customer/member token can never pass.
deliveryRouter.get(
  "/api/delivery/me",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const partner = db
      .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
      .get(req.user.deliveryPartnerId);

    if (!partner) {
      return res.status(404).json({ success: false, message: "Partner not found." });
    }

    res.json({ success: true, partner: ownPartnerProfile(partner) });
  }
);

deliveryRouter.put(
  "/api/delivery/me",
  requireAuth,
  requireType("delivery_partner"),
  async (req, res) => {
    try {
      const partner = db
        .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
        .get(req.user.deliveryPartnerId);

      if (!partner) {
        return res.status(404).json({ success: false, message: "Partner not found." });
      }

      const email = clean(req.body.email).toLowerCase();
      const city = clean(req.body.city);
      const vehicleNumber = clean(req.body.vehicleNumber).toUpperCase();
      const bankAccountName = clean(req.body.bankAccountName);
      const bankAccountNumber = clean(req.body.bankAccountNumber).replace(/\s/g, "");
      const bankIfscCode = clean(req.body.bankIfscCode).toUpperCase();
      const upiId = clean(req.body.upiId);

      if (bankAccountNumber && !/^\d{6,20}$/.test(bankAccountNumber)) {
        return res.status(400).json({
          success: false,
          message: "Bank account number must be 6–20 digits.",
        });
      }

      if (bankIfscCode && !/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfscCode)) {
        return res.status(400).json({
          success: false,
          message: "IFSC code format is invalid.",
        });
      }

      db.prepare(`
        UPDATE delivery_partners
        SET email = ?, city = ?, vehicleNumber = ?,
            bankAccountName = ?, bankAccountNumber = ?, bankIfscCode = ?, upiId = ?
        WHERE id = ?
      `).run(
        email || partner.email,
        city || partner.city,
        vehicleNumber || partner.vehicleNumber,
        bankAccountName || partner.bankAccountName,
        bankAccountNumber || partner.bankAccountNumber,
        bankIfscCode || partner.bankIfscCode,
        upiId || partner.upiId,
        partner.id
      );

      const updated = db
        .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
        .get(partner.id);

      res.json({
        success: true,
        message: "Profile updated.",
        partner: ownPartnerProfile(updated),
      });
    } catch (error) {
      console.error("DELIVERY PROFILE UPDATE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update profile." });
    }
  }
);

// =====================================
// PARTNER: ORDER QUERIES (OWN ORDERS ONLY)
// =====================================
// Every query filters by deliveryPartnerId = req.user.deliveryPartnerId,
// so no partner can ever list or open another partner's order.

deliveryRouter.get(
  "/api/delivery/orders",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const orders = db
      .prepare(`
        SELECT * FROM orders
        WHERE deliveryPartnerId = ?
        ORDER BY id DESC
        LIMIT 500
      `)
      .all(req.user.deliveryPartnerId);

    res.json({
      success: true,
      orders: orders.map((order) => deliveryOrderShape(order, { includeContact: true })),
    });
  }
);

deliveryRouter.get(
  "/api/delivery/orders/:id",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = db
      .prepare(`
        SELECT * FROM orders
        WHERE id = ? AND deliveryPartnerId = ?
      `)
      .get(Number(req.params.id), req.user.deliveryPartnerId);

    if (!order) {
      // Same 404 for "not found" and "not yours" — no information leak.
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    res.json({
      success: true,
      order: deliveryOrderShape(order, { includeContact: true }),
    });
  }
);

// =====================================
// PARTNER: STATUS TRANSITIONS (BACKEND-VALIDATED)
// =====================================
// Shared guard: order must exist AND belong to this partner, and the
// requested transition must be valid in the state machine.

function loadOwnOrder(req, res) {
  const orderId = Number(req.params.id);

  if (!Number.isInteger(orderId)) {
    res.status(400).json({ success: false, message: "Invalid order id." });
    return null;
  }

  const order = db
    .prepare(`
      SELECT * FROM orders
      WHERE id = ? AND deliveryPartnerId = ?
    `)
    .get(orderId, req.user.deliveryPartnerId);

  if (!order) {
    res.status(404).json({ success: false, message: "Order not found." });
    return null;
  }

  // Safety guard: a cancelled/returned/refunded order must never progress
  // through the delivery flow (additive protection; existing paths unaffected).
  if (["Cancelled", "Returned", "Refunded"].includes(order.status)) {
    res.status(409).json({
      success: false,
      message: `Order is ${order.status.toLowerCase()}; delivery actions are blocked.`,
    });
    return null;
  }

  return order;
}

function transitionOrder(order, toStatus, extraUpdates = {}) {
  const updates = {
    deliveryStatus: toStatus,
    updatedAt: now(),
    ...extraUpdates,
  };

  const setClauses = ["deliveryStatus = ?", "updatedAt = ?"];
  const values = [updates.deliveryStatus, updates.updatedAt];

  for (const [key, value] of Object.entries(extraUpdates)) {
    if (key === "deliveryStatus" || key === "updatedAt") continue;
    setClauses.push(`${key} = ?`);
    values.push(value);
  }

  values.push(order.id);

  db.prepare(
    `UPDATE orders SET ${setClauses.join(", ")} WHERE id = ?`
  ).run(...values);
}

// Accept pickup: Assigned → Pickup Pending
deliveryRouter.put(
  "/api/delivery/orders/:id/accept-pickup",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Pickup Pending")) {
      return res.status(409).json({
        success: false,
        message: `Cannot accept pickup from status "${order.deliveryStatus}".`,
      });
    }

    transitionOrder(order, "Pickup Pending");

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Pickup accepted.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

// Picked up: Pickup Pending → Picked Up
deliveryRouter.put(
  "/api/delivery/orders/:id/picked-up",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Picked Up")) {
      return res.status(409).json({
        success: false,
        message: `Cannot mark picked up from status "${order.deliveryStatus}".`,
      });
    }

    transitionOrder(order, "Picked Up", { pickedUpAt: now() });

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Package picked up.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

// Start delivery: Picked Up → Out for Delivery
deliveryRouter.put(
  "/api/delivery/orders/:id/start-delivery",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Out for Delivery")) {
      return res.status(409).json({
        success: false,
        message: `Cannot start delivery from status "${order.deliveryStatus}".`,
      });
    }

    transitionOrder(order, "Out for Delivery", { outForDeliveryAt: now() });

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Out for delivery.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

// Deliver: Out for Delivery → Delivered (OTP verified when required).
// Routes through applyOrderStatus so commissions/deliveredAt stay exact.
deliveryRouter.put(
  "/api/delivery/orders/:id/deliver",
  requireAuth,
  requireType("delivery_partner"),
  async (req, res) => {
    try {
      const order = loadOwnOrder(req, res);
      if (!order) return;

      if (!canTransition(order.deliveryStatus, "Delivered")) {
        return res.status(409).json({
          success: false,
          message: `Cannot deliver from status "${order.deliveryStatus}".`,
        });
      }

      const settings = getDeliverySettings();

      if (settings.otpRequired) {
        const otp = clean(String(req.body.otp || ""));

        if (!/^\d{6}$/.test(otp)) {
          return res.status(400).json({
            success: false,
            message: "A 6-digit delivery OTP is required.",
          });
        }

        if (!order.deliveryOtpHash) {
          return res.status(409).json({
            success: false,
            message: "No delivery OTP exists for this order. Please contact support.",
          });
        }

        const otpValid = await comparePassword(otp, order.deliveryOtpHash);

        if (!otpValid) {
          return res.status(401).json({
            success: false,
            message: "Incorrect delivery OTP.",
          });
        }
      }

      const deliveredAt = now();

      // Transition the additive delivery fields first.
      transitionOrder(order, "Delivered", {
        deliveryOtpVerifiedAt: settings.otpRequired ? deliveredAt : null,
      });

      // Then move the EXISTING order status through the shared engine so
      // Family commissions and deliveredAt behave exactly like other paths.
      if (order.status !== "Delivered" && order.status !== "Cancelled") {
        applyOrderStatus(order.id, "Delivered");
      }

      // Record the (configurable) earning for this completed delivery.
      const existingEarning = db
        .prepare(`SELECT id FROM delivery_earnings WHERE orderId = ? AND partnerId = ?`)
        .get(order.id, req.user.deliveryPartnerId);

      if (!existingEarning) {
        db.prepare(`
          INSERT INTO delivery_earnings (partnerId, orderId, amount, status, createdAt, deliveredAt)
          VALUES (?, ?, ?, 'Pending', ?, ?)
        `).run(
          req.user.deliveryPartnerId,
          order.id,
          Number(settings.partnerEarningPerDelivery) || 0,
          now(),
          deliveredAt
        );
      }

      const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
      res.json({
        success: true,
        message: "Order delivered.",
        order: deliveryOrderShape(updated, { includeContact: true }),
      });
    } catch (error) {
      console.error("DELIVERY COMPLETE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to mark delivered." });
    }
  }
);

// Failed: Out for Delivery → Delivery Failed (reason required)
deliveryRouter.put(
  "/api/delivery/orders/:id/failed",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Delivery Failed")) {
      return res.status(409).json({
        success: false,
        message: `Cannot mark failed from status "${order.deliveryStatus}".`,
      });
    }

    const allowedReasons = [
      "Customer unavailable",
      "Wrong address",
      "Customer refused",
      "Phone unreachable",
      "Other",
    ];

    const reason = clean(req.body.reason);

    if (!allowedReasons.includes(reason)) {
      return res.status(400).json({
        success: false,
        message: "A valid failure reason is required.",
      });
    }

    const details = clean(req.body.details);

    transitionOrder(order, "Delivery Failed", {
      deliveryFailedAt: now(),
      deliveryFailureReason: details ? `${reason}: ${details}` : reason,
      deliveryRetryCount: (order.deliveryRetryCount || 0) + 1,
    });

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Delivery marked failed.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

// Retry: Delivery Failed → Out for Delivery
deliveryRouter.put(
  "/api/delivery/orders/:id/retry",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Out for Delivery")) {
      return res.status(409).json({
        success: false,
        message: `Cannot retry from status "${order.deliveryStatus}".`,
      });
    }

    const settings = getDeliverySettings();
    const attempts = (order.deliveryRetryCount || 0) + 1;

    if (Number(settings.maxDeliveryAttempts) > 0 && attempts > Number(settings.maxDeliveryAttempts)) {
      return res.status(409).json({
        success: false,
        message: `Maximum delivery attempts (${settings.maxDeliveryAttempts}) reached. Please return the package to the seller.`,
      });
    }

    transitionOrder(order, "Out for Delivery", {
      outForDeliveryAt: now(),
      deliveryFailureReason: null,
    });

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Retry started — out for delivery.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

// Return to Seller: Delivery Failed → Return to Seller → Returned to Seller
deliveryRouter.put(
  "/api/delivery/orders/:id/return-to-seller",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Return to Seller")) {
      return res.status(409).json({
        success: false,
        message: `Cannot start return from status "${order.deliveryStatus}".`,
      });
    }

    transitionOrder(order, "Return to Seller");

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Return to seller started.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

deliveryRouter.put(
  "/api/delivery/orders/:id/returned",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const order = loadOwnOrder(req, res);
    if (!order) return;

    if (!canTransition(order.deliveryStatus, "Returned to Seller")) {
      return res.status(409).json({
        success: false,
        message: `Cannot complete return from status "${order.deliveryStatus}".`,
      });
    }

    transitionOrder(order, "Returned to Seller", { returnedToSellerAt: now() });

    // Reflect the return on the existing order status (voids commissions
    // through the shared engine — same as any other return path).
    if (!["Returned", "Refunded", "Cancelled"].includes(order.status)) {
      applyOrderStatus(order.id, "Returned");
    }

    const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(order.id);
    res.json({
      success: true,
      message: "Package returned to seller.",
      order: deliveryOrderShape(updated, { includeContact: true }),
    });
  }
);

// =====================================
// PARTNER: EARNINGS + HISTORY
// =====================================
// Earnings are recorded only from real completed deliveries and use the
// admin-configurable per-delivery value. Actual payouts remain governed
// by existing finance rules (earnings rows are Pending until an
// accountant/super admin marks them Paid).

deliveryRouter.get(
  "/api/delivery/earnings",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const rows = db
      .prepare(`
        SELECT e.*, o.orderNumber
        FROM delivery_earnings e
        LEFT JOIN orders o ON o.id = e.orderId
        WHERE e.partnerId = ?
        ORDER BY e.id DESC
        LIMIT 500
      `)
      .all(req.user.deliveryPartnerId);

    const today = now().slice(0, 10);

    const totals = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'Pending' THEN amount ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'Paid' THEN amount ELSE 0 END), 0)     AS paid,
          COALESCE(SUM(amount), 0)                                              AS total,
          COUNT(*)                                                              AS deliveries
        FROM delivery_earnings
        WHERE partnerId = ?
      `)
      .get(req.user.deliveryPartnerId);

    const todayRow = db
      .prepare(`
        SELECT COALESCE(SUM(amount), 0) AS amount, COUNT(*) AS count
        FROM delivery_earnings
        WHERE partnerId = ? AND deliveredAt LIKE ?
      `)
      .get(req.user.deliveryPartnerId, `${today}%`);

    res.json({
      success: true,
      earnings: rows,
      summary: {
        deliveries: totals.deliveries || 0,
        todayAmount: todayRow.amount || 0,
        todayCount: todayRow.count || 0,
        pendingAmount: totals.pending || 0,
        paidAmount: totals.paid || 0,
        totalAmount: totals.total || 0,
        perDeliveryRate: Number(getDeliverySettings().partnerEarningPerDelivery) || 0,
      },
    });
  }
);

deliveryRouter.get(
  "/api/delivery/history",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const orders = db
      .prepare(`
        SELECT * FROM orders
        WHERE deliveryPartnerId = ?
          AND deliveryStatus IN ('Delivered', 'Returned to Seller')
        ORDER BY id DESC
        LIMIT 500
      `)
      .all(req.user.deliveryPartnerId);

    res.json({
      success: true,
      orders: orders.map((order) => deliveryOrderShape(order)),
    });
  }
);

// Partner dashboard KPIs (own data only).
deliveryRouter.get(
  "/api/delivery/dashboard",
  requireAuth,
  requireType("delivery_partner"),
  (req, res) => {
    const today = now().slice(0, 10);

    const counts = db
      .prepare(`
        SELECT
          COUNT(*)                                                              AS assigned,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Pickup Pending' THEN 1 ELSE 0 END), 0) AS pickupPending,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Picked Up' THEN 1 ELSE 0 END), 0)      AS pickedUp,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Out for Delivery' THEN 1 ELSE 0 END), 0) AS outForDelivery,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Delivery Failed' THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Delivered' AND COALESCE(deliveredAt, '') LIKE ? THEN 1 ELSE 0 END), 0) AS deliveredToday,
          COALESCE(SUM(CASE WHEN COALESCE(assignedAt, '') LIKE ? THEN 1 ELSE 0 END), 0) AS assignedToday
        FROM orders
        WHERE deliveryPartnerId = ?
      `)
      .get(`${today}%`, `${today}%`, req.user.deliveryPartnerId);

    const recent = db
      .prepare(`
        SELECT * FROM orders
        WHERE deliveryPartnerId = ?
        ORDER BY id DESC
        LIMIT 10
      `)
      .all(req.user.deliveryPartnerId);

    res.json({
      success: true,
      counts: {
        assigned: counts.assigned || 0,
        assignedToday: counts.assignedToday || 0,
        pickupPending: counts.pickupPending || 0,
        pickedUp: counts.pickedUp || 0,
        outForDelivery: counts.outForDelivery || 0,
        deliveredToday: counts.deliveredToday || 0,
        failed: counts.failed || 0,
      },
      recentOrders: recent.map((order) => deliveryOrderShape(order)),
    });
  }
);

// =====================================
// ADMIN: DELIVERY PARTNERS
// =====================================
// Partner management follows the existing staff management permission
// model: super_admin + manager manage; view for order-authorized roles.

const canManageDelivery = requireRole("super_admin", "manager");
const canViewDelivery = requireRole("super_admin", "manager", "accountant");

deliveryRouter.get(
  "/api/admin/delivery/partners",
  requireAuth,
  canViewDelivery,
  (req, res) => {
    const partners = db
      .prepare(`SELECT * FROM delivery_partners ORDER BY id DESC LIMIT 500`)
      .all();

    // Include a live count of active assignments per partner.
    const counts = db
      .prepare(`
        SELECT deliveryPartnerId AS partnerId, COUNT(*) AS count
        FROM orders
        WHERE deliveryPartnerId IS NOT NULL
          AND deliveryStatus NOT IN ('Delivered', 'Returned to Seller')
        GROUP BY deliveryPartnerId
      `)
      .all();

    const countMap = Object.fromEntries(counts.map((c) => [c.partnerId, c.count]));

    res.json({
      success: true,
      partners: partners.map((p) => ({
        ...publicPartner(p),
        activeOrders: countMap[p.id] || 0,
      })),
    });
  }
);

deliveryRouter.post(
  "/api/admin/delivery/partners",
  requireAuth,
  canManageDelivery,
  async (req, res) => {
    try {
      const name = clean(req.body.name);
      const username = clean(req.body.username).toLowerCase();
      const password = String(req.body.password || "");
      const mobile = clean(req.body.mobile);
      const email = clean(req.body.email).toLowerCase();
      const city = clean(req.body.city);
      const vehicleNumber = clean(req.body.vehicleNumber).toUpperCase();

      if (!name) {
        return res.status(400).json({ success: false, message: "Partner name is required." });
      }

      if (!/^[a-z0-9_.]{4,30}$/.test(username)) {
        return res.status(400).json({
          success: false,
          message: "Username must be 4–30 characters (letters, numbers, dot, underscore).",
        });
      }

      if (!password || String(password).length < 6) {
        return res.status(400).json({
          success: false,
          message: "Password must be at least 6 characters.",
        });
      }

      if (!/^\d{10}$/.test(mobile)) {
        return res.status(400).json({
          success: false,
          message: "A valid 10-digit mobile number is required.",
        });
      }

      const existing = db
        .prepare(`SELECT id FROM delivery_partners WHERE LOWER(username) = LOWER(?)`)
        .get(username);

      if (existing) {
        return res.status(409).json({ success: false, message: "Username already exists." });
      }

      const passwordHash = await hashPassword(password);

      // Partner code follows the existing sellerCode/memberId style.
      let partnerCode = `DP${Math.floor(100000 + Math.random() * 900000)}`;
      const codeExists = db
        .prepare(`SELECT id FROM delivery_partners WHERE partnerCode = ?`)
        .get(partnerCode);
      if (codeExists) {
        partnerCode = `DP${Date.now().toString().slice(-6)}`;
      }

      const result = db.prepare(`
        INSERT INTO delivery_partners (
          partnerCode, name, username, passwordHash, mobile, email,
          city, vehicleNumber, status, createdAt
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'active', ?)
      `).run(
        partnerCode,
        name,
        username,
        passwordHash,
        mobile,
        email || null,
        city || null,
        vehicleNumber || null,
        now()
      );

      const partner = db
        .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
        .get(result.lastInsertRowid);

      res.status(201).json({
        success: true,
        message: "Delivery partner created successfully.",
        partner: publicPartner(partner),
      });
    } catch (error) {
      console.error("CREATE DELIVERY PARTNER ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to create delivery partner." });
    }
  }
);

deliveryRouter.put(
  "/api/admin/delivery/partners/:id",
  requireAuth,
  canManageDelivery,
  async (req, res) => {
    try {
      const partner = db
        .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
        .get(Number(req.params.id));

      if (!partner) {
        return res.status(404).json({ success: false, message: "Partner not found." });
      }

      const status = req.body.status === "inactive" ? "inactive" : "active";
      const name = clean(req.body.name) || partner.name;
      const mobile = clean(req.body.mobile) || partner.mobile;
      const city = clean(req.body.city) || partner.city;
      const vehicleNumber =
        clean(req.body.vehicleNumber).toUpperCase() || partner.vehicleNumber;

      let passwordHash = partner.passwordHash;
      if (req.body.password) {
        const newPassword = String(req.body.password);
        if (newPassword.length < 6) {
          return res.status(400).json({
            success: false,
            message: "Password must be at least 6 characters.",
          });
        }
        passwordHash = await hashPassword(newPassword);
      }

      db.prepare(`
        UPDATE delivery_partners
        SET name = ?, mobile = ?, city = ?, vehicleNumber = ?, status = ?, passwordHash = ?
        WHERE id = ?
      `).run(name, mobile, city, vehicleNumber, status, passwordHash, partner.id);

      const updated = db
        .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
        .get(partner.id);

      res.json({
        success: true,
        message: "Partner updated.",
        partner: publicPartner(updated),
      });
    } catch (error) {
      console.error("UPDATE DELIVERY PARTNER ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update partner." });
    }
  }
);

// =====================================
// ADMIN: ORDER ASSIGNMENT + DELIVERY VIEWS
// =====================================

deliveryRouter.get(
  "/api/admin/delivery/orders",
  requireAuth,
  canViewDelivery,
  (req, res) => {
    const orders = db
      .prepare(`
        SELECT * FROM orders
        WHERE deliveryPartnerId IS NOT NULL
        ORDER BY id DESC
        LIMIT 500
      `)
      .all();

    res.json({
      success: true,
      orders: orders.map((order) => deliveryOrderShape(order)),
    });
  }
);

// Assign / reassign an order to a delivery partner.
// Generates the delivery OTP (hashed at rest; shown once to the admin so
// it can be shared with the customer through the existing support channel).
deliveryRouter.post(
  "/api/admin/delivery/orders/:id/assign",
  requireAuth,
  canManageDelivery,
  async (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const partnerId = Number(req.body.partnerId);

      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      if (["Cancelled", "Returned", "Refunded", "Delivered"].includes(order.status)) {
        return res.status(409).json({
          success: false,
          message: `Cannot assign a ${order.status.toLowerCase()} order.`,
        });
      }

      if (TERMINAL_DELIVERY_STATUSES.includes(order.deliveryStatus || "")) {
        return res.status(409).json({
          success: false,
          message: `Order delivery is already complete (${order.deliveryStatus}).`,
        });
      }

      const partner = db
        .prepare(`SELECT * FROM delivery_partners WHERE id = ?`)
        .get(partnerId);

      if (!partner || partner.status !== "active") {
        return res.status(404).json({
          success: false,
          message: "Active delivery partner not found.",
        });
      }

      // Fresh OTP on every (re)assignment.
      const otp = String(Math.floor(100000 + Math.random() * 900000));
      const otpHash = await hashPassword(otp);

      const assignedAt = now();
      const reassignment = Boolean(order.deliveryPartnerId) && order.deliveryPartnerId !== partner.id;

      db.prepare(`
        UPDATE orders
        SET deliveryPartnerId = ?,
            deliveryStatus = 'Assigned',
            assignedAt = ?,
            deliveryOtpHash = ?,
            deliveryOtpVerifiedAt = NULL
        WHERE id = ?
      `).run(partner.id, assignedAt, otpHash, orderId);

      const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

      res.json({
        success: true,
        message: reassignment
          ? `Order reassigned to ${partner.name}.`
          : `Order assigned to ${partner.name}.`,
        // Shown once — the admin shares it with the customer (no SMS infra yet).
        deliveryOtp: otp,
        order: deliveryOrderShape(updated),
      });
    } catch (error) {
      console.error("ASSIGN DELIVERY ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to assign order." });
    }
  }
);

// Unassign (pull an order back from a partner) — only before pickup.
deliveryRouter.post(
  "/api/admin/delivery/orders/:id/unassign",
  requireAuth,
  canManageDelivery,
  (req, res) => {
    const orderId = Number(req.params.id);

    const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
    if (!order) {
      return res.status(404).json({ success: false, message: "Order not found." });
    }

    if (order.deliveryStatus && order.deliveryStatus !== "Assigned") {
      return res.status(409).json({
        success: false,
        message: "Only orders that are still 'Assigned' can be unassigned.",
      });
    }

    db.prepare(`
      UPDATE orders
      SET deliveryPartnerId = NULL, deliveryStatus = NULL,
          assignedAt = NULL, deliveryOtpHash = NULL, deliveryOtpVerifiedAt = NULL
      WHERE id = ?
    `).run(orderId);

    res.json({ success: true, message: "Order unassigned." });
  }
);

// Admin delivery dashboard KPIs.
deliveryRouter.get(
  "/api/admin/delivery/dashboard",
  requireAuth,
  canViewDelivery,
  (req, res) => {
    const today = now().slice(0, 10);

    const counts = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN deliveryStatus IS NOT NULL THEN 1 ELSE 0 END), 0) AS totalAssigned,
          COALESCE(SUM(CASE WHEN deliveryStatus IN ('Assigned','Pickup Pending') THEN 1 ELSE 0 END), 0) AS pickupPending,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Picked Up' THEN 1 ELSE 0 END), 0) AS pickedUp,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Out for Delivery' THEN 1 ELSE 0 END), 0) AS outForDelivery,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Delivered' AND COALESCE(deliveredAt, '') LIKE ? THEN 1 ELSE 0 END), 0) AS deliveredToday,
          COALESCE(SUM(CASE WHEN deliveryStatus = 'Delivery Failed' THEN 1 ELSE 0 END), 0) AS failed,
          COALESCE(SUM(CASE WHEN deliveryStatus IN ('Return to Seller','Returned to Seller') THEN 1 ELSE 0 END), 0) AS returns
        FROM orders
      `)
      .get(`${today}%`);

    const partnerCounts = db
      .prepare(`
        SELECT
          COUNT(*) AS total,
          COALESCE(SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END), 0) AS active
        FROM delivery_partners
      `)
      .get();

    const recent = db
      .prepare(`
        SELECT * FROM orders
        WHERE deliveryPartnerId IS NOT NULL
        ORDER BY id DESC
        LIMIT 10
      `)
      .all();

    res.json({
      success: true,
      counts: {
        totalAssigned: counts.totalAssigned || 0,
        pickupPending: counts.pickupPending || 0,
        pickedUp: counts.pickedUp || 0,
        outForDelivery: counts.outForDelivery || 0,
        deliveredToday: counts.deliveredToday || 0,
        failed: counts.failed || 0,
        returns: counts.returns || 0,
        partnersTotal: partnerCounts.total || 0,
        partnersActive: partnerCounts.active || 0,
      },
      recentOrders: recent.map((order) => deliveryOrderShape(order)),
    });
  }
);

// =====================================
// ADMIN: DELIVERY SETTINGS
// =====================================

deliveryRouter.get(
  "/api/admin/delivery/settings",
  requireAuth,
  canViewDelivery,
  (req, res) => {
    res.json({ success: true, settings: getDeliverySettings() });
  }
);

deliveryRouter.put(
  "/api/admin/delivery/settings",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const current = getDeliverySettings();

      const numericKeys = [
        "deliveryCharge",
        "partnerEarningPerDelivery",
        "maxDeliveryAttempts",
      ];

      const next = { ...current };

      for (const key of numericKeys) {
        if (req.body[key] !== undefined) {
          const value = Number(req.body[key]);
          if (!Number.isFinite(value) || value < 0) {
            return res.status(400).json({
              success: false,
              message: `${key} must be a non-negative number.`,
            });
          }
          next[key] = value;
        }
      }

      if (req.body.otpRequired !== undefined) {
        next.otpRequired = Boolean(req.body.otpRequired);
      }

      if (req.body.codHandling !== undefined) {
        const allowed = ["collect-and-deposit", "seller-pays-online"];
        const value = clean(req.body.codHandling);
        if (!allowed.includes(value)) {
          return res.status(400).json({
            success: false,
            message: "Invalid COD handling mode.",
          });
        }
        next.codHandling = value;
      }

      saveDeliverySettings(next);

      res.json({
        success: true,
        message: "Delivery settings saved.",
        settings: next,
      });
    } catch (error) {
      console.error("DELIVERY SETTINGS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save settings." });
    }
  }
);

// =====================================
// ADMIN: EARNINGS OVERVIEW (finance action)
// =====================================

deliveryRouter.get(
  "/api/admin/delivery/earnings",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const rows = db
      .prepare(`
        SELECT
          e.*,
          p.name AS partnerName,
          p.partnerCode,
          o.orderNumber
        FROM delivery_earnings e
        LEFT JOIN delivery_partners p ON p.id = e.partnerId
        LEFT JOIN orders o ON o.id = e.orderId
        ORDER BY e.id DESC
        LIMIT 500
      `)
      .all();

    const totals = db
      .prepare(`
        SELECT
          COALESCE(SUM(CASE WHEN status = 'Pending' THEN amount ELSE 0 END), 0) AS pending,
          COALESCE(SUM(CASE WHEN status = 'Paid' THEN amount ELSE 0 END), 0)     AS paid,
          COALESCE(SUM(amount), 0)                                              AS total
        FROM delivery_earnings
      `)
      .get();

    res.json({
      success: true,
      earnings: rows,
      totals: {
        pending: totals.pending || 0,
        paid: totals.paid || 0,
        total: totals.total || 0,
      },
    });
  }
);

// Marking an earning Paid is a FINANCE action: accountant or super admin
// (mirrors the existing mlm_commissions payment permission model).
deliveryRouter.put(
  "/api/admin/delivery/earnings/:id/pay",
  requireAuth,
  requireRole("super_admin", "accountant"),
  (req, res) => {
    const earning = db
      .prepare(`SELECT * FROM delivery_earnings WHERE id = ?`)
      .get(Number(req.params.id));

    if (!earning) {
      return res.status(404).json({ success: false, message: "Earning record not found." });
    }

    if (earning.status === "Paid") {
      return res.status(409).json({ success: false, message: "Already marked paid." });
    }

    db.prepare(`
      UPDATE delivery_earnings SET status = 'Paid', paidAt = ? WHERE id = ?
    `).run(now(), earning.id);

    res.json({ success: true, message: "Earning marked as paid." });
  }
);

// =====================================
// INIT HOOK (mirrors initBusiness pattern)
// =====================================

export function initDelivery() {
  console.log("Delivery tables ready (partners, earnings, settings, order columns).");
}

export default deliveryRouter;
