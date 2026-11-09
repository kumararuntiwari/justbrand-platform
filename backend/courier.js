// =====================================================
// JUSTBRAND — COURIER / LOGISTICS PARTNER MODULE (ADDITIVE)
// =====================================================
// Courier COMPANIES (India Post, Ekart, Shiprocket, DTDC, custom…)
// configured by the admin — completely SEPARATE from the existing
// person-based delivery_partners workflow in delivery.js (local
// delivery boys with KYC/earnings). That workflow is untouched.
//
// Design rules:
//   - All tables are CREATE TABLE IF NOT EXISTS (additive only).
//   - Order courier columns are guarded ALTER TABLE ADD COLUMN —
//     existing databases (including production) migrate safely.
//   - MANUAL MODE ONLY: no live courier API credentials exist in this
//     project, so every partner runs in Manual Mode. The admin books
//     on the courier's own dashboard/counter and records the real AWB
//     + label reference here. Nothing is auto-synced and nothing fake
//     is ever displayed.
//   - API credentials (if ever added) are stored server-side only and
//     are NEVER returned by any endpoint (write-only field; the API
//     only reports whether credentials exist).
//   - Courier assignment NEVER touches order totals, payment status,
//     order status or the configured delivery-charge/GST calculation.
//     It only writes the courier columns below.
//   - The existing order deliveryPartnerId (person) and deliveryStatus
//     columns are untouched — courier data lives in its own columns.
// =====================================================

import express from "express";
import db from "./db.js";
import { requireAuth, requireRole } from "./auth.js";
import {
  apiConfigStatus,
  envNamesFor,
  testConnection,
  buildShiprocketPayload,
  createSandboxShipment,
} from "./courier-api.js";

export const courierRouter = express.Router();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function now() {
  return new Date().toISOString();
}

// =====================================
// TABLES (ALL ADDITIVE / IF NOT EXISTS)
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS courier_partners (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    code TEXT UNIQUE NOT NULL,
    name TEXT NOT NULL,
    partnerType TEXT NOT NULL DEFAULT 'courier',
    enabled INTEGER NOT NULL DEFAULT 0,
    codAvailable INTEGER NOT NULL DEFAULT 1,
    serviceablePincodes TEXT,
    baseRate REAL NOT NULL DEFAULT 0,
    perKgRate REAL NOT NULL DEFAULT 0,
    codCharge REAL NOT NULL DEFAULT 0,
    trackingUrlTemplate TEXT,
    apiMode TEXT NOT NULL DEFAULT 'manual',
    apiCredentials TEXT,
    notes TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`).run();

console.log("Courier partners table ready.");

// SHIPMENTS — one row per shipment booking for an order (sandbox or
// live). Holds AWB + label + a tracking HISTORY + the last API error so
// the admin can see exactly what happened. Additive, IF NOT EXISTS.
db.prepare(`
  CREATE TABLE IF NOT EXISTS courier_shipments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    orderId INTEGER NOT NULL,
    partnerId INTEGER NOT NULL,
    mode TEXT NOT NULL DEFAULT 'sandbox',
    awbNumber TEXT,
    shippingLabelRef TEXT,
    courierStatus TEXT NOT NULL DEFAULT 'Booked',
    historyJson TEXT,
    lastApiError TEXT,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`).run();
console.log("Courier shipments table ready.");

// ADDITIVE ORDER COLUMNS — per-order courier booking record.
// Guarded so existing databases (production included) migrate safely.
//
// These ALTERs run inside initCourier() (called by server.js AFTER
// initBusiness() creates the orders table) — business.js imports this
// module, so module-level ALTERs here would execute before the orders
// table exists.
const COURIER_ORDER_COLUMNS = [
  { name: "courierPartnerId", decl: "INTEGER" },
  { name: "awbNumber", decl: "TEXT" },
  { name: "shippingLabelRef", decl: "TEXT" },
  { name: "courierStatus", decl: "TEXT" },
  { name: "courierAssignedAt", decl: "TEXT" },
  { name: "courierStatusUpdatedAt", decl: "TEXT" },
];

// =====================================
// DEFAULT PARTNERS (seeded once, never overwritten)
// =====================================

const DEFAULT_COURIER_PARTNERS = [
  { code: "INDIA_POST", name: "India Post", partnerType: "postal" },
  { code: "EKART", name: "Ekart", partnerType: "courier" },
  { code: "SHIPROCKET", name: "Shiprocket", partnerType: "aggregator" },
  { code: "DTDC", name: "DTDC", partnerType: "courier" },
];

function seedCourierPartners() {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO courier_partners
      (code, name, partnerType, enabled, codAvailable, apiMode, createdAt)
    VALUES (?, ?, ?, 0, 1, 'manual', ?)
  `);
  for (const partner of DEFAULT_COURIER_PARTNERS) {
    insert.run(partner.code, partner.name, partner.partnerType, now());
  }
}

