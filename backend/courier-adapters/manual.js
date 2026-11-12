// Shared shape for courier partners whose live API is not integrated.
// Each partner still gets its own adapter file/config (env names,
// onboarding requirements and docs), so enabling one later does not
// affect any other partner.

import { CourierAdapter, isoNow } from "./base.js";

export class ManualPartnerAdapter extends CourierAdapter {
  constructor(config) {
    super({ ...config, hasApi: false });
  }

  status() {
    return {
      code: this.code,
      name: this.name,
      hasApi: false,
      configured: false,
      mode: "manual",
      liveEnabled: false,
      missingEnv: [...this.requiredEnv],
      envNames: this.envNames(),
      docs: this.docs,
      onboarding: this.onboarding,
      note: `${this.name}: Manual / Not Configured. No live API is connected, so no fake booking or tracking is created. Book on ${this.name}'s own system and record the real AWB here.`,
    };
  }

  async testConnection() {
    return {
      ok: false,
      status: "manual",
      mode: "manual",
      at: isoNow(),
      liveCalled: false,
      missingEnv: [...this.requiredEnv],
      message: `Manual / Not Configured — no live ${this.name} API is integrated. No connection test or external call was made.`,
    };
  }
}
