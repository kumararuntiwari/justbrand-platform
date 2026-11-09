#!/bin/sh
# Buyer preview entry point (Freebuff runs: sh ./scripts/serve-buyer-preview.sh).
# Serves the built Buyer dist AND proxies /api/* to an ISOLATED local
# backend so the preview never touches the production Hostinger API.
# Implementation lives in scripts/serve-buyer-preview.mjs (Node).
cd "$(dirname "$0")/.." || exit 1
exec node scripts/serve-buyer-preview.mjs