seedCourierPartners();

// =====================================
// HELPERS
// =====================================

// API credentials NEVER leave the backend — only a boolean flag.
function publicCourierPartner(partner) {
  if (!partner) return null;
  return {
    id: partner.id,
    code: partner.code,
    name: partner.name,
    partnerType: partner.partnerType,
    enabled: Number(partner.enabled) === 1,
    codAvailable: Number(partner.codAvailable) === 1,
    serviceablePincodes: parsePincodes(partner.serviceablePincodes),
    baseRate: Number(partner.baseRate) || 0,
    perKgRate: Number(partner.perKgRate) || 0,
    codCharge: Number(partner.codCharge) || 0,
    trackingUrlTemplate: partner.trackingUrlTemplate || "",
    apiMode: partner.apiMode || "manual",
    hasApiCredentials: Boolean(partner.apiCredentials),
    notes: partner.notes || "",
    updatedAt: partner.updatedAt || null,
  };
}

function parsePincodes(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

const PARTNER_TYPES = ["postal", "courier", "aggregator", "other"];

// Courier-level statuses the admin records MANUALLY from the courier's
// own system. This is not an auto-synced feed — Manual Mode.
const COURIER_STATUSES = [
  "Booked",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Undelivered",
  "Returned",
  "Cancelled",
];

// =====================================
// ADMIN: COURIER PARTNER CONFIGURATION
// =====================================

courierRouter.get(
  "/api/admin/courier-partners",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    try {
      const partners = db
        .prepare(`SELECT * FROM courier_partners ORDER BY id`)
        .all();

      res.json({
        success: true,
        partners: partners.map(publicCourierPartner),
        partnerTypes: PARTNER_TYPES,
        courierStatuses: COURIER_STATUSES,
        mode: "manual",
        modeNote:
          "Manual Mode: no live courier API is connected. Book on the courier's own site/dashboard, then record the real AWB and label reference here. Nothing is auto-synced.",
      });
    } catch (error) {
      console.error("COURIER PARTNERS LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to list courier partners." });
    }
  }
);

