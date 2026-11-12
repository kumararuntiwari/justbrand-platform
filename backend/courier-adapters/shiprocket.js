// =====================================================
// SHIPROCKET — REAL API ADAPTER (SERVER-SIDE ONLY)
// =====================================================
// Official base URL: https://apiv2.shiprocket.in/v1/external
// Auth: POST /auth/login (token valid for 240 hours; cached in memory).
// Everything else uses the bearer token.
//
// No request is made unless credentials exist AND COURIER_LIVE_ENABLED=1.
// In sandbox mode this adapter reports that it did not call Shiprocket —
// it never invents a live AWB, label, pickup or scan.
// =====================================================

import {
  CourierAdapter,
  configuredFromEnv,
  courierLiveEnabled,
  envPresent,
  isoNow,
  round2,
  safeNumber,
} from "./base.js";

const TOKEN_TTL_MS = 230 * 60 * 60 * 1000;
let tokenCache = { token: "", expiresAt: 0 };

function apiBase() {
  return (process.env.SHIPROCKET_BASE_URL || "https://apiv2.shiprocket.in").replace(/\/+$/, "");
}

function extractMessage(data) {
  if (!data) return "";
  if (typeof data === "string") return data.slice(0, 300);
  return String(data.message || data.error || data.errors || "").slice(0, 300);
}

