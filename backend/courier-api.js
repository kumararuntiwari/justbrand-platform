// =====================================================
// JUSTBRAND — COURIER API ADAPTER (SERVER-SIDE ONLY)
// =====================================================
// Secure bridge to real courier/aggregator APIs (Shiprocket first).
// Design rules (NON-NEGOTIABLE):
//   - Credentials are read ONLY from server-side secrets (process.env,
//     e.g. Freebuff Settings → Environment). They are NEVER stored in
//     the database, NEVER returned by any endpoint, NEVER logged and
//     never committed to Git. Endpoints only report WHETHER credentials
//     exist and the NAMES of the missing env vars.
//   - SANDBOX / DRY-RUN BY DEFAULT. Shipment creation returns a clearly
//     labelled TEST/mock AWB + label reference. No real booking, pickup
//     or courier contact ever happens from the preview.
//   - LIVE calls are possible ONLY when BOTH real credentials exist AND
//     the operator has explicitly set COURIER_LIVE_ENABLED=1. In this
//     preview that flag is absent, so every path is a dry-run/sandbox.
//     We never fake a live success — a dry-run is reported as a dry-run.
//   - Endpoint paths + payload fields follow Shiprocket's official API
//     (https://apiv2.shiprocket.in):
//       POST /v1/external/auth/login          → token (240h)
//       POST /v1/external/orders/create/adhoc → order + shipment_id
//       POST /v1/external/courier/assign/awb  → awb_code
//       POST /v1/external/courier/generate/label → PDF URL
//       GET  /v1/external/courier/track/awb/{awb}
// =====================================================

// Only shiprocket has a documented aggregator API wired here. The other
// partners stay in Manual Mode (no live API is integrated for them, so
// we never pretend otherwise).
const API_PARTNERS = {
  SHIPROCKET: {
    name: "Shiprocket",
    baseUrl: "https://apiv2.shiprocket.in",
    // Env var NAMES (not values) that must be present to be "configured".
    requiredEnv: ["SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD"],
    optionalEnv: ["SHIPROCKET_TOKEN"],
    docs: "https://apiv2.shiprocket.in/v1/external/auth/login",
  },
};

// Every seeded partner we might ask about (non-API partners report
// "manual — no API integrated").
const KNOWN_PARTNERS = {
  SHIPROCKET: true,
  DTDC: "manual",
  INDIA_POST: "manual",
  EKART: "manual",
};