courierRouter.put(
  "/api/admin/courier-partners/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const partner = db
        .prepare(`SELECT * FROM courier_partners WHERE id = ?`)
        .get(Number(req.params.id));

      if (!partner) {
        return res.status(404).json({ success: false, message: "Courier partner not found." });
      }

      const body = req.body || {};

      const partnerType = PARTNER_TYPES.includes(clean(body.partnerType))
        ? clean(body.partnerType)
        : partner.partnerType;

      const enabled = body.enabled === undefined ? partner.enabled : body.enabled ? 1 : 0;
      const codAvailable =
        body.codAvailable === undefined ? partner.codAvailable : body.codAvailable ? 1 : 0;

      // Serviceable pincodes: array of 6-digit strings; empty = all India.
      let serviceablePincodes = parsePincodes(partner.serviceablePincodes);
      if (body.serviceablePincodes !== undefined) {
        if (!Array.isArray(body.serviceablePincodes)) {
          return res.status(400).json({ success: false, message: "Serviceable pincodes must be a list." });
        }
        const cleaned = [];
        for (const raw of body.serviceablePincodes) {
          const pin = String(raw || "").trim();
          if (!pin) continue;
          if (!/^\d{6}$/.test(pin)) {
            return res.status(400).json({
              success: false,
              message: `Invalid PIN code "${pin}" — each pincode must be exactly 6 digits.`,
            });
          }
          cleaned.push(pin);
        }
        serviceablePincodes = [...new Set(cleaned)];
      }

      const readRate = (value, fallback) => {
        if (value === undefined) return fallback;
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < 0 || numeric > 100000) {
          return null;
        }
        return numeric;
      };

      const baseRate = readRate(body.baseRate, Number(partner.baseRate) || 0);
      const perKgRate = readRate(body.perKgRate, Number(partner.perKgRate) || 0);
      const codCharge = readRate(body.codCharge, Number(partner.codCharge) || 0);
      if (baseRate === null || perKgRate === null || codCharge === null) {
        return res.status(400).json({ success: false, message: "Shipping rates must be zero or more." });
      }

      let trackingUrlTemplate = partner.trackingUrlTemplate || "";
      if (body.trackingUrlTemplate !== undefined) {
        trackingUrlTemplate = clean(body.trackingUrlTemplate);
        if (trackingUrlTemplate.length > 500) {
          return res.status(400).json({ success: false, message: "Tracking URL template is too long (max 500 characters)." });
        }
      }

      let notes = partner.notes || "";
      if (body.notes !== undefined) {
        notes = clean(body.notes).slice(0, 500);
      }

      // API MODE: only 'manual' is accepted — no live courier API is
      // integrated in this project, so enabling anything else would be
      // a fake promise. The field stays forward-compatible.
      let apiMode = partner.apiMode || "manual";
      if (body.apiMode !== undefined) {
        if (clean(body.apiMode) !== "manual") {
          return res.status(400).json({
            success: false,
            message:
              "Live API integration is not available for this partner yet — Manual Mode is required. Book on the courier's own system and record the AWB here.",
          });
        }
        apiMode = "manual";
      }

      // API credentials: write-only. Send { apiCredentials: {...} } to
      // replace, or { apiCredentials: null } to clear. NEVER returned.
      let apiCredentials = partner.apiCredentials || null;
      if (body.apiCredentials !== undefined) {
        if (body.apiCredentials === null) {
          apiCredentials = null;
        } else if (typeof body.apiCredentials === "object" && !Array.isArray(body.apiCredentials)) {
          const sanitized = {};
          for (const [key, value] of Object.entries(body.apiCredentials)) {
            const k = clean(key).slice(0, 40);
            if (!k) continue;
            sanitized[k] = String(value ?? "").slice(0, 500);
          }
          apiCredentials = Object.keys(sanitized).length ? JSON.stringify(sanitized) : null;
        } else {
          return res.status(400).json({ success: false, message: "API credentials must be an object or null." });
        }
      }

      db.prepare(`
        UPDATE courier_partners
        SET partnerType = ?, enabled = ?, codAvailable = ?, serviceablePincodes = ?,
            baseRate = ?, perKgRate = ?, codCharge = ?, trackingUrlTemplate = ?,
            apiMode = ?, apiCredentials = ?, notes = ?, updatedAt = ?
        WHERE id = ?
      `).run(
        partnerType,
        enabled,
        codAvailable,
        JSON.stringify(serviceablePincodes),
        baseRate,
        perKgRate,
        codCharge,
        trackingUrlTemplate || null,
        apiMode,
        apiCredentials,
        notes || null,
        now(),
        partner.id
      );

      const updated = db
        .prepare(`SELECT * FROM courier_partners WHERE id = ?`)
        .get(partner.id);

      res.json({
        success: true,
        message: `${partner.name} settings saved.`,
        partner: publicCourierPartner(updated),
      });
    } catch (error) {
      console.error("COURIER PARTNER SAVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save courier partner settings." });
    }
  }
);

// =====================================
// ADMIN: PER-ORDER COURIER ASSIGNMENT
// =====================================
// Assign / update the courier booking for an order. This ONLY writes
// courier columns — order status, payment status, totals and the
// configured delivery charge / GST calculation are never touched.

function validateAssignment(partner, order) {
  if (!partner.enabled) {
    return `${partner.name} is disabled. Enable it first (Courier Partners section).`;
  }
  if (order.paymentMethod === "COD" && !partner.codAvailable) {
    return `${partner.name} does not accept Cash on Delivery. Enable COD for it, or choose another partner.`;
  }
  const pincodes = parsePincodes(partner.serviceablePincodes);
  if (pincodes.length > 0 && order.pincode && !pincodes.includes(String(order.pincode))) {
    return `PIN ${order.pincode} is not in ${partner.name}'s serviceable area.`;
  }
  return null;
}

