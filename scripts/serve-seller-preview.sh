#!/bin/sh
# Seller panel PREVIEW (isolated): serves apps/seller-app/dist with
# window.__JB_PREVIEW__ + __JB_API_BASE__ injection and proxies /api/*
# to an ISOLATED local backend — never the production Hostinger API.
# Freebuff injects PORT; defaults to 8001 for local runs.
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-8001}"
export PORT
export JB_PANEL_DIR="apps/seller-app/dist"
export JB_PANEL_NAME="seller"
export JB_PREVIEW_DATA_DIR="${JB_PREVIEW_DATA_DIR:-/tmp/justbrand-seller-preview-db}"
export JB_PREVIEW_BACKEND_RANGE="45000-45499"
exec node scripts/serve-buyer-preview.mjs
