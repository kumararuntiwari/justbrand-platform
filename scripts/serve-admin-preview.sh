#!/bin/sh
# JustBrand Admin preview: serves the built panel AND proxies /api to
# an ISOLATED local test backend (never the production Hostinger API).
# Freebuff injects PORT; defaults to 8002 for local runs.
cd "$(dirname "$0")/.." || exit 1
PORT="${PORT:-8002}"
export PORT
exec node scripts/serve-admin-preview.mjs
