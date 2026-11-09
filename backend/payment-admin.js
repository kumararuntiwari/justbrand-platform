// =====================================================
// JUSTBRAND — ADMIN PAYMENT SETTINGS (ADDITIVE)
// =====================================================
// Admin-configurable payment settings stored server-side in SQLite
// (same key/value pattern as charges_settings / mlm_settings).
//
// Behaviour:
//   - /api/payment/config (business.js, buyer checkout) prefers the
//     admin-saved settings and falls back to the legacy env vars
//     (PAYMENT_MODE, PAYMENT_UPI_ID, …) when nothing is saved yet —
//     existing production behaviour is preserved until an admin saves.
//   - Only NON-SECRET display data ever leaves the backend (UPI ID,
//     bank name/last-4/IFSC). Secret values (gateway merchant keys,
//     if ever added) are stored in the payment_secrets table and are
//     NEVER returned by any endpoint.
//   - No online payment gateway is integrated in this project, so the
//     available methods stay COD / UPI (manual transfer) /
//     BankTransfer (manual). Nothing is advertised as live/auto-paid.
// =====================================================

import express from "express";
import db from "./db.js";
import { requireAuth, requireRole } from "./auth.js";

export const paymentAdminRouter = express.Router();

function clean(value) {
  return typeof value === "string" ? value.trim() : "";
}

function now() {
  return new Date().toISOString();
}

// =====================================
// TABLES (ADDITIVE)
// =====================================

db.prepare(`
  CREATE TABLE IF NOT EXISTS payment_settings (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT
  )
`).run();

// Server-side-only credential store: never read by any response.
db.prepare(`
  CREATE TABLE IF NOT EXISTS payment_secrets (
    key TEXT PRIMARY KEY,
    value TEXT,
    updatedAt TEXT
  )
`).run();

console.log("Payment settings tables ready.");

// =====================================
// MODEL
// =====================================
// mode: "COD" | "COD,UPI" | "COD,UPI,BankTransfer" (same semantics the
// env PAYMENT_MODE had — kept identical so buyer behaviour matches).

const VALID_METHODS = ["COD", "UPI", "BankTransfer"];

// Legacy ENV semantics (PAYMENT_MODE): the env string was loose —
// "UPI" historically enabled both UPI and BankTransfer, "ALL" enabled
// everything. Kept EXACTLY for the env fallback only.
function parseEnvMode(mode) {
  const raw = String(mode || "").trim();
  const methods = ["COD"];
  if (!raw) return methods;
  if (raw.includes("UPI") || raw === "ALL") methods.push("UPI");
  if ((raw.includes("UPI") || raw.includes("Bank") || raw === "ALL") && !methods.includes("BankTransfer")) {
    // Legacy env behaviour: enabling UPI also enabled BankTransfer.
    methods.push("BankTransfer");
  }
  return methods;
}

// Admin-SAVED settings are explicit: the saved mode is a precise
// comma-separated list (validated at save time) and must NOT be
// re-expanded — the admin chooses each method independently.
function parseSavedMode(mode) {
  const methods = String(mode || "")
    .split(",")
    .map((m) => m.trim())
    .filter((m) => VALID_METHODS.includes(m));
  return methods.length ? [...new Set(["COD", ...methods])] : ["COD"];
}

export function getPaymentSettings() {
  const rows = db.prepare(`SELECT key, value FROM payment_settings`).all();
  const stored = Object.fromEntries(rows.map((r) => [r.key, r.value]));

  const hasSaved = Object.keys(stored).length > 0;

  // Saved settings use explicit method lists; env-only installs keep
  // the legacy PAYMENT_MODE semantics (unchanged production behaviour).
  const mode = hasSaved && stored.mode !== undefined ? stored.mode : process.env.PAYMENT_MODE || "COD";
  const upiId = hasSaved && stored.upiId !== undefined ? stored.upiId : process.env.PAYMENT_UPI_ID || "";
  const bankName = hasSaved && stored.bankName !== undefined ? stored.bankName : process.env.PAYMENT_BANK_NAME || "";
  const bankAccountName =
    hasSaved && stored.bankAccountName !== undefined
      ? stored.bankAccountName
      : process.env.PAYMENT_BANK_ACCOUNT_NAME || "";
  const bankAccountNumber =
    hasSaved && stored.bankAccountNumber !== undefined
      ? stored.bankAccountNumber
      : process.env.PAYMENT_BANK_ACCOUNT_NUMBER || "";
  const bankIfsc = hasSaved && stored.bankIfsc !== undefined ? stored.bankIfsc : process.env.PAYMENT_BANK_IFSC || "";
  const instructions =
    hasSaved && stored.instructions !== undefined
      ? stored.instructions
      : "UPI / bank-transfer orders remain Pending until payment is verified by the JustBrand accounts team.";

  return {
    hasSaved,
    mode: String(mode || "COD"),
    methods: hasSaved ? parseSavedMode(mode) : parseEnvMode(mode),
    upiId: String(upiId || ""),
    bankName: String(bankName || ""),
    bankAccountName: String(bankAccountName || ""),
    bankAccountNumber: String(bankAccountNumber || ""),
    bankIfsc: String(bankIfsc || ""),
    instructions: String(instructions || ""),
  };
}

