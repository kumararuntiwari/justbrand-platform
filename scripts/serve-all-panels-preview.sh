#!/bin/sh
# Serves ALL FOUR panels in parallel, each ISOLATED from production:
#   PORT+0 → Buyer App (serve-buyer-preview.sh: injection + /api proxy)
#            — Freebuff primary preview port (customer-facing URL)
#   PORT+1 → Delivery Panel
#   PORT+2 → Seller Panel (serve-seller-preview.sh: injection + /api proxy)
#   PORT+3 → Admin Panel (via serve-admin-preview.sh: same-origin /api
#            proxied to an isolated local backend — fixes the
#            Charges & Tax "Request failed (404)" against stale prod)
# NOTE: tests/jb-admin-*.verify.mjs hardcode the proxy URL on PORT+3
# (Admin), and buyer verification uses PORT — keep this mapping.
# Delivery/Buyer/Seller must NOT be bare `vite preview` — a bare preview
# injects nothing, so the apps would fall back to the PRODUCTION API.
# Freebuff injects PORT; defaults to 8000 for local runs.
BASE="${PORT:-8000}"
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

# ---------------------------------------------------------------
# SHARED test backend (Buyer + Seller + Admin).
# The seller lifecycle (register -> admin sees/approves -> product
# approve -> Buyer storefront) can only be tested end-to-end when all
# three panels talk to ONE isolated SQLite DB and ONE backend process.
# Both serve-*.mjs honour these vars: JB_PREVIEW_BACKEND_PORT pins the
# port, so the first panel spawns the backend and the others REUSE it
# (same DATA_DIR => same DB). Still 100% isolated under /tmp — the
# production database is never involved.
# Delivery keeps its OWN isolated DB (vars are unset for it below).
# Rollback: delete these two lines to restore per-panel isolation.
# ---------------------------------------------------------------
export JB_PREVIEW_DATA_DIR="/tmp/justbrand-buyer-preview-db"
export JB_PREVIEW_BACKEND_PORT=36011

serve_panel() {
  script="$1"
  port="$2"
  (
    cd "$ROOT" || exit 1
    PORT="$port"
    export PORT
    exec sh "$ROOT/$script"
  ) &
}

# Admin must go through its dedicated preview server (static + /api
# proxy to the isolated local backend), not a bare vite preview —
# a bare preview would send API calls to production (404s).
serve_admin() {
  port="$1"
  (
    cd "$ROOT" || exit 1
    PORT="$port"
    export PORT
    exec sh "$ROOT/scripts/serve-admin-preview.sh"
  ) &
}

# Delivery uses the SAME isolated preview DB as Buyer/Seller/Admin so a
# partner approved by Admin can actually receive and see an assigned order
# in the Delivery panel. Production is never involved.
serve_delivery() {
  port="$1"
  (
    cd "$ROOT" || exit 1
    PORT="$port"
    export PORT
    exec sh "$ROOT/scripts/serve-delivery-preview.sh"
  ) &
}

serve_panel scripts/serve-buyer-preview.sh "$((BASE))"
serve_delivery "$((BASE + 1))"
serve_panel scripts/serve-seller-preview.sh "$((BASE + 2))"
serve_admin "$((BASE + 3))"

wait
