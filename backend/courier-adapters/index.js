// Courier adapter registry. Each partner is a separate module; adding
// or replacing one adapter cannot change another partner's behaviour.

import shiprocket, {
  ShiprocketAdapter,
  parseShiprocketWebhook,
  shiprocketWebhookConfigured,
} from "./shiprocket.js";
import indiaPost from "./india-post.js";
import ekart from "./ekart.js";
import dtdc from "./dtdc.js";
import delhivery from "./delhivery.js";
import xpressbees from "./xpressbees.js";

export const COURIER_ADAPTERS = {
  INDIA_POST: indiaPost,
  EKART: ekart,
  SHIPROCKET: shiprocket,
  DTDC: dtdc,
  DELHIVERY: delhivery,
  XPRESSBEES: xpressbees,
};

export function getCourierAdapter(code) {
  return COURIER_ADAPTERS[String(code || "").toUpperCase()] || null;
}

export function courierAdapterStatus(code) {
  const adapter = getCourierAdapter(code);
  if (!adapter) {
    return {
      code,
      name: code,
      hasApi: false,
      configured: false,
      mode: "manual",
      liveEnabled: false,
      missingEnv: [],
      envNames: { required: [], optional: [] },
      docs: "",
      onboarding: null,
      note: "No adapter is registered for this courier code. Manual Mode only.",
    };
  }
  return adapter.status();
}

export function courierEnvNames(code) {
  const adapter = getCourierAdapter(code);
  return adapter ? adapter.envNames() : { required: [], optional: [] };
}

export {
  ShiprocketAdapter,
  parseShiprocketWebhook,
  shiprocketWebhookConfigured,
};
