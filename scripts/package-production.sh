#!/bin/sh
# =====================================================
# JustBrand — production packaging for Hostinger.
# Builds the four panels and zips backend source + dist
# folders. NEVER includes: *.db, *.db-shm, *.db-wal,
# .env*, node_modules, downloads.
# Usage (repo root):  sh ./scripts/package-production.sh
# =====================================================
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
STAMP="$(date +%Y-%m-%d)"
STAGE="$ROOT/downloads/justbrand-production-$STAMP"
ZIP="$ROOT/downloads/justbrand-production-$STAMP.zip"

echo "[1/4] Building four panels..."
for app in buyer-app seller-app admin-panel delivery-panel; do
  echo "  - $app"
  npm run build --prefix "$ROOT/apps/$app" >/dev/null
done

echo "[2/4] Staging package (backend source + dist folders)..."
rm -rf "$STAGE"
mkdir -p "$STAGE/apps"
tar -C "$ROOT" -cf - \
  --exclude='backend/node_modules' \
  --exclude='backend/.env' \
  --exclude='backend/justbrand.db' \
  --exclude='backend/justbrand.db-shm' \
  --exclude='backend/justbrand.db-wal' \
  backend | tar -C "$STAGE" -xf -
for app in buyer-app seller-app admin-panel delivery-panel; do
  mkdir -p "$STAGE/apps/$app"
  cp -R "$ROOT/apps/$app/dist" "$STAGE/apps/$app/dist"
done
cp "$ROOT/PRODUCTION-DEPLOY.md" "$STAGE/PRODUCTION-DEPLOY.md"

echo "[3/4] Creating zip..."
mkdir -p "$ROOT/downloads"
rm -f "$ZIP"
(cd "$ROOT/downloads" && zip -qr "$ZIP" "justbrand-production-$STAMP")

echo "[4/4] Verifying exclusions..."
if unzip -l "$ZIP" | grep -E '\.db|\.env|node_modules' >/dev/null; then
  echo "ERROR: package contains db/env/node_modules files — aborting."
  rm -f "$ZIP"
  exit 1
fi
rm -rf "$STAGE"

echo "Package ready: $ZIP"
unzip -l "$ZIP" | tail -3