function envPresent(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

function liveEnabled() {
  return process.env.COURIER_LIVE_ENABLED === "1";
}

// Env var NAMES for a partner (safe to show — names only, never values).
export function envNamesFor(code) {
  const spec = API_PARTNERS[code];
  if (!spec) return { required: [], optional: [] };
  return { required: [...spec.requiredEnv], optional: [...spec.optionalEnv] };
}

// Honest connection status for the admin UI. Reports configured/not-
// configured + the mode. NEVER exposes any secret value.
export function apiConfigStatus(code) {
  const spec = API_PARTNERS[code];

  if (!spec) {
    // No live API is integrated for this partner — Manual Mode only.
    return {
      code,
      hasApi: false,
      configured: false,
      mode: "manual",
      missingEnv: [],
      envNames: { required: [], optional: [] },
      liveEnabled: false,
      note: "No courier API is integrated for this partner — Manual Mode. Book on the courier's own system and record the AWB here.",
    };
  }

  const missing = spec.requiredEnv.filter((name) => !envPresent(name));
  const configured = missing.length === 0;
  const canGoLive = configured && liveEnabled();

  let mode = "manual";
  if (configured) mode = canGoLive ? "live" : "sandbox";
  else mode = "manual";

  return {
    code,
    hasApi: true,
    configured,
    mode,
    missingEnv: missing, // names only
    envNames: { required: [...spec.requiredEnv], optional: [...spec.optionalEnv] },
    liveEnabled: canGoLive,
    note: configured
      ? canGoLive
        ? "Credentials present and COURIER_LIVE_ENABLED=1 — live API mode."
        : "Credentials present. SANDBOX / DRY-RUN mode: shipment creation returns a clearly labelled TEST AWB. No live booking is made. Set COURIER_LIVE_ENABLED=1 (server-side) to enable real bookings."
      : "Not configured: server-side credentials are missing. Set them in Settings → Environment (secrets). No test call was made and no fake success is shown.",
  };
}

// =====================================================
// SHIPROCKET — official payload builder (adhoc order)
// =====================================================
// Builds the exact domestic adhoc-order payload per Shiprocket's docs.
// Used for (a) the admin payload preview and (b) sandbox shipment rows.
export function buildShiprocketPayload({ order, partner, items }) {
  const nameParts = String(order.customerName || "Customer").trim().split(/\s+/);
  const firstName = nameParts[0] || "Customer";
  const lastName = nameParts.slice(1).join(" ") || "-";

  return {
    pickup_location: partner.pickupLocation || "Primary",
    billing_customer_name: firstName,
    billing_last_name: lastName,
    billing_address: order.address || "",
    billing_address_2: order.city || "",
    billing_city: order.city || "",
    billing_pincode: String(order.pincode || ""),
    billing_state: order.state || "",
    billing_country: "India",
    billing_email: order.email || "",
    billing_phone: String(order.phone || ""),
    shipping_is_billing: true,
    order_items: (items || []).map((item) => ({
      name: item.name || `Item ${item.productId}`,
      sku: item.sku || `JB-${item.productId}`,
      units: Number(item.quantity) || 1,
      selling_price: Number(item.price) || 0,
    })),
    // Parcel dimensions (cm) + weight (kg) — defaults until product
    // dimensions are configured. Never guessed into pricing.
    length: Number(partner.dimLength) || 10,
    breadth: Number(partner.dimBreadth) || 10,
    height: Number(partner.dimHeight) || 5,
    weight: Number(partner.dimWeight) || 0.5,
    payment_method: order.paymentMethod === "COD" ? "COD" : "Prepaid",
    ...(order.paymentMethod === "COD"
      ? { cod_amount: Number(order.totalAmount) || 0 }
      : {}),
    sub_total: Number(order.totalAmount) || 0,
  };
}

// =====================================================
// SANDBOX / MOCK SHIPMENT CREATION
// =====================================================
// Returns a clearly-labelled TEST AWB + label reference. This is NOT a
// real booking and never contacts a courier.
export function createSandboxShipment({ code, orderId }) {
  const rand = Math.random().toString(36).slice(2, 8).toUpperCase();
  return {
    mode: "sandbox",
    awbNumber: `TEST-${code}-${orderId}-${rand}`,
    shippingLabelRef: `LBL-TEST-${orderId}-${rand}`,
    note: "Sandbox / mock shipment — NOT a real booking. No courier was contacted. The TEST- AWB is for workflow verification only.",
  };
}

// =====================================================
// TEST CONNECTION (dry-run by default; never fakes success)
// =====================================================
export async function testConnection(code) {
  const status = apiConfigStatus(code);
  const at = new Date().toISOString();

  if (!status.hasApi) {
    return {
      ok: false,
      status: "manual",
      mode: "manual",
      at,
      liveCalled: false,
      message: `No courier API is integrated for ${code} — Manual Mode only. Nothing was tested.`,
    };
  }

  if (!status.configured) {
    // HONEST: not configured → no fake success, no live call.
    return {
      ok: false,
      status: "not_configured",
      mode: "manual",
      at,
      liveCalled: false,
      missingEnv: status.missingEnv,
      message: `Not configured — server-side credentials are missing (${status.missingEnv.join(", ")}). Set them in Settings → Environment. No live call was made.`,
    };
  }

  if (!status.liveEnabled) {
    // Configured but live flag off → report a DRY-RUN, clearly.
    return {
      ok: true,
      status: "configured_dry_run",
      mode: "sandbox",
      at,
      liveCalled: false,
      message:
        "Credentials present. DRY-RUN only — live API is disabled (COURIER_LIVE_ENABLED is not set), so no live login was attempted. Shipment creation will produce a labelled TEST AWB.",
    };
  }

  // LIVE path — only reachable with real credentials AND the explicit
  // COURIER_LIVE_ENABLED=1 flag. Never taken in the preview.
  const spec = API_PARTNERS[code];
  try {
    const response = await fetch(`${spec.baseUrl}/v1/external/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: process.env.SHIPROCKET_EMAIL,
        password: process.env.SHIPROCKET_PASSWORD,
      }),
      signal: AbortSignal.timeout(10000),
    });
    const data = await response.json().catch(() => null);
    const ok = response.ok && Boolean(data?.token);
    return {
      ok,
      status: ok ? "connected" : "auth_failed",
      mode: "live",
      at,
      liveCalled: true,
      message: ok
        ? "Live login succeeded (token issued)."
        : `Live login failed (${response.status}). Check credentials.`,
    };
  } catch (error) {
    return {
      ok: false,
      status: "error",
      mode: "live",
      at,
      liveCalled: true,
      message: `Live connection error: ${error?.message || "network failure"}.`,
    };
  }
}