courierRouter.put(
  "/api/admin/orders/:id/courier",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      const body = req.body || {};

      // Clearing the courier booking (mistake fix): courierPartnerId = null.
      if (body.courierPartnerId === null || body.courierPartnerId === 0) {
        db.prepare(`
          UPDATE orders
          SET courierPartnerId = NULL, awbNumber = NULL, shippingLabelRef = NULL,
              courierStatus = NULL, courierAssignedAt = NULL, courierStatusUpdatedAt = NULL,
              updatedAt = ?
          WHERE id = ?
        `).run(now(), orderId);

        const cleared = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
        return res.json({
          success: true,
          message: "Courier booking cleared for this order.",
          order: { ...cleared, items: undefined },
        });
      }

      const partner = db
        .prepare(`SELECT * FROM courier_partners WHERE id = ?`)
        .get(Number(body.courierPartnerId));

      if (!partner) {
        return res.status(404).json({ success: false, message: "Courier partner not found." });
      }

      const problem = validateAssignment(partner, order);
      if (problem) {
        return res.status(400).json({ success: false, message: problem });
      }

      const awbNumber = clean(body.awbNumber).slice(0, 64);
      if (awbNumber && !/^[A-Za-z0-9\-\/]+$/.test(awbNumber)) {
        return res.status(400).json({
          success: false,
          message: "AWB / tracking number may only contain letters, numbers, - and /.",
        });
      }

      const shippingLabelRef = clean(body.shippingLabelRef).slice(0, 64);
      if (shippingLabelRef && !/^[A-Za-z0-9\-\/_]+$/.test(shippingLabelRef)) {
        return res.status(400).json({
          success: false,
          message: "Shipping label reference may only contain letters, numbers, - _ and /.",
        });
      }

      let courierStatus = clean(body.courierStatus) || order.courierStatus || "Booked";
      if (!COURIER_STATUSES.includes(courierStatus)) {
        return res.status(400).json({
          success: false,
          message: `Invalid courier status. Allowed: ${COURIER_STATUSES.join(", ")}.`,
        });
      }

      const firstAssign = !order.courierPartnerId;

      db.prepare(`
        UPDATE orders
        SET courierPartnerId = ?, awbNumber = ?, shippingLabelRef = ?,
            courierStatus = ?, courierAssignedAt = ?,
            courierStatusUpdatedAt = ?, updatedAt = ?
        WHERE id = ?
      `).run(
        partner.id,
        awbNumber || null,
        shippingLabelRef || null,
        courierStatus,
        order.courierAssignedAt || now(),
        now(),
        now(),
        orderId
      );

      const updated = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);

      res.json({
        success: true,
        message: firstAssign
          ? `Order assigned to ${partner.name}${awbNumber ? ` (AWB ${awbNumber})` : ""}.`
          : `Courier booking updated${awbNumber ? ` — AWB ${awbNumber}` : ""}.`,
        order: {
          id: updated.id,
          orderNumber: updated.orderNumber,
          courierPartnerId: updated.courierPartnerId,
          courierPartnerName: partner.name,
          awbNumber: updated.awbNumber,
          shippingLabelRef: updated.shippingLabelRef,
          courierStatus: updated.courierStatus,
          courierAssignedAt: updated.courierAssignedAt,
        },
      });
    } catch (error) {
      console.error("COURIER ASSIGN ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save courier booking." });
    }
  }
);

