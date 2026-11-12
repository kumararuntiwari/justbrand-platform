// =====================================================
// JUSTBRAND — COURIER ADAPTER BASE
// =====================================================
// Every courier company exposes its own adapter. Credentials are read
// only from server-side environment secrets. This module never writes
// credentials to SQLite, never returns them from an endpoint and never
// logs request bodies that may contain them.
//
// Modes:
//   manual     — no API access/credentials; the operator records the
//                courier's own AWB/label/status here.
//   sandbox    — credentials exist but COURIER_LIVE_ENABLED is not 1.
//                No external courier call is made and no success is faked.
//   live       — credentials exist and COURIER_LIVE_ENABLED=1.
// =====================================================

export function envPresent(name) {
  const value = process.env[name];
  return typeof value === "string" && value.trim().length > 0;
}

export function courierLiveEnabled() {
  return process.env.COURIER_LIVE_ENABLED === "1";
}

export function configuredFromEnv(requiredEnv) {
  const missing = requiredEnv.filter((name) => !envPresent(name));
  return { configured: missing.length === 0, missing };
}

export function isoNow() {
  return new Date().toISOString();
}

export function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

export function round2(value) {
  return Math.round((safeNumber(value) + Number.EPSILON) * 100) / 100;
}

export class CourierAdapter {
  constructor(config) {
    this.code = config.code;
    this.name = config.name;
    this.baseUrl = config.baseUrl || "";
    this.docs = config.docs || "";
    this.requiredEnv = config.requiredEnv || [];
    this.optionalEnv = config.optionalEnv || [];
    this.hasApi = Boolean(config.hasApi);
    this.onboarding = config.onboarding || null;
  }

  envNames() {
    return { required: [...this.requiredEnv], optional: [...this.optionalEnv] };
  }

  credentialsConfigured() {
    return false;
  }

  status() {
    const { configured, missing } = this.hasApi
      ? configuredFromEnv(this.requiredEnv)
      : { configured: false, missing: [...this.requiredEnv] };
    const liveEnabled = this.hasApi && configured && courierLiveEnabled();
    const mode = !this.hasApi || !configured ? "manual" : liveEnabled ? "live" : "sandbox";

    let note;
    if (!this.hasApi) {
      note = "No public live API is integrated for this partner. Manual Mode: book on the courier's own system and record the real AWB here. No fake booking or tracking is created.";
    } else if (!configured) {
      note = `Not configured: server-side environment secrets are missing (${missing.join(", ")}). No external call was made.`;
    } else if (!liveEnabled) {
      note = "Credentials present but COURIER_LIVE_ENABLED is not 1. Sandbox/dry-run only: no external courier call is made and no live success is faked.";
    } else {
      note = "Credentials present and COURIER_LIVE_ENABLED=1. Live API mode.";
    }

    return {
      code: this.code,
      name: this.name,
      hasApi: this.hasApi,
      configured,
      mode,
      liveEnabled,
      missingEnv: missing,
      envNames: this.envNames(),
      docs: this.docs,
      onboarding: this.onboarding,
      note,
    };
  }

  async testConnection() {
    const status = this.status();
    return {
      ok: false,
      status: status.mode === "manual" ? "manual" : "not_configured",
      mode: status.mode,
      at: isoNow(),
      liveCalled: false,
      message: status.note,
    };
  }

  // A manual adapter never contacts a courier and never fabricates a
  // tracking scan. The returned failure tells the caller to use the
  // manual workflow instead.
  async notSupported(action) {
    return {
      ok: false,
      mode: "manual",
      reason: "manual",
      message: `${this.name}: ${action} is not available through a live API. Use Manual Mode and record the courier's own reference.`,
    };
  }

  async getRates() {
    return this.notSupported("rate/serviceability lookup");
  }

  async createShipment() {
    return this.notSupported("shipment creation");
  }

  async generateLabel() {
    return this.notSupported("label generation");
  }

  async generateManifest() {
    return this.notSupported("manifest generation");
  }

  async requestPickup() {
    return this.notSupported("pickup request");
  }

  async track() {
    return this.notSupported("tracking refresh");
  }

  async cancel() {
    return this.notSupported("cancellation");
  }

  async ndrAction() {
    return this.notSupported("NDR action");
  }
}
