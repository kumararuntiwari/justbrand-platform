// ==========================================
// SELLER APP — API BASE (preview isolation)
// ==========================================
// The Freebuff PREVIEW server injects BOTH markers before the bundle:
//   window.__JB_PREVIEW__   = true   (we are being served by the preview)
//   window.__JB_API_BASE__  = ""     (same origin → /api proxied to the
//                                     ISOLATED local preview backend)
// Preview therefore can NEVER fall back to the production API, even if
// the base value is missing ("" ?? falls back to same origin).
// A normal production build has NO injection → the live backend URL,
// exactly as before — zero production behaviour change.

const runtime =
  typeof window !== "undefined" ? window : undefined;

const isPreview = Boolean(runtime && runtime.__JB_PREVIEW__ === true);

const injectedApiBase =
  runtime && typeof runtime.__JB_API_BASE__ === "string"
    ? runtime.__JB_API_BASE__
    : null;

export const API_URL = isPreview
  ? injectedApiBase ?? ""
  : "https://justbrand-in-144629.hostingersite.com";