// Quick courier-status update (Manual Mode: admin records what the
// courier's own system shows).
courierRouter.put(
  "/api/admin/orders/:id/courier-status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }
      if (!order.courierPartnerId) {
        return res.status(400).json({
          success: false,
          message: "No courier partner is assigned to this order yet.",
        });
      }

      const status = clean(req.body.courierStatus);
      if (!COURIER_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid courier status. Allowed: ${COURIER_STATUSES.join(", ")}.`,
        });
      }

      db.prepare(`
        UPDATE orders SET courierStatus = ?, courierStatusUpdatedAt = ?, updatedAt = ?
        WHERE id = ?
      `).run(status, now(), now(), orderId);

      res.json({ success: true, message: `Courier status recorded as ${status}.` });
    } catch (error) {
      console.error("COURIER STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to record courier status." });
    }
  }
);

// =====================================
// ADMIN: API INTEGRATION STATUS (secure — status + env NAMES only)
// =====================================
// Reports, per partner, whether server-side credentials exist and the
// mode (manual / sandbox / live). NEVER returns any secret value —
// only the boolean "configured" flag and the NAMES of missing env vars.

courierRouter.get(
  "/api/admin/courier/api-status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const partners = db.prepare(`SELECT * FROM courier_partners ORDER BY id`).all();
      const list = partners.map((p) => {
        const status = apiConfigStatus(p.code);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          enabled: Number(p.enabled) === 1,
          // Status-only (never secrets):
          hasApi: status.hasApi,
          configured: status.configured,
          mode: status.mode,
          liveEnabled: status.liveEnabled,
          missingEnv: status.missingEnv, // names only
          envNames: status.envNames,
          note: status.note,
          // Last recorded test result (from the DB, status-only too):
          lastTest: readLastTest(p.code),
        };
      });

      res.json({
        success: true,
        partners: list,
        liveFlagSet: process.env.COURIER_LIVE_ENABLED === "1",
        note:
          "Credentials are read from server-side secrets (Settings → Environment) and are never stored in the DB, returned by any endpoint, logged or committed. Without COURIER_LIVE_ENABLED=1 every partner runs as a dry-run/sandbox — shipment creation returns a clearly labelled TEST AWB and no courier is contacted.",
      });
    } catch (error) {
      console.error("COURIER API STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to read courier API status." });
    }
  }
);

// =====================================
// ADMIN: TEST CONNECTION (dry-run by default; never fakes success)
// =====================================

const lastTests = new Map(); // code → last test result (status-only)
function readLastTest(code) {
  return lastTests.get(code) || null;
}

courierRouter.post(
  "/api/admin/courier/api/test/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  async (req, res) => {
    try {
      const partner = db
        .prepare(`SELECT * FROM courier_partners WHERE id = ?`)
        .get(Number(req.params.id));
      if (!partner) {
        return res.status(404).json({ success: false, message: "Courier partner not found." });
      }

      const result = await testConnection(partner.code);
      // Store ONLY the status-only result (never any secret).
      lastTests.set(partner.code, result);

      res.json({
        success: true,
        code: partner.code,
        name: partner.name,
        result,
      });
    } catch (error) {
      console.error("COURIER TEST CONNECTION ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to test courier connection." });
    }
  }
);

// =====================================
// ADMIN: SHIPMENT MANAGEMENT (sandbox/mock by default)
// =====================================
// Creates a shipment for an order. With no live flag (the preview
// default) this returns a clearly labelled TEST AWB + label reference
// and records it — NO real courier is contacted. Duplicate bookings are
// rejected. Order totals/payment/status are NEVER touched.

courierRouter.post(
  "/api/admin/orders/:id/shipment",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = db.prepare(`SELECT * FROM orders WHERE id = ?`).get(orderId);
      if (!order) {
        return res.status(404).json({ success: false, message: "Order not found." });
      }

      const body = req.body || {};
      const partner = db
        .prepare(`SELECT * FROM courier_partners WHERE id = ?`)
        .get(Number(body.courierPartnerId));
      if (!partner) {
        return res.status(404).json({ success: false, message: "Courier partner not found." });
      }

      // Enable / COD / pincode validation (same rules as manual assign).
      const problem = validateAssignment(partner, order);
      if (problem) {
        return res.status(400).json({ success: false, message: problem });
      }

      // DUPLICATE BOOKING GUARD: an existing active shipment for this
      // order + partner blocks a second one (unless force=true, which a
      // manager can use to intentionally re-create after clearing).
      const existing = db
        .prepare(`
          SELECT * FROM courier_shipments
          WHERE orderId = ? AND partnerId = ? AND courierStatus NOT IN ('Cancelled')
          ORDER BY id DESC LIMIT 1
        `)
        .get(orderId, partner.id);
      if (existing && !body.force) {
        return res.status(409).json({
          success: false,
          message: `Order already has an active ${partner.name} shipment (AWB ${existing.awbNumber || "—"}). Clear it or pass force=true to recreate.`,
          shipmentId: existing.id,
        });
      }

      const status = apiConfigStatus(partner.code);
      let created;
      let lastApiError = null;

      if (status.mode === "live") {
        // LIVE path (only reachable with real creds + explicit flag).
        // We do not implement a real Shiprocket booking here — the
        // preview must never create real shipments. Report honestly.
        lastApiError =
          "Live mode is enabled but real booking is not implemented in this preview. Use Manual Mode / sandbox, or complete the live integration with real credentials.";
        created = createSandboxShipment({ code: partner.code, orderId });
        created.mode = "live-blocked";
      } else {
        // SANDBOX / DRY-RUN (the default) — labelled TEST AWB.
        created = createSandboxShipment({ code: partner.code, orderId });
      }

      // Persist a payload preview for Shiprocket (sandbox only) so the
      // admin can SEE what WOULD be sent — no live call is made.
      let payloadPreview = null;
      if (partner.code === "SHIPROCKET") {
        let items = [];
        try {
          items = db
            .prepare(
              `SELECT oi.productId, oi.quantity, p.name, p.sku
               FROM order_items oi LEFT JOIN products p ON p.id = oi.productId
               WHERE oi.orderId = ?`
            )
            .all(orderId);
        } catch {
          items = [];
        }
        payloadPreview = buildShiprocketPayload({ order, partner, items });
      }

      const history = [
        {
          at: new Date().toISOString(),
          status: "Booked",
          note:
            status.mode === "live"
              ? "Live booking blocked in preview — recorded as sandbox."
              : "Sandbox/mock shipment created — NOT a real booking. No courier contacted.",
        },
      ];

      const info = db
        .prepare(`
          INSERT INTO courier_shipments
            (orderId, partnerId, mode, awbNumber, shippingLabelRef, courierStatus,
             historyJson, lastApiError, createdAt, updatedAt)
          VALUES (?, ?, ?, ?, ?, 'Booked', ?, ?, ?, ?)
        `)
        .run(
          orderId,
          partner.id,
          created.mode,
          created.awbNumber,
          created.shippingLabelRef,
          JSON.stringify(history),
          lastApiError,
          now(),
          now()
        );

      // Mirror onto the order's courier columns (same fields the manual
      // booking uses) so the buyer/admin order views stay consistent.
      db.prepare(`
        UPDATE orders
        SET courierPartnerId = ?, awbNumber = ?, shippingLabelRef = ?,
            courierStatus = 'Booked', courierAssignedAt = ?,
            courierStatusUpdatedAt = ?, updatedAt = ?
        WHERE id = ?
      `).run(partner.id, created.awbNumber, created.shippingLabelRef, now(), now(), now(), orderId);

      const shipment = db
        .prepare(`SELECT * FROM courier_shipments WHERE id = ?`)
        .get(info.lastInsertRowid);

      res.status(201).json({
        success: true,
        message:
          status.mode === "live"
            ? "Live booking is blocked in preview — recorded as a sandbox shipment (no real courier contacted)."
            : `Sandbox shipment created with TEST AWB ${created.awbNumber} — NOT a real booking, no courier contacted.`,
        shipment: publicShipment(shipment),
        partnerName: partner.name,
        payloadPreview, // what WOULD be sent to Shiprocket (sandbox only)
        apiStatus: { mode: status.mode, configured: status.configured },
      });
    } catch (error) {
      console.error("SHIPMENT CREATE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to create shipment." });
    }
  }
);

// List shipments (with history + last API error) for the admin.
courierRouter.get(
  "/api/admin/courier/shipments",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    try {
      const rows = db
        .prepare(`SELECT * FROM courier_shipments ORDER BY id DESC LIMIT 200`)
        .all();
      res.json({
        success: true,
        shipments: rows.map(publicShipment),
        courierStatuses: COURIER_STATUSES,
      });
    } catch (error) {
      console.error("SHIPMENT LIST ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to list shipments." });
    }
  }
);

// Record a courier status update for a shipment (manual or from a
// tracking refresh). Appends to the tracking history + sets lastApiError.
courierRouter.put(
  "/api/admin/courier/shipments/:id/status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const shipment = db
        .prepare(`SELECT * FROM courier_shipments WHERE id = ?`)
        .get(Number(req.params.id));
      if (!shipment) {
        return res.status(404).json({ success: false, message: "Shipment not found." });
      }

      const body = req.body || {};
      let history = [];
      try {
        history = shipment.historyJson ? JSON.parse(shipment.historyJson) : [];
      } catch {
        history = [];
      }

      if (body.courierStatus !== undefined) {
        const status = clean(body.courierStatus);
        if (!COURIER_STATUSES.includes(status)) {
          return res.status(400).json({
            success: false,
            message: `Invalid courier status. Allowed: ${COURIER_STATUSES.join(", ")}.`,
          });
        }
        history.push({
          at: now(),
          status,
          note: clean(body.note).slice(0, 300) || "Status updated by admin.",
        });
        db.prepare(`
          UPDATE courier_shipments SET courierStatus = ?, historyJson = ?, updatedAt = ?
          WHERE id = ?
        `).run(status, JSON.stringify(history), now(), shipment.id);
        // Keep the order's courierStatus in sync (display-only field).
        db.prepare(`
          UPDATE orders SET courierStatus = ?, courierStatusUpdatedAt = ?, updatedAt = ?
          WHERE id = ?
        `).run(status, now(), now(), shipment.orderId);
      }

      // Optional: record an API error (e.g. a failed tracking refresh).
      if (body.apiError !== undefined) {
        const err = clean(body.apiError).slice(0, 500) || null;
        db.prepare(`
          UPDATE courier_shipments SET lastApiError = ?, updatedAt = ? WHERE id = ?
        `).run(err, now(), shipment.id);
      }

      const updated = db.prepare(`SELECT * FROM courier_shipments WHERE id = ?`).get(shipment.id);
      res.json({ success: true, message: "Shipment updated.", shipment: publicShipment(updated) });
    } catch (error) {
      console.error("SHIPMENT STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update shipment." });
    }
  }
);

// SAFE shipment shape for admin responses (never leaks secrets).
function publicShipment(shipment) {
  if (!shipment) return null;
  const partner = db.prepare(`SELECT name FROM courier_partners WHERE id = ?`).get(shipment.partnerId);
  let history = [];
  try {
    history = shipment.historyJson ? JSON.parse(shipment.historyJson) : [];
  } catch {
    history = [];
  }
  return {
    id: shipment.id,
    orderId: shipment.orderId,
    partnerId: shipment.partnerId,
    partnerName: partner ? partner.name : null,
    mode: shipment.mode,
    awbNumber: shipment.awbNumber,
    shippingLabelRef: shipment.shippingLabelRef,
    courierStatus: shipment.courierStatus,
    trackingUrl: courierTrackingUrl(shipment.partnerId, shipment.awbNumber),
    history,
    lastApiError: shipment.lastApiError || null,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

// =====================================
// SHARED HELPERS (used by business.js responses)
// =====================================

// Map of courier partner id → name, for order list responses.
export function courierPartnerNames() {
  return new Map(
    db.prepare(`SELECT id, name FROM courier_partners`).all().map((p) => [p.id, p.name])
  );
}

// Tracking URL for a partner+AWB (template uses {awb}). Empty if unset.
export function courierTrackingUrl(partnerId, awbNumber) {
  const partner = db.prepare(`SELECT * FROM courier_partners WHERE id = ?`).get(Number(partnerId));
  if (!partner || !partner.trackingUrlTemplate || !awbNumber) return null;
  return String(partner.trackingUrlTemplate).replace("{awb}", encodeURIComponent(awbNumber));
}

// SAFE buyer-facing tracking shape: status + public history entries only.
// Never includes API errors, credentials or internal notes.
export function courierPublicTracking(order) {
  if (!order || !order.courierPartnerId) return null;
  const partner = db.prepare(`SELECT * FROM courier_partners WHERE id = ?`).get(Number(order.courierPartnerId));
  const shipment = db
    .prepare(`SELECT * FROM courier_shipments WHERE orderId = ? ORDER BY id DESC LIMIT 1`)
    .get(order.id);

  let history = [];
  if (shipment?.historyJson) {
    try {
      history = JSON.parse(shipment.historyJson);
    } catch {
      history = [];
    }
  }

  return {
    courierPartnerName: partner ? partner.name : null,
    awbNumber: order.awbNumber || null,
    courierStatus: order.courierStatus || null,
    courierStatusUpdatedAt: order.courierStatusUpdatedAt || null,
    trackingUrl: courierTrackingUrl(order.courierPartnerId, order.awbNumber),
    // Verified tracking history (public subset: label + timestamp + note).
    history: Array.isArray(history)
      ? history.map((h) => ({ at: h.at || null, status: h.status || "", note: h.note || "" }))
      : [],
  };
}

export function initCourier() {
  // Called by server.js after initBusiness() — the orders table now
  // exists, so the additive column migration is safe here.
  for (const column of COURIER_ORDER_COLUMNS) {
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

  console.log("Order courier columns ready (additive migration).");
}

export default courierRouter;
