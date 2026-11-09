// =====================================================
// JUSTBRAND — SELLER TAX PROFILE (PAN / GST) HELPERS
// =====================================================
// Pure helpers only (no DB, no Express). The business router owns
// persistence and audit logging.
//
// LIVE POLICY: GST is mandatory for every seller. A seller may add a
// GSTIN after registration, but no product can be listed, approved or
// sold until KYC is Approved, PAN is Verified and an Admin has approved
// the GSTIN. The GST-unregistered / non-GST route is disabled entirely;
// historical rows and invoice snapshots remain readable but never grant
// new selling permission.
//
// The platform cannot lawfully "verify" PAN/GSTIN without a provider.
// PAN starts as Pending Verification and only an admin can mark it
// Verified after document review. Nothing here ever reports Verified
// automatically.

export const PAN_STATUS = {
  PENDING: "Pending Verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export const GST_STATUS = {
  UNREGISTERED: "GST Unregistered",
  PENDING: "GST Verification Pending",
  REGISTERED: "GST Registered",
  REJECTED: "GST Rejected",
  LEGACY: "Legacy / Not Captured",
};

export const ENROLMENT_STATUS = {
  NOT_PROVIDED: "Not Provided",
  PENDING: "Pending Verification",
  VERIFIED: "Verified",
  REJECTED: "Rejected",
};

export const INVOICE_TYPE = {
  TAX: "TAX_INVOICE",
  NON_GST: "NON_GST_INVOICE",
};

const PAN_RE = /^[A-Z]{5}[0-9]{4}[A-Z]$/;
const PAN_ENTITY_CHARS = new Set(["P", "C", "H", "F", "A", "T", "B", "L", "J", "G"]);

export function cleanTaxText(value, max = 200) {
  return String(value ?? "").trim().replace(/\s+/g, " ").slice(0, max);
}

export function normalizeTaxState(value) {
  return cleanTaxText(value, 80).toLowerCase().replace(/[^a-z]/g, "");
}

export function maskTaxId(value) {
  const id = cleanTaxText(value, 20).toUpperCase();
  if (!id) return "";
  if (id.length <= 4) return `••••${id}`;
  return `${"•".repeat(Math.max(0, id.length - 4))}${id.slice(-4)}`;
}

export function validatePan(raw) {
  const pan = cleanTaxText(raw, 10).toUpperCase();
  if (!pan) return { ok: false, message: "PAN number is required." };
  if (!PAN_RE.test(pan)) {
    return { ok: false, message: "PAN must be in the format ABCDE1234F." };
  }
  if (!PAN_ENTITY_CHARS.has(pan[3])) {
    return { ok: false, message: "PAN's fourth character is not a valid holder type." };
  }
  return { ok: true, value: pan };
}

// GSTIN checksum: base-36 alternating weights 1/2, as prescribed by
// the GSTN validation algorithm.
export function validateGstin(raw) {
  const gstin = cleanTaxText(raw, 15).toUpperCase();
  if (!gstin) return { ok: false, message: "GSTIN is required." };
  if (!/^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/.test(gstin)) {
    return { ok: false, message: "GSTIN must be a valid 15-character GSTIN." };
  }
  const stateCode = Number(gstin.slice(0, 2));
  if (!(stateCode >= 1 && stateCode <= 38)) {
    return { ok: false, message: "GSTIN has an invalid State code." };
  }
  const chars = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  let sum = 0;
  for (let i = 0; i < 14; i += 1) {
    const value = chars.indexOf(gstin[i]);
    const factor = i % 2 === 0 ? 1 : 2;
    sum += Math.floor((value * factor) / 36) + ((value * factor) % 36);
  }
  const check = (36 - (sum % 36)) % 36;
  if (chars[check] !== gstin[14]) {
    return { ok: false, message: "GSTIN checksum is invalid." };
  }
  return { ok: true, value: gstin };
}

export function gstinStateCode(gstin) {
  const value = cleanTaxText(gstin, 15).toUpperCase();
  return /^[0-9]{2}/.test(value) ? value.slice(0, 2) : "";
}

// `profile` is a flat seller+KYC row. There is no legacy selling bypass:
// a profile without tax details is blocked just like a new seller.
export function computeSellerTaxEligibility(profile = {}) {
  const legacy = !Number(profile.taxProfileConfigured);
  const panNumber = cleanTaxText(profile.panNumber, 10).toUpperCase();
  const panStatus = cleanTaxText(profile.panStatus) || PAN_STATUS.PENDING;
  const gstStatus =
    cleanTaxText(profile.gstStatus) ||
    (cleanTaxText(profile.gstNumber) ? GST_STATUS.PENDING : GST_STATUS.UNREGISTERED);
  const gstNumber = cleanTaxText(profile.gstNumber, 15).toUpperCase();
  const businessType = cleanTaxText(profile.businessType) || "goods";
  const state = cleanTaxText(profile.state, 80);
  const enrolmentNumber = cleanTaxText(profile.enrolmentNumber, 40);
  const enrolmentStatus =
    cleanTaxText(profile.enrolmentStatus) || ENROLMENT_STATUS.NOT_PROVIDED;
  const unregisteredApproved =
    profile.unregisteredSellingApproved === true ||
    profile.unregisteredSellingApproved === 1 ||
    profile.unregisteredSellingApproved === "1" ||
    profile.unregisteredSellingApproved === "true";
  const kycStatus = cleanTaxText(profile.kycStatus) || "Pending";

  const blockers = [];
  if (kycStatus !== "Approved") blockers.push("Admin KYC approval is pending.");
  if (!panNumber) blockers.push("PAN is required.");
  if (panStatus === PAN_STATUS.REJECTED) blockers.push("PAN was rejected by admin.");
  if (panStatus !== PAN_STATUS.VERIFIED) blockers.push("PAN verification is pending.");
  if (!state) blockers.push("Seller's place of business State is required.");

  if (!gstNumber) {
    blockers.push("GSTIN is required before listing or selling products.");
  }
  if (gstStatus === GST_STATUS.PENDING) {
    blockers.push("Admin GSTIN approval is pending.");
  } else if (gstStatus === GST_STATUS.REJECTED) {
    blockers.push("GSTIN was rejected by admin. Correct it and resubmit for approval.");
  } else if (gstStatus !== GST_STATUS.REGISTERED) {
    blockers.push("Admin GSTIN approval is required before listing or selling.");
  }

  const canSell = blockers.length === 0 && gstStatus === GST_STATUS.REGISTERED;
  return {
    legacy,
    canSell,
    taxTreatment: canSell ? "gst" : "blocked",
    invoiceType: canSell ? INVOICE_TYPE.TAX : null,
    gstStatus,
    panStatus,
    panNumber,
    gstNumber,
    state,
    businessType,
    enrolmentNumber,
    enrolmentStatus,
    unregisteredApproved,
    intraStateOnly: false,
    blockers: canSell ? [] : blockers,
    note: legacy
      ? "Legacy seller profile — new selling is blocked until PAN/GSTIN are captured and approved. Existing orders and invoices are unchanged."
      : "KYC, PAN verification and Admin GSTIN approval are required before listing or selling.",
  };
}

// A non-GST seller may only sell within its own State. The buyer's
// destination State is mandatory for this check; an unknown destination
// is blocked rather than assumed intra-State.
export function isIntraState(profile, destinationState) {
  const sellerState = normalizeTaxState(profile?.state);
  const buyerState = normalizeTaxState(destinationState);
  return Boolean(sellerState && buyerState && sellerState === buyerState);
}
