// ==========================================
// JUSTBRAND ADMIN — API base resolution
// ==========================================
// Single source of truth for where the Admin panel sends its API
// requests. Resolution order:
//   1. window.__JB_API_BASE__ — runtime override. The local preview
//      server injects `""` into index.html so the panel calls its OWN
//      origin (/api/...), which the preview proxies to an ISOLATED
//      local test backend. This global is never present in a normal
//      build, so production behaviour is unchanged.
//   2. import.meta.env.VITE_API_URL — existing build-time override
//      (convention already used by DeliveryManager).
//   3. The production JustBrand backend (default).
const PRODUCTION_API = "https://justbrand-in-144629.hostingersite.com";

const buildTimeApi =
  (typeof import.meta !== "undefined" && import.meta.env && import.meta.env.VITE_API_URL) ||
  "";

const hasRuntimeOverride =
  typeof window !== "undefined" &&
  window.__JB_API_BASE__ !== undefined &&
  window.__JB_API_BASE__ !== null;

// Note: an injected EMPTY string is a valid override — it means
// "same origin". Only fall through to the production URL when no
// runtime override was injected at all.
export const API = hasRuntimeOverride
  ? window.__JB_API_BASE__
  : buildTimeApi || PRODUCTION_API;