async function request(path, { method = "GET", body, token, timeoutMs = 15000 } = {}) {
  const response = await fetch(`${apiBase()}/v1/external${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeoutMs),
  });

  const text = await response.text();
  if (text.length > 2_000_000) {
    return { ok: false, status: response.status, data: null, message: "Shiprocket response was too large." };
  }

  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch {
    data = text.slice(0, 500);
  }

  return {
    ok: response.ok,
    status: response.status,
    data,
    message: extractMessage(data) || (response.ok ? "" : `Shiprocket HTTP ${response.status}`),
  };
}

async function getToken(force = false) {
  if (!force && tokenCache.token && tokenCache.expiresAt > Date.now()) {
    return tokenCache.token;
  }

  const directToken = process.env.SHIPROCKET_TOKEN;
  if (!force && typeof directToken === "string" && directToken.trim()) {
    tokenCache = { token: directToken.trim(), expiresAt: Date.now() + TOKEN_TTL_MS };
    return tokenCache.token;
  }

  const result = await request("/auth/login", {
    method: "POST",
    body: {
      email: process.env.SHIPROCKET_EMAIL,
      password: process.env.SHIPROCKET_PASSWORD,
    },
    timeoutMs: 12000,
  });

  const token = result.ok ? String(result.data?.token || "") : "";
  if (!token) {
    throw new Error(`Shiprocket authentication failed${result.status ? ` (${result.status})` : ""}.`);
  }

  tokenCache = { token, expiresAt: Date.now() + TOKEN_TTL_MS };
  return token;
}

async function authenticated(path, options = {}) {
  let token;
  try {
    token = await getToken();
  } catch (error) {
    return { ok: false, status: 0, data: null, message: error.message };
  }

  let result = await request(path, { ...options, token });

  // A rotated/expired token is retried once with a fresh login. The
  // credentials/body are never logged, and an auth failure is returned
  // honestly instead of turning into a fake success.
  if (result.status === 401) {
    tokenCache = { token: "", expiresAt: 0 };
    try {
      token = await getToken(true);
    } catch (error) {
      return { ok: false, status: 401, data: null, message: error.message };
    }
    result = await request(path, { ...options, token });
  }

  return result;
}

function normalizeRates(data) {
  const rows =
    data?.data?.available_courier_companies ||
    data?.available_courier_companies ||
    [];
  if (!Array.isArray(rows)) return [];

  return rows
    .map((row) => ({
      courierCompanyId: String(row.courier_company_id ?? ""),
      courierName: String(row.courier_name || "Shiprocket courier"),
      rate: round2(row.rate ?? row.freight_charges ?? 0),
      codCharge: round2(row.cod_charges ?? 0),
      estimatedDeliveryDays: Math.max(
        0,
        Number(row.estimated_delivery_days ?? row.etd_hours ?? 0) || 0
      ),
      etd: row.etd || null,
      rating: safeNumber(row.rating, 0),
      deliveryPerformance: safeNumber(row.delivery_performance, 0),
      raw: null,
    }))
    .filter((row) => row.courierCompanyId && row.courierName)
    .sort((a, b) => a.rate - b.rate);
}

function normalizeTracking(data) {
  const tracking = data?.tracking_data || data?.data || {};
  const shipment =
    tracking?.shipment_track?.[0] ||
    tracking?.shipment_track ||
    tracking?.shipments?.[0] ||
    null;
  const activities =
    tracking?.shipment_track_activities ||
    tracking?.activities ||
    shipment?.activities ||
    [];

  const history = (Array.isArray(activities) ? activities : [])
    .map((event) => ({
      at: event.date || event.timestamp || null,
      status: event["sr-status-label"] || event.status || event.activity || null,
      note: event.activity || event.location || "",
      location: event.location || "",
    }))
    .filter((event) => event.status || event.note);

  return {
    awb: String(tracking?.awb || shipment?.awb_code || ""),
    status:
      tracking?.track_status ||
      shipment?.current_status ||
      shipment?.status ||
      history[history.length - 1]?.status ||
      "",
    courierName: String(shipment?.courier_name || tracking?.courier_name || ""),
    etd: shipment?.edd || tracking?.etd || null,
    deliveredAt: shipment?.delivered_date || null,
    history,
  };
}

export class ShiprocketAdapter extends CourierAdapter {
  constructor() {
    super({
      code: "SHIPROCKET",
      name: "Shiprocket",
      baseUrl: "https://apiv2.shiprocket.in",
      docs: "https://apidocs.shiprocket.in/",
      hasApi: true,
      requiredEnv: ["SHIPROCKET_EMAIL", "SHIPROCKET_PASSWORD"],
      optionalEnv: [
        "SHIPROCKET_TOKEN",
        "SHIPROCKET_PICKUP_LOCATION",
        "SHIPROCKET_PICKUP_PINCODE",
        "SHIPROCKET_WEBHOOK_TOKEN",
      ],
      onboarding: {
        type: "self_serve_api",
        title: "Shiprocket API user",
        steps: [
          "Create/activate a Shiprocket seller account and complete KYC.",
          "Create an API user in Shiprocket (Settings → API) and copy its email/password.",
          "Add a pickup location in Shiprocket with the exact nickname you will send as pickup_location.",
          "Set SHIPROCKET_EMAIL and SHIPROCKET_PASSWORD in server-side secrets; set COURIER_LIVE_ENABLED=1 only when ready for real bookings.",
          "Add the webhook URL in Shiprocket Settings → API → Webhooks and set SHIPROCKET_WEBHOOK_TOKEN to the same x-api-key value.",
        ],
        webhookPath: "/api/courier/webhook/shiprocket",
      },
    });
  }

  credentialsConfigured() {
    return configuredFromEnv(this.requiredEnv).configured;
  }

  status() {
    const base = super.status();
    return {
      ...base,
      credentialsConfigured: this.credentialsConfigured(),
      baseUrl: apiBase(),
    };
  }

  async testConnection() {
    const status = this.status();
    const at = isoNow();

    if (!status.configured) {
      return {
        ok: false,
        status: "not_configured",
        mode: "manual",
        at,
        liveCalled: false,
        missingEnv: status.missingEnv,
        message: `Not configured — missing ${status.missingEnv.join(", ")}. No external call was made.`,
      };
    }

    if (!courierLiveEnabled()) {
      return {
        ok: false,
        status: "sandbox_not_called",
        mode: "sandbox",
        at,
        liveCalled: false,
        message:
          "Credentials are present, but COURIER_LIVE_ENABLED is not 1. No Shiprocket call was made; this is not a live success.",
      };
    }

    try {
      const token = await getToken(true);
      return {
        ok: Boolean(token),
        status: token ? "connected" : "auth_failed",
        mode: "live",
        at,
        liveCalled: true,
        message: token ? "Live Shiprocket login succeeded." : "Shiprocket did not return a token.",
      };
    } catch (error) {
      return {
        ok: false,
        status: "auth_failed",
        mode: "live",
        at,
        liveCalled: true,
        message: error.message,
      };
    }
  }

  async getRates({ pickupPincode, deliveryPincode, weightKg, cod, declaredValue }) {
    const status = this.status();
    if (status.mode !== "live") {
      return {
        ok: false,
        mode: status.mode,
        reason: status.mode === "sandbox" ? "sandbox" : "not_configured",
        message:
          status.mode === "sandbox"
            ? "Shiprocket sandbox: no live rate call was made. Use configured partner rules for an estimate."
            : "Shiprocket is not configured; no live rate call was made.",
        quotes: [],
      };
    }

    if (!/^\d{6}$/.test(String(pickupPincode || ""))) {
      return { ok: false, mode: "live", reason: "pickup_pincode", message: "A valid pickup PIN code is required.", quotes: [] };
    }
    if (!/^\d{6}$/.test(String(deliveryPincode || ""))) {
      return { ok: false, mode: "live", reason: "delivery_pincode", message: "A valid delivery PIN code is required.", quotes: [] };
    }

    const query = new URLSearchParams({
      pickup_postcode: String(pickupPincode),
      delivery_postcode: String(deliveryPincode),
      cod: cod ? "1" : "0",
      weight: String(Math.max(0.01, safeNumber(weightKg, 0.5))),
    });
    if (declaredValue) query.set("declared_value", String(Math.max(0, safeNumber(declaredValue))));

    const result = await authenticated(`/courier/serviceability/?${query.toString()}`);
    if (!result.ok) {
      return {
        ok: false,
        mode: "live",
        reason: "api_error",
        statusCode: result.status,
        message: result.message || "Shiprocket serviceability failed.",
        quotes: [],
      };
    }

    const quotes = normalizeRates(result.data);
    return {
      ok: true,
      mode: "live",
      source: "shiprocket_live",
      quotes,
      message: quotes.length ? `${quotes.length} live Shiprocket courier option(s).` : "No Shiprocket courier is serviceable for this route.",
    };
  }

  async createShipment({ payload, courierCompanyId, requestPickup = false, generateLabel = false }) {
    const status = this.status();
    if (status.mode !== "live") {
      return {
        ok: false,
        mode: status.mode,
        reason: status.mode === "sandbox" ? "sandbox" : "not_configured",
        message: "No live Shiprocket booking was made.",
      };
    }

    const created = await authenticated("/orders/create/adhoc", { method: "POST", body: payload });
    if (!created.ok) {
      return { ok: false, mode: "live", reason: "create_failed", statusCode: created.status, message: created.message || "Shiprocket order creation failed." };
    }

    const providerOrderId = created.data?.order_id ? String(created.data.order_id) : "";
    const providerShipmentId = created.data?.shipment_id ? String(created.data.shipment_id) : "";
    if (!providerShipmentId) {
      return { ok: false, mode: "live", reason: "missing_shipment_id", message: "Shiprocket did not return a shipment_id." };
    }

    let awbNumber = String(created.data?.awb_code || "");
    let courierName = String(created.data?.courier_name || "");
    let assignment = null;

    if (courierCompanyId) {
      assignment = await authenticated("/courier/assign/awb", {
        method: "POST",
        body: {
          shipment_id: Number(providerShipmentId),
          courier_id: Number(courierCompanyId),
        },
      });
      if (!assignment.ok) {
        return {
          ok: false,
          mode: "live",
          reason: "awb_failed",
          statusCode: assignment.status,
          message: assignment.message || "Shiprocket AWB assignment failed.",
          providerOrderId,
          providerShipmentId,
        };
      }
      const assigned = assignment.data?.response?.data || assignment.data?.data || assignment.data || {};
      awbNumber = String(assigned.awb_code || assigned.awb || awbNumber || "");
      courierName = String(assigned.courier_name || courierName || "");
    }

    let labelUrl = "";
    let manifestUrl = "";
    let pickupToken = "";
    const warnings = [];

    if (generateLabel && awbNumber) {
      const label = await this.generateLabel({ providerShipmentId });
      if (label.ok) labelUrl = label.labelUrl || "";
      else warnings.push(label.message);
    }

    if (requestPickup && awbNumber) {
      const pickup = await this.requestPickup({ providerShipmentId });
      if (pickup.ok) pickupToken = pickup.pickupToken || "";
      else warnings.push(pickup.message);
    }

    if (requestPickup && awbNumber) {
      const manifest = await this.generateManifest({ providerShipmentId });
      if (manifest.ok) manifestUrl = manifest.manifestUrl || "";
      else warnings.push(manifest.message);
    }

    return {
      ok: true,
      mode: "live",
      providerOrderId,
      providerShipmentId,
      awbNumber,
      courierName,
      labelUrl,
      manifestUrl,
      pickupToken,
      warnings,
      rawStatus: created.data?.status || "",
      message: awbNumber
        ? `Shiprocket shipment created with AWB ${awbNumber}.`
        : "Shiprocket order created; AWB is not assigned yet.",
    };
  }

  async generateLabel({ providerShipmentId }) {
    if (this.status().mode !== "live") {
      return { ok: false, mode: this.status().mode, message: "Label generation requires live Shiprocket credentials and COURIER_LIVE_ENABLED=1." };
    }
    const result = await authenticated("/courier/generate/label", {
      method: "POST",
      body: { shipment_id: [Number(providerShipmentId)] },
    });
    if (!result.ok) return { ok: false, mode: "live", message: result.message || "Shiprocket label generation failed." };
    const labelUrl = String(result.data?.label_url || result.data?.data?.label_url || "");
    return { ok: Boolean(labelUrl), mode: "live", labelUrl, message: labelUrl ? "Label generated." : "Shiprocket did not return a label URL." };
  }

  async generateManifest({ providerShipmentId }) {
    if (this.status().mode !== "live") {
      return { ok: false, mode: this.status().mode, message: "Manifest generation requires live Shiprocket credentials and COURIER_LIVE_ENABLED=1." };
    }
    const result = await authenticated("/manifests/generate", {
      method: "POST",
      body: { shipment_id: [Number(providerShipmentId)] },
    });
    if (!result.ok) return { ok: false, mode: "live", message: result.message || "Shiprocket manifest generation failed." };
    const manifestUrl = String(result.data?.manifest_url || result.data?.data?.manifest_url || "");
    return { ok: Boolean(manifestUrl), mode: "live", manifestUrl, message: manifestUrl ? "Manifest generated." : "Shiprocket did not return a manifest URL." };
  }

  async requestPickup({ providerShipmentId }) {
    if (this.status().mode !== "live") {
      return { ok: false, mode: this.status().mode, message: "Pickup requires live Shiprocket credentials and COURIER_LIVE_ENABLED=1." };
    }
    const result = await authenticated("/courier/generate/pickup", {
      method: "POST",
      body: { shipment_id: [Number(providerShipmentId)] },
    });
    if (!result.ok) return { ok: false, mode: "live", message: result.message || "Shiprocket pickup request failed." };
    const pickupToken = String(
      result.data?.pickup_token_number ||
        result.data?.response?.pickup_token_number ||
        result.data?.data?.pickup_token_number ||
        ""
    );
    return {
      ok: result.data?.success !== false,
      mode: "live",
      pickupToken,
      scheduledAt: result.data?.pickup_scheduled_date || result.data?.response?.pickup_scheduled_date || null,
      message: result.data?.message || "Pickup requested.",
    };
  }

  async track({ awbNumber }) {
    if (this.status().mode !== "live") {
      return { ok: false, mode: this.status().mode, message: "Live tracking requires Shiprocket credentials and COURIER_LIVE_ENABLED=1." };
    }
    if (!awbNumber) return { ok: false, mode: "live", message: "AWB is required." };

    const result = await authenticated(`/courier/track/awb/${encodeURIComponent(awbNumber)}`);
    if (!result.ok) return { ok: false, mode: "live", message: result.message || "Shiprocket tracking failed." };
    return { ok: true, mode: "live", tracking: normalizeTracking(result.data), message: "Shiprocket tracking refreshed." };
  }

  async cancel({ providerOrderId, awbNumber }) {
    if (this.status().mode !== "live") {
      return { ok: false, mode: this.status().mode, message: "Cancellation requires live Shiprocket credentials and COURIER_LIVE_ENABLED=1." };
    }

    if (providerOrderId) {
      const result = await authenticated("/orders/cancel", {
        method: "POST",
        body: { ids: [Number(providerOrderId)] },
      });
      if (result.ok) return { ok: true, mode: "live", message: result.message || "Shiprocket order cancelled." };
    }

    if (awbNumber) {
      const result = await authenticated("/shipments/cancel", {
        method: "POST",
        body: { awbs: [awbNumber] },
      });
      if (result.ok) return { ok: true, mode: "live", message: result.message || "Shiprocket shipment cancelled." };
      return { ok: false, mode: "live", message: result.message || "Shiprocket cancellation failed." };
    }

    return { ok: false, mode: "live", message: "No Shiprocket order id or AWB is stored for cancellation." };
  }

  async ndrAction({ awbNumber, action, remarks, address }) {
    if (this.status().mode !== "live") {
      return { ok: false, mode: this.status().mode, message: "NDR actions require live Shiprocket credentials and COURIER_LIVE_ENABLED=1." };
    }
    if (!awbNumber) return { ok: false, mode: "live", message: "AWB is required for an NDR action." };

    const allowed = new Set(["reattempt", "rto", "change_address", "reschedule"]);
    if (!allowed.has(action)) {
      return { ok: false, mode: "live", message: "NDR action must be reattempt, rto, change_address or reschedule." };
    }

    const body = { action, ...(remarks ? { remarks: String(remarks).slice(0, 300) } : {}) };
    if (action === "change_address" && address) {
      body.address = address;
    }

    const result = await authenticated(`/ndr/${encodeURIComponent(awbNumber)}/action`, {
      method: "POST",
      body,
    });
    return {
      ok: result.ok && result.data?.success !== false,
      mode: "live",
      message: result.message || (result.ok ? `NDR action ${action} submitted.` : "NDR action failed."),
    };
  }
}

export function shiprocketWebhookConfigured() {
  return envPresent("SHIPROCKET_WEBHOOK_TOKEN");
}

export function parseShiprocketWebhook(payload) {
  const body = payload || {};
  const scans = Array.isArray(body.scans) ? body.scans : [];
  return {
    awbNumber: String(body.awb || body.awb_code || ""),
    providerOrderId: body.sr_order_id ? String(body.sr_order_id) : "",
    providerShipmentId: body.shipment_id ? String(body.shipment_id) : "",
    courierName: String(body.courier_name || ""),
    status: String(body.current_status || body.shipment_status || ""),
    etd: body.etd || null,
    eventAt: body.current_timestamp || null,
    scans: scans.map((scan) => ({
      at: scan.date || null,
      status: scan["sr-status-label"] || scan.status || null,
      note: scan.activity || "",
      location: scan.location || "",
    })),
  };
}

export default new ShiprocketAdapter();
