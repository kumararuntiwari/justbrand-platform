// =====================================================
// JUSTBRAND — COURIER / LOGISTICS PARTNER MODULE
// =====================================================
// Courier COMPANIES (Shiprocket, India Post, Ekart, DTDC, Delhivery,
// Xpressbees) are separate from the existing person-based delivery
// partner workflow in delivery.js. That local delivery workflow, OTP
// and earnings code is untouched.
//
// Security:
//   - API credentials come ONLY from server-side environment secrets.
//   - They are never written to SQLite, returned by an endpoint, logged
//     or committed.
//   - The legacy apiCredentials column is cleared at startup and the
//     write endpoint rejects credential payloads.
//
// Live vs manual:
//   - Shiprocket has a real server-side adapter. It is called only when
//     credentials exist AND COURIER_LIVE_ENABLED=1.
//   - Without live mode, no external courier call is made. Shiprocket
//     must never present a sandbox/test AWB as a live booking.
//   - Other partners remain Manual / Not Configured until onboarding
//     and credentials exist.
//
// Business-logic safety:
//   - Courier writes never change order totals, GST, payment status,
//     Family commission or the configured delivery charge.
//   - A multi-seller order is split into one shipment per seller so each
//     seller can use its own pickup address/package.
// =====================================================

import crypto from "node:crypto";
import express from "express";
import db from "./db.js";
import { requireAuth, requireRole, requireType } from "./auth.js";
import {
  courierAdapterStatus,
  getCourierAdapter,
  parseShiprocketWebhook,
  shiprocketWebhookConfigured,
} from "./courier-adapters/index.js";
import {
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

function round2(value) {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function addDaysIso(days) {
  const date = new Date();
  date.setDate(date.getDate() + Math.max(0, Number(days) || 0));
  return date.toISOString().slice(0, 10);
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

db.prepare(`
  CREATE TABLE IF NOT EXISTS courier_pickup_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    sellerRef TEXT UNIQUE NOT NULL,
    contactName TEXT,
    phone TEXT,
    address TEXT,
    city TEXT,
    state TEXT,
    pincode TEXT,
    providerLocationName TEXT,
    active INTEGER NOT NULL DEFAULT 1,
    createdAt TEXT NOT NULL,
    updatedAt TEXT
  )
`).run();

db.prepare(`
  CREATE TABLE IF NOT EXISTS courier_webhook_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    provider TEXT NOT NULL,
    eventKey TEXT UNIQUE NOT NULL,
    awbNumber TEXT,
    receivedAt TEXT NOT NULL,
    processedAt TEXT,
    result TEXT
  )
`).run();

function ensureColumns(table, columns) {
  const existing = new Set(
    db.prepare(`PRAGMA table_info(${table})`).all().map((column) => column.name)
  );
  for (const column of columns) {
    if (existing.has(column.name)) continue;
    try {
      db.prepare(`ALTER TABLE ${table} ADD COLUMN ${column.name} ${column.decl}`).run();
    } catch (error) {
      // Multiple preview panels may boot against the same isolated DB at
      // the same time. Another process may have added the column between
      // PRAGMA and ALTER; that is success, not a startup failure.
      if (!String(error.message || "").includes("duplicate column")) throw error;
    }
  }
}

ensureColumns("courier_partners", [
  { name: "pickupLocation", decl: "TEXT" },
  { name: "pickupPincode", decl: "TEXT" },
  { name: "freeShippingAbove", decl: "REAL NOT NULL DEFAULT 0" },
  { name: "maxWeightKg", decl: "REAL NOT NULL DEFAULT 20" },
  { name: "maxCodAmount", decl: "REAL NOT NULL DEFAULT 50000" },
  { name: "returnWindowDays", decl: "INTEGER NOT NULL DEFAULT 7" },
  { name: "rtoCharge", decl: "REAL NOT NULL DEFAULT 0" },
]);

ensureColumns("courier_shipments", [
  { name: "sellerKey", decl: "TEXT" },
  { name: "sellerId", decl: "INTEGER" },
  { name: "sellerCode", decl: "TEXT" },
  { name: "sellerName", decl: "TEXT" },
  { name: "orderItemIds", decl: "TEXT" },
  { name: "provider", decl: "TEXT" },
  { name: "providerOrderId", decl: "TEXT" },
  { name: "providerShipmentId", decl: "TEXT" },
  { name: "courierCompanyId", decl: "TEXT" },
  { name: "courierName", decl: "TEXT" },
  { name: "pickupLocation", decl: "TEXT" },
  { name: "pickupJson", decl: "TEXT" },
  { name: "packageJson", decl: "TEXT" },
  { name: "rate", decl: "REAL" },
  { name: "estimatedDeliveryDays", decl: "INTEGER" },
  { name: "estimatedDeliveryDate", decl: "TEXT" },
  { name: "labelUrl", decl: "TEXT" },
  { name: "manifestUrl", decl: "TEXT" },
  { name: "pickupToken", decl: "TEXT" },
  { name: "trackingStatus", decl: "TEXT" },
  { name: "ndrStatus", decl: "TEXT" },
  { name: "rtoStatus", decl: "TEXT" },
  { name: "packedAt", decl: "TEXT" },
  { name: "readyAt", decl: "TEXT" },
  { name: "cancelledAt", decl: "TEXT" },
  { name: "deliveredAt", decl: "TEXT" },
  { name: "lastSyncedAt", decl: "TEXT" },
  { name: "idempotencyKey", decl: "TEXT" },
]);

console.log("Courier tables ready.");

// =====================================
// DEFAULT PARTNERS (seeded once, never overwritten)
// =====================================

const DEFAULT_COURIER_PARTNERS = [
  { code: "INDIA_POST", name: "India Post", partnerType: "postal" },
  { code: "EKART", name: "Ekart", partnerType: "courier" },
  { code: "SHIPROCKET", name: "Shiprocket", partnerType: "aggregator" },
  { code: "DTDC", name: "DTDC", partnerType: "courier" },
  { code: "DELHIVERY", name: "Delhivery", partnerType: "courier" },
  { code: "XPRESSBEES", name: "Xpressbees", partnerType: "courier" },
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

function parsePincodes(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map(String) : [];
  } catch {
    return [];
  }
}

function parseJson(raw, fallback = null) {
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function publicCourierPartner(partner) {
  if (!partner) return null;
  const status = courierAdapterStatus(partner.code);
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
    freeShippingAbove: Number(partner.freeShippingAbove) || 0,
    maxWeightKg: Number(partner.maxWeightKg) || 20,
    maxCodAmount: Number(partner.maxCodAmount) || 50000,
    returnWindowDays: Number(partner.returnWindowDays) || 7,
    rtoCharge: Number(partner.rtoCharge) || 0,
    pickupLocation: partner.pickupLocation || "",
    pickupPincode: partner.pickupPincode || "",
    trackingUrlTemplate: partner.trackingUrlTemplate || "",
    apiMode: status.mode,
    apiStatus: status,
    notes: partner.notes || "",
    updatedAt: partner.updatedAt || null,
  };
}

const PARTNER_TYPES = ["postal", "courier", "aggregator", "other"];

const COURIER_STATUSES = [
  "Booked",
  "Pickup Scheduled",
  "Picked Up",
  "In Transit",
  "Out for Delivery",
  "Delivered",
  "Undelivered",
  "NDR",
  "RTO Initiated",
  "RTO In Transit",
  "Returned",
  "Cancelled",
];

function getPartner(id) {
  return db.prepare(`SELECT * FROM courier_partners WHERE id = ?`).get(Number(id));
}

function getSellerByRef(raw) {
  const ref = clean(String(raw ?? ""));
  if (!ref) return null;
  return db
    .prepare(`SELECT * FROM sellers WHERE sellerCode = ? OR CAST(id AS TEXT) = ? LIMIT 1`)
    .get(ref, ref);
}

function getSellerKyc(sellerId) {
  if (!sellerId) return null;
  return db.prepare(`SELECT * FROM seller_kyc WHERE sellerId = ?`).get(Number(sellerId)) || null;
}

function getPickup(sellerRef) {
  const seller = getSellerByRef(sellerRef);
  const code = seller?.sellerCode || clean(String(sellerRef || ""));
  const stored = code
    ? db.prepare(`SELECT * FROM courier_pickup_locations WHERE sellerRef = ?`).get(code)
    : null;
  const kyc = seller ? getSellerKyc(seller.id) : null;

  return {
    sellerId: seller?.id || null,
    sellerCode: code || null,
    sellerName: seller?.shopName || seller?.name || null,
    contactName: stored?.contactName || seller?.name || "",
    phone: stored?.phone || seller?.mobile || "",
    address: stored?.address || kyc?.address || "",
    city: stored?.city || kyc?.city || "",
    state: stored?.state || kyc?.state || "",
    pincode: stored?.pincode || kyc?.pincode || "",
    providerLocationName: stored?.providerLocationName || "",
    configured: Boolean(stored?.address || kyc?.address),
    source: stored ? "seller_pickup" : kyc ? "seller_kyc" : "missing",
    updatedAt: stored?.updatedAt || null,
  };
}

function sellerPublicPickup(pickup) {
  return {
    sellerCode: pickup.sellerCode,
    sellerName: pickup.sellerName,
    contactName: pickup.contactName,
    phone: pickup.phone,
    address: pickup.address,
    city: pickup.city,
    state: pickup.state,
    pincode: pickup.pincode,
    providerLocationName: pickup.providerLocationName,
    configured: pickup.configured,
    source: pickup.source,
  };
}

function normalizePackage(body = {}) {
  const weightKg = Math.min(50, Math.max(0.01, safeNumber(body.weightKg ?? body.weight, 0.5)));
  const length = Math.min(200, Math.max(1, safeNumber(body.length, 10)));
  const breadth = Math.min(200, Math.max(1, safeNumber(body.breadth, 10)));
  const height = Math.min(200, Math.max(1, safeNumber(body.height, 5)));
  return {
    weightKg: round2(weightKg),
    length: round2(length),
    breadth: round2(breadth),
    height: round2(height),
    declaredValue: Math.max(0, safeNumber(body.declaredValue, 0)),
  };
}

function orderGroupKey(item) {
  const seller = getSellerByRef(item.sellerId);
  return seller ? `seller:${seller.id}` : `ref:${clean(String(item.sellerId || "unassigned"))}`;
}

function getOrder(orderId) {
  return db.prepare(`SELECT * FROM orders WHERE id = ?`).get(Number(orderId));
}

function getOrderItems(orderId) {
  return db
    .prepare(
      `SELECT oi.*, p.sku, p.sellerId AS productSellerId
       FROM order_items oi LEFT JOIN products p ON p.id = oi.productId
       WHERE oi.orderId = ? ORDER BY oi.id`
    )
    .all(Number(orderId));
}

function shipmentForGroup(orderId, sellerKey, sellerId) {
  if (sellerKey) {
    const exact = db
      .prepare(
        `SELECT * FROM courier_shipments
         WHERE orderId = ? AND sellerKey = ? ORDER BY id DESC LIMIT 1`
      )
      .get(Number(orderId), sellerKey);
    if (exact) return exact;
  }
  if (sellerId) {
    const byId = db
      .prepare(
        `SELECT * FROM courier_shipments
         WHERE orderId = ? AND sellerId = ? ORDER BY id DESC LIMIT 1`
      )
      .get(Number(orderId), Number(sellerId));
    if (byId) return byId;
  }
  return null;
}

function buildGroups(orderId, { sellerRef } = {}) {
  const order = getOrder(orderId);
  if (!order) return { order: null, groups: [] };
  const items = getOrderItems(orderId);
  const wantedSeller = sellerRef ? getSellerByRef(sellerRef) : null;

  const map = new Map();
  for (const item of items) {
    const seller = getSellerByRef(item.sellerId);
    if (wantedSeller && (!seller || seller.id !== wantedSeller.id)) continue;

    const key = orderGroupKey(item);
    if (!map.has(key)) {
      const pickup = getPickup(seller?.sellerCode || item.sellerId);
      map.set(key, {
        sellerKey: key,
        sellerId: seller?.id || null,
        sellerCode: seller?.sellerCode || clean(String(item.sellerId || "")),
        sellerName: seller?.shopName || seller?.name || "Unassigned seller",
        pickup: sellerPublicPickup(pickup),
        items: [],
      });
    }
    map.get(key).items.push({
      orderItemId: item.id,
      productId: item.productId,
      productName: item.productName,
      sku: item.sku || "",
      price: item.price,
      quantity: item.quantity,
      sellerRef: item.sellerId,
    });
  }

  const groups = [...map.values()].map((group) => {
    const shipment = shipmentForGroup(orderId, group.sellerKey, group.sellerId);
    const packageJson = parseJson(shipment?.packageJson, null);
    return {
      ...group,
      destination: {
        city: order.city || "",
        state: order.state || "",
        pincode: order.pincode || "",
      },
      paymentMethod: order.paymentMethod || "COD",
      entitledAmount: group.items.reduce(
        (sum, item) => sum + safeNumber(String(item.price).replace(/[^0-9.]/g, "")) * item.quantity,
        0
      ),
      package: packageJson || {
        weightKg: 0.5,
        length: 10,
        breadth: 10,
        height: 5,
      },
      shipment: shipment ? publicShipment(shipment) : null,
    };
  });

  return { order, groups };
}

function validateAssignment(partner, order, weightKg) {
  if (!partner.enabled) {
    return `${partner.name} is disabled. Enable it first.`;
  }
  if (order.paymentMethod === "COD" && !partner.codAvailable) {
    return `${partner.name} does not accept Cash on Delivery. Enable COD for it, or choose another partner.`;
  }
  if (order.paymentMethod === "COD") {
    const codAmount = safeNumber(order.totalAmount);
    if (partner.maxCodAmount && codAmount > Number(partner.maxCodAmount)) {
      return `COD amount ₹${codAmount} is above ${partner.name}'s configured limit of ₹${partner.maxCodAmount}.`;
    }
  }
  if (weightKg && partner.maxWeightKg && Number(weightKg) > Number(partner.maxWeightKg)) {
    return `Package weight ${weightKg} kg is above ${partner.name}'s configured limit of ${partner.maxWeightKg} kg.`;
  }
  const pincodes = parsePincodes(partner.serviceablePincodes);
  if (pincodes.length > 0 && order.pincode && !pincodes.includes(String(order.pincode))) {
    return `PIN ${order.pincode} is not in ${partner.name}'s configured serviceable area.`;
  }
  return null;
}

function localQuote(partner, { weightKg, cod, declaredValue, pickupPincode, deliveryPincode }) {
  const billableKg = Math.max(1, Math.ceil(safeNumber(weightKg, 0.5)));
  const free =
    Number(partner.freeShippingAbove) > 0 &&
    safeNumber(declaredValue) >= Number(partner.freeShippingAbove);
  let rate = free ? 0 : Number(partner.baseRate) + Number(partner.perKgRate) * billableKg;
  if (cod) rate += Number(partner.codCharge) || 0;

  const pickupFirst = safeNumber(String(pickupPincode || "0")[0], 0);
  const deliveryFirst = safeNumber(String(deliveryPincode || "0")[0], 0);
  const days = Math.min(7, Math.max(2, 3 + Math.abs(pickupFirst - deliveryFirst)));

  return {
    rate: round2(Math.max(0, rate)),
    estimatedDeliveryDays: days,
    estimatedDeliveryDate: addDaysIso(days),
    billableKg,
  };
}

async function quoteForGroup({ order, group, partner, packageInfo, includeDisabled = false }) {
  const status = courierAdapterStatus(partner.code);
  const weightKg = packageInfo.weightKg;
  const cod = order.paymentMethod === "COD";
  const pickupPincode =
    group?.pickup?.pincode || partner.pickupPincode || process.env.SHIPROCKET_PICKUP_PINCODE || "";

  const problem = validateAssignment(partner, order, weightKg);
  if (!includeDisabled && problem) {
    return {
      partnerId: partner.id,
      partnerName: partner.name,
      partnerCode: partner.code,
      mode: status.mode,
      serviceable: false,
      reason: problem,
      quotes: [],
    };
  }

  if (status.mode === "live" && partner.code === "SHIPROCKET") {
    const adapter = getCourierAdapter(partner.code);
    const live = await adapter.getRates({
      pickupPincode,
      deliveryPincode: order.pincode,
      weightKg,
      cod,
      declaredValue: safeNumber(order.totalAmount),
    });

    if (live.ok && live.quotes.length) {
      return {
        partnerId: partner.id,
        partnerName: partner.name,
        partnerCode: partner.code,
        mode: "live",
        serviceable: true,
        source: "shiprocket_live",
        quotes: live.quotes.map((quote) => ({
          ...quote,
          partnerId: partner.id,
          partnerName: partner.name,
          partnerCode: partner.code,
          mode: "live",
          source: "shiprocket_live",
          serviceable: true,
        })),
        message: live.message,
      };
    }

    // A live API failure is shown honestly; the configured rule quote
    // remains available for planning/manual booking, clearly labelled.
    const fallback = localQuote(partner, {
      weightKg,
      cod,
      declaredValue: order.totalAmount,
      pickupPincode,
      deliveryPincode: order.pincode,
    });
    return {
      partnerId: partner.id,
      partnerName: partner.name,
      partnerCode: partner.code,
      mode: "live",
      serviceable: true,
      source: "configured_rule_fallback",
      apiWarning: live.message,
      quotes: [
        {
          ...fallback,
          ...fallback,
          partnerId: partner.id,
          partnerName: partner.name,
          partnerCode: partner.code,
          mode: "live",
          source: "configured_rule_fallback",
          serviceable: true,
          note: "Live Shiprocket rate lookup failed; this is the admin-configured estimate, not a live API rate.",
        },
      ],
      message: live.message,
    };
  }

  const estimate = localQuote(partner, {
    weightKg,
    cod,
    declaredValue: order.totalAmount,
    pickupPincode,
    deliveryPincode: order.pincode,
  });
  return {
    partnerId: partner.id,
    partnerName: partner.name,
    partnerCode: partner.code,
    mode: status.mode,
    serviceable: true,
    source: status.mode === "sandbox" ? "sandbox_rule_estimate" : "configured_rule",
    quotes: [
      {
        ...estimate,
        partnerId: partner.id,
        partnerName: partner.name,
        partnerCode: partner.code,
        courierName: partner.name,
        mode: status.mode,
        source: status.mode === "sandbox" ? "sandbox_rule_estimate" : "configured_rule",
        serviceable: true,
        note:
          status.mode === "sandbox"
            ? "Configured estimate only — no live Shiprocket rate call was made."
            : "Admin-configured shipping rule — not a live courier API rate.",
      },
    ],
  };
}

async function compareRates({ order, group, packageInfo, partnerId, includeDisabled = false }) {
  const partners = partnerId
    ? [getPartner(partnerId)].filter(Boolean)
    : db.prepare(`SELECT * FROM courier_partners ORDER BY id`).all();

  const rows = [];
  for (const partner of partners) {
    if (!includeDisabled && !partner.enabled) continue;
    rows.push(await quoteForGroup({ order, group, partner, packageInfo, includeDisabled }));
  }

  const options = rows.flatMap((row) => row.quotes || []);
  const recommended =
    options
      .filter((quote) => quote.serviceable !== false)
      .sort((a, b) => {
        if (a.rate !== b.rate) return a.rate - b.rate;
        return a.estimatedDeliveryDays - b.estimatedDeliveryDays;
      })[0] || null;

  return { rows, options, recommended };
}

function appendHistory(shipment, entries) {
  const history = parseJson(shipment?.historyJson, []) || [];
  const seen = new Set(history.map((h) => `${h.at || ""}|${h.status || ""}|${h.note || ""}`));
  for (const entry of entries) {
    if (!entry) continue;
    const key = `${entry.at || ""}|${entry.status || ""}|${entry.note || ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    history.push(entry);
  }
  return history;
}

function statusFromProvider(value) {
  const text = String(value || "").toUpperCase();
  if (!text) return "";
  if (text.includes("RTO") && text.includes("DELIVER")) return "Returned";
  if (text.includes("RTO")) return "RTO In Transit";
  if (text.includes("CANCEL")) return "Cancelled";
  if (text.includes("DELIVER")) return "Delivered";
  if (text.includes("OUT FOR DELIVERY")) return "Out for Delivery";
  if (text.includes("NDR") || text.includes("UNDELIVER")) return "Undelivered";
  if (text.includes("PICKED") || text.includes("PICKUP")) return "Picked Up";
  if (text.includes("TRANSIT") || text.includes("SHIPMENT")) return "In Transit";
  return "";
}

function syncOrderCourierSummary(orderId) {
  const shipments = db
    .prepare(`SELECT * FROM courier_shipments WHERE orderId = ? ORDER BY id DESC`)
    .all(Number(orderId));
  if (shipments.length === 0) return;
  const active = shipments.filter((s) => s.courierStatus !== "Cancelled");
  const latest = active[0] || shipments[0];
  const samePartner = active.length > 0 && active.every((s) => s.partnerId === active[0].partnerId);
  const one = active.length === 1;
  const allDelivered =
    active.length > 0 && active.every((s) => ["Delivered", "Returned"].includes(s.courierStatus));

  db.prepare(`
    UPDATE orders
    SET courierPartnerId = ?, awbNumber = ?, shippingLabelRef = ?,
        courierStatus = ?, courierStatusUpdatedAt = ?, updatedAt = ?
    WHERE id = ?
  `).run(
    samePartner ? latest.partnerId : null,
    one ? latest.awbNumber : null,
    one ? latest.shippingLabelRef : null,
    allDelivered ? "Delivered" : latest.courierStatus || "Booked",
    now(),
    now(),
    Number(orderId)
  );
}

// SAFE shipment shape for admin responses. Provider ids are internal
// integration identifiers; they are safe to show to staff but never
// include any API credential.
export function publicShipment(shipment) {
  if (!shipment) return null;
  const partner = db.prepare(`SELECT name FROM courier_partners WHERE id = ?`).get(shipment.partnerId);
  const history = parseJson(shipment.historyJson, []) || [];
  return {
    id: shipment.id,
    orderId: shipment.orderId,
    partnerId: shipment.partnerId,
    partnerName: partner ? partner.name : null,
    sellerKey: shipment.sellerKey || null,
    sellerId: shipment.sellerId || null,
    sellerCode: shipment.sellerCode || null,
    sellerName: shipment.sellerName || null,
    orderItemIds: parseJson(shipment.orderItemIds, []) || [],
    mode: shipment.mode,
    provider: shipment.provider || null,
    providerOrderId: shipment.providerOrderId || null,
    providerShipmentId: shipment.providerShipmentId || null,
    courierCompanyId: shipment.courierCompanyId || null,
    courierName: shipment.courierName || partner?.name || null,
    awbNumber: shipment.awbNumber || null,
    shippingLabelRef: shipment.shippingLabelRef || null,
    labelUrl: shipment.labelUrl || null,
    manifestUrl: shipment.manifestUrl || null,
    pickupToken: shipment.pickupToken || null,
    pickupLocation: shipment.pickupLocation || null,
    package: parseJson(shipment.packageJson, null),
    pickup: parseJson(shipment.pickupJson, null),
    rate: shipment.rate === null || shipment.rate === undefined ? null : Number(shipment.rate),
    estimatedDeliveryDays:
      shipment.estimatedDeliveryDays === null || shipment.estimatedDeliveryDays === undefined
        ? null
        : Number(shipment.estimatedDeliveryDays),
    estimatedDeliveryDate: shipment.estimatedDeliveryDate || null,
    courierStatus: shipment.courierStatus,
    trackingStatus: shipment.trackingStatus || shipment.courierStatus,
    trackingUrl: courierTrackingUrl(shipment.partnerId, shipment.awbNumber),
    history,
    ndrStatus: shipment.ndrStatus || null,
    rtoStatus: shipment.rtoStatus || null,
    packedAt: shipment.packedAt || null,
    readyAt: shipment.readyAt || null,
    cancelledAt: shipment.cancelledAt || null,
    deliveredAt: shipment.deliveredAt || null,
    lastSyncedAt: shipment.lastSyncedAt || null,
    lastApiError: shipment.lastApiError || null,
    createdAt: shipment.createdAt,
    updatedAt: shipment.updatedAt,
  };
}

export function courierPartnerNames() {
  return new Map(
    db.prepare(`SELECT id, name FROM courier_partners`).all().map((p) => [p.id, p.name])
  );
}

export function courierTrackingUrl(partnerId, awbNumber) {
  if (!awbNumber) return null;
  const partner = db.prepare(`SELECT * FROM courier_partners WHERE id = ?`).get(Number(partnerId));
  if (!partner) return null;
  const template =
    partner.trackingUrlTemplate ||
    (partner.code === "SHIPROCKET" ? "https://shiprocket.co/tracking/{awb}" : "");
  if (!template) return null;
  return String(template).replace("{awb}", encodeURIComponent(awbNumber));
}

function publicTrackingEntry(history) {
  return (Array.isArray(history) ? history : []).map((entry) => ({
    at: entry.at || null,
    status: entry.status || "",
    note: entry.note || "",
    location: entry.location || "",
  }));
}

// VERIFIED buyer-facing tracking. Never includes API errors, provider
// ids, credentials or internal pickup contact data.
export function courierPublicTracking(order) {
  if (!order) return null;
  const shipments = db
    .prepare(`SELECT * FROM courier_shipments WHERE orderId = ? ORDER BY id`)
    .all(order.id);
  if (!shipments.length && !order.courierPartnerId) return null;

  const partnerNames = courierPartnerNames();
  const mapped = shipments.map((shipment) => {
    const history = parseJson(shipment.historyJson, []) || [];
    return {
      shipmentId: shipment.id,
      sellerName: shipment.sellerName || null,
      courierPartnerName: partnerNames.get(shipment.partnerId) || null,
      courierName: shipment.courierName || partnerNames.get(shipment.partnerId) || null,
      awbNumber: shipment.awbNumber || null,
      courierStatus: shipment.courierStatus || null,
      trackingStatus: shipment.trackingStatus || shipment.courierStatus || null,
      courierStatusUpdatedAt: shipment.updatedAt || null,
      estimatedDeliveryDate: shipment.estimatedDeliveryDate || null,
      trackingUrl: courierTrackingUrl(shipment.partnerId, shipment.awbNumber),
      returnStatus: shipment.rtoStatus || null,
      ndrStatus: shipment.ndrStatus || null,
      history: publicTrackingEntry(history),
      mode: shipment.mode,
    };
  });

  const primary = mapped[0] || null;
  return {
    courierPartnerName:
      partnerNames.get(order.courierPartnerId) || primary?.courierPartnerName || null,
    awbNumber: order.awbNumber || primary?.awbNumber || null,
    courierStatus: order.courierStatus || primary?.courierStatus || null,
    courierStatusUpdatedAt: order.courierStatusUpdatedAt || primary?.courierStatusUpdatedAt || null,
    estimatedDeliveryDate: primary?.estimatedDeliveryDate || null,
    trackingUrl:
      courierTrackingUrl(order.courierPartnerId, order.awbNumber) || primary?.trackingUrl || null,
    history: primary?.history || [],
    shipments: mapped,
    multiSeller: mapped.length > 1,
  };
}

// =====================================
// ADMIN: COURIER PARTNER CONFIGURATION
// =====================================

courierRouter.get(
  "/api/admin/courier-partners",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    try {
      const partners = db.prepare(`SELECT * FROM courier_partners ORDER BY id`).all();
      res.json({
        success: true,
        partners: partners.map(publicCourierPartner),
        partnerTypes: PARTNER_TYPES,
        courierStatuses: COURIER_STATUSES,
        mode: "mixed",
        modeNote:
          "Shiprocket has a real server-side adapter (live only when credentials exist and COURIER_LIVE_ENABLED=1). Other partners are Manual / Not Configured until their onboarding and API access are complete. No fake booking or tracking is ever shown.",
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
      const partner = getPartner(req.params.id);
      if (!partner) {
        return res.status(404).json({ success: false, message: "Courier partner not found." });
      }

      const body = req.body || {};

      if (body.apiCredentials !== undefined) {
        return res.status(400).json({
          success: false,
          message:
            "API credentials must be configured only in server-side environment secrets. They are never accepted or stored by this endpoint.",
        });
      }

      if (body.apiMode !== undefined && !["auto", "manual"].includes(clean(body.apiMode))) {
        return res.status(400).json({
          success: false,
          message:
            "API mode is controlled by the partner adapter and server-side environment secrets. Manual Mode is required until a real API is connected; this screen cannot switch a partner to live.",
        });
      }

      const partnerType = PARTNER_TYPES.includes(clean(body.partnerType))
        ? clean(body.partnerType)
        : partner.partnerType;
      const enabled = body.enabled === undefined ? partner.enabled : body.enabled ? 1 : 0;
      const codAvailable =
        body.codAvailable === undefined ? partner.codAvailable : body.codAvailable ? 1 : 0;

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

      const readNumber = (value, fallback, { min = 0, max = 100000 } = {}) => {
        if (value === undefined) return fallback;
        const numeric = Number(value);
        if (!Number.isFinite(numeric) || numeric < min || numeric > max) return null;
        return numeric;
      };

      const baseRate = readNumber(body.baseRate, Number(partner.baseRate) || 0);
      const perKgRate = readNumber(body.perKgRate, Number(partner.perKgRate) || 0);
      const codCharge = readNumber(body.codCharge, Number(partner.codCharge) || 0);
      const freeShippingAbove = readNumber(
        body.freeShippingAbove,
        Number(partner.freeShippingAbove) || 0
      );
      const maxWeightKg = readNumber(body.maxWeightKg, Number(partner.maxWeightKg) || 20, {
        min: 0.01,
        max: 100,
      });
      const maxCodAmount = readNumber(body.maxCodAmount, Number(partner.maxCodAmount) || 50000, {
        min: 0,
        max: 1000000,
      });
      const returnWindowDays = readNumber(
        body.returnWindowDays,
        Number(partner.returnWindowDays) || 7,
        { min: 0, max: 90 }
      );
      const rtoCharge = readNumber(body.rtoCharge, Number(partner.rtoCharge) || 0);

      if (
        [baseRate, perKgRate, codCharge, freeShippingAbove, maxWeightKg, maxCodAmount, returnWindowDays, rtoCharge].some(
          (value) => value === null
        )
      ) {
        return res.status(400).json({
          success: false,
          message: "Rates and shipping limits must be valid non-negative numbers.",
        });
      }

      let trackingUrlTemplate = partner.trackingUrlTemplate || "";
      if (body.trackingUrlTemplate !== undefined) {
        trackingUrlTemplate = clean(body.trackingUrlTemplate);
        if (trackingUrlTemplate.length > 500) {
          return res.status(400).json({
            success: false,
            message: "Tracking URL template is too long (max 500 characters).",
          });
        }
        if (trackingUrlTemplate && !trackingUrlTemplate.includes("{awb}")) {
          return res.status(400).json({
            success: false,
            message: "Tracking URL template must contain {awb}.",
          });
        }
      }

      const pickupPincode =
        body.pickupPincode === undefined
          ? partner.pickupPincode || null
          : clean(body.pickupPincode) || null;
      if (pickupPincode && !/^\d{6}$/.test(pickupPincode)) {
        return res.status(400).json({ success: false, message: "Pickup PIN code must be 6 digits." });
      }

      const notes = body.notes === undefined ? partner.notes || "" : clean(body.notes).slice(0, 500);

      db.prepare(`
        UPDATE courier_partners
        SET partnerType = ?, enabled = ?, codAvailable = ?, serviceablePincodes = ?,
            baseRate = ?, perKgRate = ?, codCharge = ?, freeShippingAbove = ?,
            maxWeightKg = ?, maxCodAmount = ?, returnWindowDays = ?, rtoCharge = ?,
            pickupLocation = ?, pickupPincode = ?, trackingUrlTemplate = ?,
            notes = ?, updatedAt = ?
        WHERE id = ?
      `).run(
        partnerType,
        enabled,
        codAvailable,
        JSON.stringify(serviceablePincodes),
        baseRate,
        perKgRate,
        codCharge,
        freeShippingAbove,
        maxWeightKg,
        maxCodAmount,
        returnWindowDays,
        rtoCharge,
        body.pickupLocation === undefined
          ? partner.pickupLocation || null
          : clean(body.pickupLocation) || null,
        pickupPincode,
        trackingUrlTemplate || null,
        notes || null,
        now(),
        partner.id
      );

      const updated = getPartner(partner.id);
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
// ADMIN: API INTEGRATION STATUS
// =====================================

const lastTests = new Map();
function readLastTest(code) {
  return lastTests.get(code) || null;
}

courierRouter.get(
  "/api/admin/courier/api-status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const partners = db.prepare(`SELECT * FROM courier_partners ORDER BY id`).all();
      const list = partners.map((p) => {
        const status = courierAdapterStatus(p.code);
        return {
          id: p.id,
          code: p.code,
          name: p.name,
          enabled: Number(p.enabled) === 1,
          ...status,
          lastTest: readLastTest(p.code),
        };
      });
      res.json({
        success: true,
        partners: list,
        liveFlagSet: process.env.COURIER_LIVE_ENABLED === "1",
        note:
          "Credentials are read from server-side secrets only. They are never stored in the database, returned by an endpoint, logged or committed. Shiprocket is live only when credentials exist and COURIER_LIVE_ENABLED=1; otherwise it is sandbox and no external call is made.",
      });
    } catch (error) {
      console.error("COURIER API STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to read courier API status." });
    }
  }
);

courierRouter.post(
  "/api/admin/courier/api/test/:id",
  requireAuth,
  requireRole("super_admin", "manager"),
  async (req, res) => {
    try {
      const partner = getPartner(req.params.id);
      if (!partner) {
        return res.status(404).json({ success: false, message: "Courier partner not found." });
      }
      const adapter = getCourierAdapter(partner.code);
      if (!adapter) {
        return res.status(400).json({ success: false, message: "No adapter is registered for this partner." });
      }
      const result = await adapter.testConnection();
      lastTests.set(partner.code, result);
      res.json({ success: true, code: partner.code, name: partner.name, result });
    } catch (error) {
      console.error("COURIER TEST CONNECTION ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to test courier connection." });
    }
  }
);

// =====================================
// ADMIN: PICKUP LOCATIONS
// =====================================

courierRouter.get(
  "/api/admin/courier/pickups",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const sellers = db.prepare(`SELECT * FROM sellers ORDER BY id`).all();
    const rows = sellers.map((seller) => sellerPublicPickup(getPickup(seller.sellerCode)));
    res.json({ success: true, pickups: rows });
  }
);

courierRouter.put(
  "/api/admin/courier/pickups/:sellerRef",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    const seller = getSellerByRef(req.params.sellerRef);
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
    const saved = savePickup(seller, req.body || {});
    if (saved.error) return res.status(400).json({ success: false, message: saved.error });
    res.json({ success: true, message: "Pickup address saved.", pickup: sellerPublicPickup(saved.pickup) });
  }
);

function savePickup(seller, body) {
  const contactName = clean(body.contactName || seller.name).slice(0, 100);
  const phone = clean(body.phone || seller.mobile);
  const address = clean(body.address);
  const city = clean(body.city);
  const state = clean(body.state);
  const pincode = clean(body.pincode);
  const providerLocationName = clean(body.providerLocationName).slice(0, 80);

  if (!contactName) return { error: "Pickup contact name is required." };
  if (!/^\d{10}$/.test(phone.replace(/\D/g, ""))) return { error: "A valid 10-digit pickup phone is required." };
  if (address.length < 10) return { error: "A complete pickup address is required." };
  if (!city || !state) return { error: "Pickup city and state are required." };
  if (!/^\d{6}$/.test(pincode)) return { error: "Pickup PIN code must be 6 digits." };

  db.prepare(`
    INSERT INTO courier_pickup_locations
      (sellerRef, contactName, phone, address, city, state, pincode,
       providerLocationName, active, createdAt, updatedAt)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(sellerRef) DO UPDATE SET
      contactName = excluded.contactName, phone = excluded.phone,
      address = excluded.address, city = excluded.city, state = excluded.state,
      pincode = excluded.pincode, providerLocationName = excluded.providerLocationName,
      active = 1, updatedAt = excluded.updatedAt
  `).run(
    seller.sellerCode,
    contactName,
    phone.replace(/\D/g, ""),
    address,
    city,
    state,
    pincode,
    providerLocationName || null,
    now(),
    now()
  );

  return { pickup: getPickup(seller.sellerCode) };
}

// =====================================
// PUBLIC SERVICEABILITY / RATE COMPARISON
// =====================================

courierRouter.post("/api/courier/serviceability", async (req, res) => {
  try {
    const body = req.body || {};
    const pincode = clean(body.pincode);
    if (!/^\d{6}$/.test(pincode)) {
      return res.status(400).json({ success: false, message: "A valid 6-digit delivery PIN code is required." });
    }
    const packageInfo = normalizePackage(body);
    const cod = Boolean(body.cod);
    const pseudoOrder = {
      id: 0,
      pincode,
      city: clean(body.city),
      state: clean(body.state),
      paymentMethod: cod ? "COD" : "Prepaid",
      totalAmount: safeNumber(body.declaredValue),
      customerName: "Buyer",
      address: "",
      phone: "",
      email: "",
    };
    const partnerId = body.partnerId ? Number(body.partnerId) : null;
    const { rows, options, recommended } = await compareRates({
      order: pseudoOrder,
      group: null,
      packageInfo,
      partnerId,
    });

    res.json({
      success: true,
      pincode,
      cod,
      package: packageInfo,
      serviceable: Boolean(recommended),
      quotes: options,
      partners: rows.map((row) => ({
        partnerId: row.partnerId,
        partnerName: row.partnerName,
        pageCode: row.partnerCode,
        partnerCode: row.partnerCode,
        mode: row.mode,
        serviceable: row.serviceable,
        reason: row.reason || null,
        apiWarning: row.apiWarning || null,
      })),
      recommended,
      note: recommended
        ? "Rates are live Shiprocket rates only where mode=live; otherwise they are admin-configured estimates. No booking is made by this check."
        : "No enabled courier partner is currently serviceable for this PIN/package. No fake option is shown.",
    });
  } catch (error) {
    console.error("COURIER SERVICEABILITY ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to check courier serviceability." });
  }
});

// =====================================
// ADMIN: ORDER SHIPMENT GROUPS / RATES
// =====================================

courierRouter.get(
  "/api/admin/orders/:id/shipment-groups",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    const { order, groups } = buildGroups(req.params.id);
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    res.json({ success: true, order: { ...order, items: undefined }, groups, courierStatuses: COURIER_STATUSES });
  }
);

courierRouter.post(
  "/api/admin/orders/:id/shipments/quote",
  requireAuth,
  requireRole("super_admin", "manager"),
  async (req, res) => {
    try {
      const { order, groups } = buildGroups(req.params.id);
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });
      const sellerRef = req.body?.sellerId || req.body?.sellerKey || req.body?.sellerCode;
      const group = sellerRef
        ? groups.find(
            (g) =>
              String(g.sellerId) === String(sellerRef) ||
              g.sellerKey === String(sellerRef) ||
              g.sellerCode === String(sellerRef)
          )
        : groups[0];
      if (!group) return res.status(404).json({ success: false, message: "Seller shipment group not found." });

      const packageInfo = normalizePackage(req.body?.package || req.body || {});
      const { rows, options, recommended } = await compareRates({
        order,
        group,
        packageInfo,
        partnerId: req.body?.partnerId || null,
      });
      res.json({ success: true, group, package: packageInfo, partners: rows, quotes: options, recommended });
    } catch (error) {
      console.error("ADMIN COURIER QUOTE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to compare courier rates." });
    }
  }
);

// =====================================
// BOOKING CORE (admin + seller)
// =====================================

async function bookGroup({ order, group, partner, packageInfo, body, actorType, actorId, force = false }) {
  const problem = validateAssignment(partner, order, packageInfo.weightKg);
  if (problem) {
    const error = new Error(problem);
    error.status = 400;
    throw error;
  }

  const existing = db
    .prepare(`
      SELECT * FROM courier_shipments
      WHERE orderId = ? AND sellerKey = ? AND courierStatus != 'Cancelled'
      ORDER BY id DESC LIMIT 1
    `)
    .get(order.id, group.sellerKey);

  if (existing && !force) {
    const fallback = !existing && group.sellerKey
      ? db
          .prepare(`
            SELECT * FROM courier_shipments
            WHERE orderId = ? AND sellerKey IS NULL AND courierStatus != 'Cancelled'
            ORDER BY id DESC LIMIT 1
          `)
          .get(order.id)
      : null;
    const duplicate = existing || fallback;
    if (duplicate) {
      const error = new Error(
        `This seller already has an active shipment for order #${order.orderNumber} (AWB ${duplicate.awbNumber || "—"}).`
      );
      error.status = 409;
      error.shipmentId = duplicate.id;
      throw error;
    }
  }

  const status = courierAdapterStatus(partner.code);
  const adapter = getCourierAdapter(partner.code);
  if (!adapter) {
    const error = new Error(`No adapter is registered for ${partner.name}.`);
    error.status = 400;
    throw error;
  }

  const packageInfoFinal = normalizePackage(packageInfo);
  const pickup = getPickup(group.sellerCode);
  let created = null;
  let lastApiError = null;
  let bookingMode = status.mode;

  if (status.mode === "live") {
    if (partner.code === "SHIPROCKET") {
      const payload = buildShiprocketPayload({
        order,
        partner,
        items: group.items,
        packageInfo: packageInfoFinal,
        pickup: {
          ...pickup,
          providerLocationName: body.pickupLocationName || pickup.providerLocationName,
        },
      });
      created = await adapter.createShipment({
        payload,
        courierCompanyId: body.courierCompanyId || body.courierId || null,
        requestPickup: body.requestPickup !== false,
        generateLabel: body.generateLabel !== false,
      });
      if (!created.ok) {
        const error = new Error(created.message || "Shiprocket booking failed.");
        error.status = 502;
        error.provider = "SHIPROCKET";
        throw error;
      }
    } else {
      const error = new Error(`${partner.name} live API is not integrated. Use Manual Mode.`);
      error.status = 409;
      throw error;
    }
  } else if (status.mode === "sandbox") {
    created = createSandboxShipment({ code: partner.code, orderId: order.id, sellerKey: group.sellerKey });
  } else {
    const awbNumber = clean(body.awbNumber).slice(0, 64);
    if (awbNumber && !/^[A-Za-z0-9\-/]+$/.test(awbNumber)) {
      const error = new Error("AWB / tracking number may only contain letters, numbers, - and /.");
      error.status = 400;
      throw error;
    }
    created = {
      mode: "manual",
      awbNumber: awbNumber || null,
      shippingLabelRef: clean(body.shippingLabelRef).slice(0, 64) || null,
      note: "Manual booking record — booked outside this system. No courier API was contacted.",
    };
    bookingMode = "manual";
  }

  const awbNumber = clean(created.awbNumber || body.awbNumber).slice(0, 64) || null;
  if (awbNumber && !/^[A-Za-z0-9\-/]+$/.test(awbNumber)) {
    const error = new Error("AWB / tracking number may only contain letters, numbers, - and /.");
    error.status = 400;
    throw error;
  }

  const labelRef = clean(created.shippingLabelRef || body.shippingLabelRef).slice(0, 64) || null;
  const etaFallback = localQuote(partner, {
    weightKg: packageInfoFinal.weightKg,
    cod: order.paymentMethod === "COD",
    declaredValue: order.totalAmount,
    pickupPincode: pickup.pincode,
    deliveryPincode: order.pincode,
  });
  const estimatedDeliveryDays =
    body.estimatedDeliveryDays === undefined || body.estimatedDeliveryDays === null
      ? etaFallback.estimatedDeliveryDays
      : safeNumber(body.estimatedDeliveryDays);
  const estimatedDeliveryDate =
    clean(body.estimatedDeliveryDate) || etaFallback.estimatedDeliveryDate;
  const history = [
    {
      at: now(),
      status: "Booked",
      note:
        created.mode === "live"
          ? `Live ${partner.name} booking created.`
          : created.mode === "sandbox"
            ? "Sandbox/dry-run booking — no courier contacted. TEST AWB."
            : "Manual booking recorded. No courier API contacted.",
    },
  ];

  const info = db
    .prepare(`
      INSERT INTO courier_shipments
        (orderId, partnerId, sellerKey, sellerId, sellerCode, sellerName,
         orderItemIds, provider, providerOrderId, providerShipmentId,
         courierCompanyId, courierName, mode, awbNumber, shippingLabelRef,
         labelUrl, manifestUrl, pickupToken, pickupLocation, pickupJson,
         packageJson, rate, estimatedDeliveryDays, estimatedDeliveryDate,
         courierStatus, trackingStatus, historyJson, lastApiError, packedAt, readyAt,
         createdAt, updatedAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
    .run(
      order.id,
      partner.id,
      group.sellerKey,
      group.sellerId,
      group.sellerCode,
      group.sellerName,
      JSON.stringify(group.items.map((item) => item.orderItemId)),
      partner.code,
      created.providerOrderId || null,
      created.providerShipmentId || null,
      clean(created.courierCompanyId || body.courierCompanyId || body.courierId) || null,
      clean(created.courierName || body.courierName || partner.name) || partner.name,
      bookingMode,
      awbNumber,
      labelRef,
      clean(created.labelUrl || body.labelUrl) || null,
      clean(created.manifestUrl || body.manifestUrl) || null,
      clean(created.pickupToken || body.pickupToken) || null,
      clean(body.pickupLocationName || pickup.providerLocationName || partner.pickupLocation) || null,
      JSON.stringify({ ...pickup, providerLocationName: body.pickupLocationName || pickup.providerLocationName }),
      JSON.stringify(packageInfoFinal),
      body.rate === undefined ? null : safeNumber(body.rate),
      estimatedDeliveryDays,
      estimatedDeliveryDate,
      "Booked",
      "Booked",
      JSON.stringify(history),
      lastApiError,
      now(), // packedAt
      now(), // readyAt
      now(), // createdAt
      now() // updatedAt
    );

  syncOrderCourierSummary(order.id);
  return db.prepare(`SELECT * FROM courier_shipments WHERE id = ?`).get(info.lastInsertRowid);
}

async function resolveGroupForBooking(orderId, body) {
  const { order, groups } = buildGroups(orderId);
  if (!order) return { error: { status: 404, message: "Order not found." } };
  const ref = body?.sellerId || body?.sellerKey || body?.sellerCode || body?.sellerRef;
  if (ref) {
    const group = groups.find(
      (g) =>
        String(g.sellerId) === String(ref) ||
        g.sellerKey === String(ref) ||
        g.sellerCode === String(ref)
    );
    if (!group) return { error: { status: 404, message: "Seller shipment group not found for this order." } };
    return { order, groups, group };
  }
  if (groups.length === 1) return { order, groups, group: groups[0] };
  return {
    error: {
      status: 400,
      message: "This order contains multiple sellers. Choose a seller group for each shipment.",
      groups: groups.map((g) => ({ sellerId: g.sellerId, sellerKey: g.sellerKey, sellerCode: g.sellerCode, sellerName: g.sellerName })),
    },
  };
}

// =====================================
// ADMIN: PER-ORDER COURIER ASSIGNMENT (legacy manual contract)
// =====================================

courierRouter.put(
  "/api/admin/orders/:id/courier",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = getOrder(orderId);
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });

      const body = req.body || {};

      if (body.courierPartnerId === null || body.courierPartnerId === 0) {
        db.prepare(`
          UPDATE orders
          SET courierPartnerId = NULL, awbNumber = NULL, shippingLabelRef = NULL,
              courierStatus = NULL, courierAssignedAt = NULL, courierStatusUpdatedAt = NULL,
              updatedAt = ?
          WHERE id = ?
        `).run(now(), orderId);
        const cleared = getOrder(orderId);
        return res.json({
          success: true,
          message: "Courier booking cleared for this order.",
          order: { ...cleared, items: undefined },
        });
      }

      const partner = getPartner(body.courierPartnerId);
      if (!partner) return res.status(404).json({ success: false, message: "Courier partner not found." });

      const problem = validateAssignment(partner, order);
      if (problem) return res.status(400).json({ success: false, message: problem });

      const awbNumber = clean(body.awbNumber).slice(0, 64);
      if (awbNumber && !/^[A-Za-z0-9\-/]+$/.test(awbNumber)) {
        return res.status(400).json({
          success: false,
          message: "AWB / tracking number may only contain letters, numbers, - and /.",
        });
      }
      const shippingLabelRef = clean(body.shippingLabelRef).slice(0, 64);
      if (shippingLabelRef && !/^[A-Za-z0-9\-/_]+$/.test(shippingLabelRef)) {
        return res.status(400).json({
          success: false,
          message: "Shipping label reference may only contain letters, numbers, - _ and /.",
        });
      }
      const courierStatus = clean(body.courierStatus) || order.courierStatus || "Booked";
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
            courierStatus = ?, courierAssignedAt = ?, courierStatusUpdatedAt = ?, updatedAt = ?
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

      const updated = getOrder(orderId);
      res.json({
        success: true,
        message: firstAssign
          ? `Order assigned to ${partner.name}${awbNumber ? ` (AWB ${awbNumber})` : ""}.`
          : `Courier booking updated${awbNumber ? ` — AWB ${awbNumber}` : ""}.`,
        order: {
          ...updated,
          items: undefined,
          courierPartnerName: partner.name,
        },
      });
    } catch (error) {
      console.error("COURIER ASSIGN ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save courier booking." });
    }
  }
);

courierRouter.put(
  "/api/admin/orders/:id/courier-status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const orderId = Number(req.params.id);
      const order = getOrder(orderId);
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });
      if (!order.courierPartnerId) {
        return res.status(400).json({ success: false, message: "No courier partner is assigned to this order yet." });
      }
      const status = clean(req.body.courierStatus);
      if (!COURIER_STATUSES.includes(status)) {
        return res.status(400).json({
          success: false,
          message: `Invalid courier status. Allowed: ${COURIER_STATUSES.join(", ")}.`,
        });
      }
      db.prepare(`
        UPDATE orders SET courierStatus = ?, courierStatusUpdatedAt = ?, updatedAt = ? WHERE id = ?
      `).run(status, now(), now(), orderId);
      res.json({ success: true, message: `Courier status recorded as ${status}.` });
    } catch (error) {
      console.error("COURIER STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to record courier status." });
    }
  }
);

// =====================================
// ADMIN: CREATE SHIPMENT
// =====================================

async function createShipmentHandler(req, res) {
  try {
    const orderId = Number(req.params.id);
    const { order, group, error } = await resolveGroupForBooking(orderId, req.body || {});
    if (error) return res.status(error.status).json({ success: false, ...error });
    const partner = getPartner(req.body?.courierPartnerId || req.body?.partnerId);
    if (!partner) return res.status(404).json({ success: false, message: "Courier partner not found." });

    const packageInfo = normalizePackage(req.body?.package || req.body || {});
    const shipment = await bookGroup({
      order,
      group,
      partner,
      packageInfo,
      body: req.body || {},
      actorType: "admin",
      actorId: req.user?.id || req.user?.username || null,
      force: Boolean(req.body?.force),
    });

    const payloadPreview =
      partner.code === "SHIPROCKET"
        ? buildShiprocketPayload({
            order,
            partner,
            items: group.items,
            packageInfo,
            pickup: group.pickup,
          })
        : null;

    res.status(201).json({
      success: true,
      message:
        shipment.mode === "live"
          ? `Live ${partner.name} shipment created${shipment.awbNumber ? ` with AWB ${shipment.awbNumber}` : ""}.`
          : shipment.mode === "manual"
            ? "Manual shipment recorded. No courier API was contacted."
            : `Sandbox shipment recorded with TEST AWB ${shipment.awbNumber} — no courier contacted.`,
      shipment: publicShipment(shipment),
      partnerName: partner.name,
      payloadPreview,
      apiStatus: { mode: shipment.mode, configured: courierAdapterStatus(partner.code).configured },
    });
  } catch (error) {
    if (error.status) {
      return res.status(error.status).json({ success: false, message: error.message, shipmentId: error.shipmentId });
    }
    console.error("SHIPMENT CREATE ERROR:", error);
    res.status(500).json({ success: false, message: "Failed to create shipment." });
  }
}

courierRouter.post(
  "/api/admin/orders/:id/shipment",
  requireAuth,
  requireRole("super_admin", "manager"),
  createShipmentHandler
);

courierRouter.post(
  "/api/admin/orders/:id/shipments",
  requireAuth,
  requireRole("super_admin", "manager"),
  createShipmentHandler
);

// =====================================
// ADMIN: SHIPMENT LIST + STATUS
// =====================================

courierRouter.get(
  "/api/admin/courier/shipments",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    try {
      const orderId = req.query.orderId ? Number(req.query.orderId) : null;
      const rows = orderId
        ? db.prepare(`SELECT * FROM courier_shipments WHERE orderId = ? ORDER BY id DESC`).all(orderId)
        : db.prepare(`SELECT * FROM courier_shipments ORDER BY id DESC LIMIT 300`).all();
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

courierRouter.put(
  "/api/admin/courier/shipments/:id/status",
  requireAuth,
  requireRole("super_admin", "manager"),
  (req, res) => {
    try {
      const shipment = db
        .prepare(`SELECT * FROM courier_shipments WHERE id = ?`)
        .get(Number(req.params.id));
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found." });

      const body = req.body || {};
      let history = parseJson(shipment.historyJson, []) || [];
      const updates = [];

      if (body.courierStatus !== undefined) {
        const status = clean(body.courierStatus);
        if (!COURIER_STATUSES.includes(status)) {
          return res.status(400).json({
            success: false,
            message: `Invalid courier status. Allowed: ${COURIER_STATUSES.join(", ")}.`,
          });
        }
        history = appendHistory(shipment, [
          {
            at: now(),
            status,
            note: clean(body.note).slice(0, 300) || "Status updated manually by admin.",
          },
        ]);
        updates.push(["courierStatus", status]);
        updates.push(["trackingStatus", status]);
        if (status === "Cancelled") updates.push(["cancelledAt", now()]);
        if (status === "Delivered") updates.push(["deliveredAt", now()]);
      }

      for (const [field, limit] of [
        ["awbNumber", 64],
        ["shippingLabelRef", 64],
        ["labelUrl", 1000],
        ["manifestUrl", 1000],
        ["pickupToken", 120],
        ["courierName", 120],
        ["ndrStatus", 80],
        ["rtoStatus", 80],
      ]) {
        if (body[field] !== undefined) updates.push([field, clean(body[field]).slice(0, limit) || null]);
      }

      if (body.apiError !== undefined) {
        updates.push(["lastApiError", clean(body.apiError).slice(0, 500) || null]);
      }

      if (!updates.length) {
        return res.status(400).json({ success: false, message: "No shipment fields were supplied." });
      }

      updates.push(["historyJson", JSON.stringify(history)]);
      updates.push(["updatedAt", now()]);
      const setSql = updates.map(([field]) => `${field} = ?`).join(", ");
      db.prepare(`UPDATE courier_shipments SET ${setSql} WHERE id = ?`).run(
        ...updates.map(([, value]) => value),
        shipment.id
      );

      syncOrderCourierSummary(shipment.orderId);
      const updated = db.prepare(`SELECT * FROM courier_shipments WHERE id = ?`).get(shipment.id);
      res.json({ success: true, message: "Shipment updated.", shipment: publicShipment(updated) });
    } catch (error) {
      console.error("SHIPMENT STATUS ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to update shipment." });
    }
  }
);

// =====================================
// SHIPMENT ACTIONS (label, manifest, pickup, tracking, cancel, NDR, RTO)
// =====================================

async function runShipmentAction({ shipment, action, body, actorType }) {
  const partner = getPartner(shipment.partnerId);
  if (!partner) {
    const error = new Error("Courier partner not found.");
    error.status = 404;
    throw error;
  }
  const adapter = getCourierAdapter(partner.code);
  if (!adapter) {
    const error = new Error("No adapter is registered for this partner.");
    error.status = 400;
    throw error;
  }

  const status = courierAdapterStatus(partner.code);
  let result = { ok: false, mode: status.mode, message: "Action not supported." };
  let notes = [];
  let updates = {};

  if (action === "track" || action === "sync") {
    if (status.mode === "live") {
      result = await adapter.track({ awbNumber: shipment.awbNumber });
      if (result.ok) {
        const tracking = result.tracking || {};
        const entries = (tracking.history || []).map((entry) => ({
          at: entry.at,
          status: entry.status,
          note: entry.note,
          location: entry.location,
        }));
        const mappedStatus = statusFromProvider(tracking.status);
        if (mappedStatus) entries.push({ at: now(), status: mappedStatus, note: "Shiprocket tracking update." });
        updates.history = appendHistory(shipment, entries);
        if (mappedStatus) {
          updates.courierStatus = mappedStatus;
          updates.trackingStatus = mappedStatus;
          if (mappedStatus === "Delivered") updates.deliveredAt = now();
          if (mappedStatus === "Returned") updates.rtoStatus = "RTO Delivered";
        }
        updates.lastSyncedAt = now();
        notes.push("Live tracking refreshed.");
      }
    } else {
      result = {
        ok: false,
        mode: status.mode,
        message:
          status.mode === "sandbox"
            ? "Sandbox mode: no live tracking call was made. No fake scan was added."
            : "Manual Mode: no live tracking API. Record the courier's own scan below.",
      };
    }
  } else if (action === "label") {
    if (status.mode === "live") {
      result = await adapter.generateLabel({ providerShipmentId: shipment.providerShipmentId });
      if (result.ok) updates.labelUrl = result.labelUrl;
    } else if (body?.labelUrl) {
      result = { ok: true, mode: "manual", message: "Label URL recorded manually." };
      updates.labelUrl = clean(body.labelUrl).slice(0, 1000);
    } else {
      result = { ok: false, mode: status.mode, message: "No live label API in this mode. Paste a label URL to record it." };
    }
  } else if (action === "manifest") {
    if (status.mode === "live") {
      result = await adapter.generateManifest({ providerShipmentId: shipment.providerShipmentId });
      if (result.ok) updates.manifestUrl = result.manifestUrl;
    } else if (body?.manifestUrl) {
      result = { ok: true, mode: "manual", message: "Manifest URL recorded manually." };
      updates.manifestUrl = clean(body.manifestUrl).slice(0, 1000);
    } else {
      result = { ok: false, mode: status.mode, message: "No live manifest API in this mode. Paste a manifest URL to record it." };
    }
  } else if (action === "pickup") {
    if (status.mode === "live") {
      result = await adapter.requestPickup({ providerShipmentId: shipment.providerShipmentId });
      if (result.ok) {
        updates.pickupToken = result.pickupToken || null;
        if (result.scheduledAt) updates.estimatedDeliveryDate = shipment.estimatedDeliveryDate || null;
      }
    } else if (body?.pickupToken) {
      result = { ok: true, mode: "manual", message: "Pickup token recorded manually." };
      updates.pickupToken = clean(body.pickupToken).slice(0, 120);
    } else {
      result = { ok: false, mode: status.mode, message: "No live pickup API in this mode. Paste the pickup token to record it." };
    }
  } else if (action === "cancel") {
    if (["Delivered", "Returned", "Cancelled"].includes(shipment.courierStatus)) {
      result = { ok: false, mode: status.mode, message: "This shipment cannot be cancelled in its current state." };
    } else if (status.mode === "live") {
      result = await adapter.cancel({
        providerOrderId: shipment.providerOrderId,
        awbNumber: shipment.awbNumber,
      });
      if (result.ok) {
        updates.courierStatus = "Cancelled";
        updates.trackingStatus = "Cancelled";
        updates.cancelledAt = now();
      }
    } else {
      result = { ok: true, mode: "manual", message: "Shipment marked Cancelled manually. No courier API was contacted." };
      updates.courierStatus = "Cancelled";
      updates.trackingStatus = "Cancelled";
      updates.cancelledAt = now();
    }
  } else if (action === "ndr" || action === "rto") {
    const ndrAction = action === "rto" ? "rto" : clean(body?.ndrAction || "reattempt");
    if (status.mode === "live") {
      result = await adapter.ndrAction({
        awbNumber: shipment.awbNumber,
        action: ndrAction,
        remarks: body?.remarks,
        address: body?.address,
      });
    } else {
      result = {
        ok: true,
        mode: "manual",
        message: "NDR/RTO state recorded manually. No courier API was contacted.",
      };
    }
    if (result.ok) {
      updates.ndrStatus = ndrAction;
      if (ndrAction === "rto") {
        updates.rtoStatus = "RTO Initiated";
        updates.courierStatus = "RTO Initiated";
        updates.trackingStatus = "RTO Initiated";
      } else {
        updates.courierStatus = "NDR";
        updates.trackingStatus = "NDR";
      }
    }
  } else {
    const error = new Error("Unknown shipment action.");
    error.status = 400;
    throw error;
  }

  if (!result.ok) return { result, shipment: publicShipment(shipment) };

  if (updates.history) {
    updates.historyJson = JSON.stringify(updates.history);
    delete updates.history;
  } else if (notes.length) {
    updates.historyJson = JSON.stringify(
      appendHistory(shipment, notes.map((note) => ({ at: now(), status: action, note })))
    );
  }

  updates.lastSyncedAt = updates.lastSyncedAt || now();
  updates.updatedAt = now();
  updates.lastApiError = result.ok ? null : result.message;

  const fields = Object.keys(updates);
  db.prepare(`UPDATE courier_shipments SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`).run(
    ...fields.map((field) => updates[field]),
    shipment.id
  );
  syncOrderCourierSummary(shipment.orderId);
  const updated = db.prepare(`SELECT * FROM courier_shipments WHERE id = ?`).get(shipment.id);
  return { result, shipment: publicShipment(updated) };
}

courierRouter.post(
  "/api/admin/courier/shipments/:id/action",
  requireAuth,
  requireRole("super_admin", "manager"),
  async (req, res) => {
    try {
      const shipment = db
        .prepare(`SELECT * FROM courier_shipments WHERE id = ?`)
        .get(Number(req.params.id));
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found." });
      const action = clean(req.body?.action).toLowerCase();
      const outcome = await runShipmentAction({
        shipment,
        action,
        body: req.body || {},
        actorType: "admin",
      });
      res.status(outcome.result.ok ? 200 : 409).json({
        success: outcome.result.ok,
        message: outcome.result.message,
        result: outcome.result,
        shipment: outcome.shipment,
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("SHIPMENT ACTION ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to run shipment action." });
    }
  }
);

// =====================================
// SELLER: PICKUP + SHIPMENT WORKFLOW
// =====================================

function currentSeller(req) {
  return db.prepare(`SELECT * FROM sellers WHERE id = ?`).get(req.user.sellerId);
}

courierRouter.get(
  "/api/sellers/courier/pickup",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = currentSeller(req);
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
    res.json({ success: true, pickup: sellerPublicPickup(getPickup(seller.sellerCode)) });
  }
);

courierRouter.put(
  "/api/sellers/courier/pickup",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = currentSeller(req);
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
    const saved = savePickup(seller, req.body || {});
    if (saved.error) return res.status(400).json({ success: false, message: saved.error });
    res.json({ success: true, message: "Pickup address saved.", pickup: sellerPublicPickup(saved.pickup) });
  }
);

courierRouter.get(
  "/api/sellers/orders/:id/shipment-groups",
  requireAuth,
  requireType("seller"),
  (req, res) => {
    const seller = currentSeller(req);
    if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
    const { order, groups } = buildGroups(req.params.id, { sellerRef: seller.sellerCode });
    if (!order) return res.status(404).json({ success: false, message: "Order not found." });
    if (!groups.length) {
      return res.status(403).json({ success: false, message: "This order does not contain your products." });
    }
    res.json({ success: true, order: { ...order, items: undefined }, groups, courierStatuses: COURIER_STATUSES });
  }
);

courierRouter.post(
  "/api/sellers/orders/:id/shipments/quote",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = currentSeller(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
      const { order, groups } = buildGroups(req.params.id, { sellerRef: seller.sellerCode });
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });
      const group = groups[0];
      if (!group) return res.status(403).json({ success: false, message: "This order does not contain your products." });
      const packageInfo = normalizePackage(req.body?.package || req.body || {});
      const { rows, options, recommended } = await compareRates({ order, group, packageInfo });
      res.json({ success: true, group, package: packageInfo, partners: rows, quotes: options, recommended });
    } catch (error) {
      console.error("SELLER COURIER QUOTE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to compare courier rates." });
    }
  }
);

courierRouter.post(
  "/api/sellers/orders/:id/shipments",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = currentSeller(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
      const { order, groups } = buildGroups(req.params.id, { sellerRef: seller.sellerCode });
      if (!order) return res.status(404).json({ success: false, message: "Order not found." });
      const group = groups[0];
      if (!group) return res.status(403).json({ success: false, message: "This order does not contain your products." });
      const partner = getPartner(req.body?.courierPartnerId || req.body?.partnerId);
      if (!partner) return res.status(404).json({ success: false, message: "Courier partner not found." });
      const packageInfo = normalizePackage(req.body?.package || req.body || {});
      const shipment = await bookGroup({
        order,
        group,
        partner,
        packageInfo,
        body: req.body || {},
        actorType: "seller",
        actorId: seller.id,
        force: Boolean(req.body?.force),
      });
      res.status(201).json({
        success: true,
        message:
          shipment.mode === "live"
            ? `Live ${partner.name} shipment created${shipment.awbNumber ? ` with AWB ${shipment.awbNumber}` : ""}.`
            : shipment.mode === "manual"
              ? "Manual shipment recorded. No courier API was contacted."
              : `Sandbox shipment created with TEST AWB ${shipment.awbNumber} — no courier contacted.`,
        shipment: publicShipment(shipment),
      });
    } catch (error) {
      if (error.status) {
        return res.status(error.status).json({ success: false, message: error.message, shipmentId: error.shipmentId });
      }
      console.error("SELLER SHIPMENT CREATE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to create shipment." });
    }
  }
);

courierRouter.post(
  "/api/sellers/courier/shipments/:id/action",
  requireAuth,
  requireType("seller"),
  async (req, res) => {
    try {
      const seller = currentSeller(req);
      if (!seller) return res.status(404).json({ success: false, message: "Seller not found." });
      const shipment = db
        .prepare(`SELECT * FROM courier_shipments WHERE id = ?`)
        .get(Number(req.params.id));
      if (!shipment) return res.status(404).json({ success: false, message: "Shipment not found." });
      const shipmentGroup = buildGroups(shipment.orderId, { sellerRef: seller.sellerCode });
      const owns = shipmentGroup.groups.some(
        (g) => g.sellerKey === shipment.sellerKey || String(g.sellerId) === String(shipment.sellerId)
      );
      if (!owns) return res.status(403).json({ success: false, message: "This shipment is not yours." });

      const action = clean(req.body?.action).toLowerCase();
      if (!["track", "label"].includes(action)) {
        return res.status(403).json({
          success: false,
          message: "Sellers can refresh tracking or generate a label. Cancellation and NDR/RTO are admin actions.",
        });
      }
      const outcome = await runShipmentAction({ shipment, action, body: req.body || {}, actorType: "seller" });
      res.status(outcome.result.ok ? 200 : 409).json({
        success: outcome.result.ok,
        message: outcome.result.message,
        result: outcome.result,
        shipment: outcome.shipment,
      });
    } catch (error) {
      if (error.status) return res.status(error.status).json({ success: false, message: error.message });
      console.error("SELLER SHIPMENT ACTION ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to run shipment action." });
    }
  }
);

// =====================================
// SHIPROCKET WEBHOOK
// =====================================

courierRouter.post("/api/courier/webhook/shiprocket", (req, res) => {
  try {
    if (!shiprocketWebhookConfigured()) {
      return res.status(503).json({
        success: false,
        message: "Shiprocket webhook is not configured. Set SHIPROCKET_WEBHOOK_TOKEN server-side.",
      });
    }

    const supplied =
      clean(req.get("x-api-key")) || clean(req.query?.token);
    const expected = clean(process.env.SHIPROCKET_WEBHOOK_TOKEN);
    if (!supplied || supplied.length !== expected.length) {
      return res.status(401).json({ success: false, message: "Invalid webhook token." });
    }
    const suppliedBuffer = Buffer.from(supplied);
    const expectedBuffer = Buffer.from(expected);
    if (!crypto.timingSafeEqual(suppliedBuffer, expectedBuffer)) {
      return res.status(401).json({ success: false, message: "Invalid webhook token." });
    }

    const parsed = parseShiprocketWebhook(req.body || {});
    const scanKey = parsed.scans.map((scan) => `${scan.at}|${scan.status}|${scan.note}`).join(";");
    const eventKey = crypto
      .createHash("sha256")
      .update(`SHIPROCKET|${parsed.awbNumber}|${parsed.status}|${parsed.eventAt || ""}|${scanKey}`)
      .digest("hex");

    const duplicate = db
      .prepare(`SELECT id FROM courier_webhook_events WHERE provider = 'SHIPROCKET' AND eventKey = ?`)
      .get(eventKey);
    if (duplicate) {
      return res.json({ success: true, duplicate: true, message: "Webhook already processed." });
    }

    const shipment = db
      .prepare(`
        SELECT * FROM courier_shipments
        WHERE awbNumber = ? OR providerShipmentId = ? OR providerOrderId = ?
        ORDER BY id DESC LIMIT 1
      `)
      .get(
        parsed.awbNumber || "__none__",
        parsed.providerShipmentId || "__none__",
        parsed.providerOrderId || "__none__"
      );

    const info = db
      .prepare(`
        INSERT INTO courier_webhook_events
          (provider, eventKey, awbNumber, receivedAt)
        VALUES ('SHIPROCKET', ?, ?, ?)
      `)
      .run(eventKey, parsed.awbNumber || null, now());

    if (!shipment) {
      db.prepare(`UPDATE courier_webhook_events SET processedAt = ?, result = ? WHERE id = ?`).run(
        now(),
        "shipment_not_found",
        info.lastInsertRowid
      );
      // 200 prevents Shiprocket retry storms for an event that does not
      // belong to this account/project.
      return res.json({ success: true, matched: false, message: "No matching shipment." });
    }

    const entries = parsed.scans.map((scan) => ({
      at: scan.at,
      status: scan.status,
      note: scan.note,
      location: scan.location,
    }));
    const mapped = statusFromProvider(parsed.status);
    if (mapped) {
      entries.push({
        at: parsed.eventAt || now(),
        status: mapped,
        note: `Shiprocket: ${parsed.status}`,
      });
    }
    const history = appendHistory(shipment, entries);
    const updates = {
      historyJson: JSON.stringify(history),
      trackingStatus: mapped || shipment.trackingStatus || parsed.status || shipment.courierStatus,
      lastSyncedAt: now(),
      updatedAt: now(),
      lastApiError: null,
      ...(parsed.courierName ? { courierName: parsed.courierName } : {}),
      ...(parsed.etd ? { estimatedDeliveryDate: String(parsed.etd).slice(0, 10) } : {}),
      ...(mapped ? { courierStatus: mapped } : {}),
      ...(mapped === "Delivered" ? { deliveredAt: now() } : {}),
      ...(mapped === "Returned" ? { rtoStatus: "RTO Delivered" } : {}),
      ...(mapped === "Cancelled" ? { cancelledAt: now() } : {}),
    };
    const fields = Object.keys(updates);
    db.prepare(
      `UPDATE courier_shipments SET ${fields.map((field) => `${field} = ?`).join(", ")} WHERE id = ?`
    ).run(...fields.map((field) => updates[field]), shipment.id);

    syncOrderCourierSummary(shipment.orderId);
    db.prepare(`UPDATE courier_webhook_events SET processedAt = ?, result = ? WHERE id = ?`).run(
      now(),
      `updated:${shipment.id}`,
      info.lastInsertRowid
    );

    res.json({ success: true, matched: true, shipmentId: shipment.id });
  } catch (error) {
    console.error("SHIPROCKET WEBHOOK ERROR:", error);
    res.status(500).json({ success: false, message: "Webhook processing failed." });
  }
});

// =====================================
// INIT
// =====================================

const COURIER_ORDER_COLUMNS = [
  { name: "courierPartnerId", decl: "INTEGER" },
  { name: "awbNumber", decl: "TEXT" },
  { name: "shippingLabelRef", decl: "TEXT" },
  { name: "courierStatus", decl: "TEXT" },
  { name: "courierAssignedAt", decl: "TEXT" },
  { name: "courierStatusUpdatedAt", decl: "TEXT" },
];

export function initCourier() {
  for (const column of COURIER_ORDER_COLUMNS) {
    try {
      db.prepare(`ALTER TABLE orders ADD COLUMN ${column.name} ${column.decl}`).run();
    } catch (error) {
      if (!String(error.message || "").includes("duplicate column")) throw error;
    }
  }

  // SECURITY CLEANUP: older builds allowed write-only credentials in
  // this table. Credentials are now env-only. Clear any legacy value
  // without ever logging it.
  const legacy = db.prepare(`SELECT COUNT(*) AS count FROM courier_partners WHERE apiCredentials IS NOT NULL`).get();
  if (legacy?.count) {
    db.prepare(`UPDATE courier_partners SET apiCredentials = NULL`).run();
    console.log("Legacy courier credentials cleared from SQLite (env-only credentials enforced).");
  }

  console.log("Order courier columns ready (additive migration).");
}

export default courierRouter;