// Non-secret public shape for the buyer checkout (same fields the
// original endpoint returned — bank account only as last 4 digits).
export function buildPaymentConfig() {
  const settings = getPaymentSettings();
  return {
    success: true,
    paymentMethods: settings.methods,
    upiId: settings.upiId,
    bank: {
      bankName: settings.bankName,
      accountName: settings.bankAccountName,
      accountLast4: settings.bankAccountNumber.slice(-4),
      ifsc: settings.bankIfsc,
    },
    note: settings.instructions,
  };
}

// Admin shape: everything EXCEPT the secrets table. The bank account
// number is shown masked (last 4 only) — the full value stays server-side.
export function buildAdminPaymentView() {
  const settings = getPaymentSettings();
  return {
    hasSavedSettings: settings.hasSaved,
    mode: settings.mode,
    methods: settings.methods,
    upiId: settings.upiId,
    bankName: settings.bankName,
    bankAccountName: settings.bankAccountName,
    bankAccountLast4: settings.bankAccountNumber.slice(-4),
    bankIfsc: settings.bankIfsc,
    instructions: settings.instructions,
    availableMethods: VALID_METHODS,
    gateway: {
      integrated: false,
      note: "No online payment gateway is connected. Orders stay Pending until the payment (COD collection, UPI or bank transfer) is verified. Enabling a gateway requires its API credentials and a dedicated integration.",
    },
  };
}

// =====================================
// ADMIN ENDPOINTS
// =====================================

paymentAdminRouter.get(
  "/api/admin/payment/settings",
  requireAuth,
  requireRole("super_admin", "manager", "accountant"),
  (req, res) => {
    try {
      res.json({ success: true, settings: buildAdminPaymentView() });
    } catch (error) {
      console.error("PAYMENT SETTINGS READ ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to load payment settings." });
    }
  }
);

paymentAdminRouter.put(
  "/api/admin/payment/settings",
  requireAuth,
  requireRole("super_admin"),
  (req, res) => {
    try {
      const body = req.body || {};

      // mode: "COD" / "COD,UPI" / "COD,UPI,BankTransfer"
      const mode = clean(body.mode);
      if (!mode) {
        return res.status(400).json({ success: false, message: "Payment mode is required." });
      }
      const requested = mode
        .split(",")
        .map((m) => clean(m))
        .filter(Boolean);
      for (const method of requested) {
        if (!VALID_METHODS.includes(method)) {
          return res
            .status(400)
            .json({ success: false, message: `Invalid payment method "${method}". Allowed: ${VALID_METHODS.join(", ")}.` });
        }
      }
      if (!requested.includes("COD")) {
        // Preserve the existing invariant that COD is always available
        // unless an explicit future change is requested — COD is the
        // default and the only cash-flow-free option.
        requested.unshift("COD");
      }
      const finalMode = [...new Set(requested)].join(",");

      const upiId = clean(body.upiId).slice(0, 100);
      if (finalMode.includes("UPI") && !upiId) {
        return res.status(400).json({ success: false, message: "A UPI ID is required when UPI payments are enabled." });
      }

      const bankName = clean(body.bankName).slice(0, 100);
      const bankAccountName = clean(body.bankAccountName).slice(0, 100);
      const bankAccountNumber = clean(body.bankAccountNumber).replace(/\s+/g, "").slice(0, 20);
      const bankIfsc = clean(body.bankIfsc).toUpperCase().slice(0, 20);

      if (finalMode.includes("BankTransfer")) {
        if (!bankAccountNumber || !bankIfsc) {
          return res.status(400).json({
            success: false,
            message: "Bank account number and IFSC are required when bank transfer is enabled.",
          });
        }
        if (!/^[A-Z]{4}0[A-Z0-9]{6}$/.test(bankIfsc)) {
          return res.status(400).json({ success: false, message: "The IFSC code does not look valid (expected e.g. HDFC0000123)." });
        }
      }

      const instructions =
        clean(body.instructions).slice(0, 500) ||
        "UPI / bank-transfer orders remain Pending until payment is verified by the JustBrand accounts team.";

      const rows = [
        ["mode", finalMode],
        ["upiId", upiId],
        ["bankName", bankName],
        ["bankAccountName", bankAccountName],
        ["bankAccountNumber", bankAccountNumber],
        ["bankIfsc", bankIfsc],
        ["instructions", instructions],
      ];

      const saveAll = db.transaction(() => {
        for (const [key, value] of rows) {
          db.prepare(`
            INSERT INTO payment_settings (key, value, updatedAt)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
          `).run(key, value, now());
        }
      });
      saveAll();

      res.json({
        success: true,
        message: "Payment settings saved.",
        settings: buildAdminPaymentView(),
      });
    } catch (error) {
      console.error("PAYMENT SETTINGS SAVE ERROR:", error);
      res.status(500).json({ success: false, message: "Failed to save payment settings." });
    }
  }
);

// =====================================
// SECRET STORAGE (server-side only, write/delete only)
// =====================================
// A future gateway integration reads these with the server-side
// helper; no endpoint ever returns them.

export function setPaymentSecret(key, value) {
  const k = clean(key);
  if (!k) return;
  db.prepare(`
    INSERT INTO payment_secrets (key, value, updatedAt)
    VALUES (?, ?, ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updatedAt = excluded.updatedAt
  `).run(k, String(value ?? ""), now());
}

export function getPaymentSecret(key) {
  const row = db.prepare(`SELECT value FROM payment_secrets WHERE key = ?`).get(clean(key));
  return row ? row.value : null;
}

export default paymentAdminRouter;
