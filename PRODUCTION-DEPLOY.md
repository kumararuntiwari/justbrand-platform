# JustBrand — Hostinger Production Deployment Steps

> Prepared for the customer-facing production release of all four panels.
> **Read fully before executing. No step here overwrites the production
> database or environment variables.**

## 0. Current production state (read-only smoke, 2026-11-12)

Production backend: `https://justbrand-in-144629.hostingersite.com`

| Endpoint | Status | Meaning |
|---|---|---|
| `GET /api/health` | 200 | Server + DB alive |
| `GET /api/products` | 200 | Product feed OK |
| `GET /api/categories` | 200 | Categories route is deployed |
| `GET /api/admin/courier/api-status` (anon) | 401 | Auth gate; route exists on the current backend |
| `GET /api/admin/supplier-integrations` (anon) | **404** | **Supplier integration backend not deployed yet** |
| `GET /api/admin/launch-status` (anon) | **404** | **Launch Control backend not deployed yet** |
| `POST /api/courier/serviceability` | **404** | **Courier serviceability backend not deployed yet** |

Conclusion: **production is running an older backend. The new courier,
supplier and launch-control modules in this package are not live yet.**
Steps 2–3 below deploy the package; no production database or `.env` is
overwritten.

## 1. Build the package (local machine, repo root)

```sh
sh ./scripts/package-production.sh
```

Output: `downloads/justbrand-production-YYYY-MM-DD.zip`

Package contents:
- `backend/` — the complete server source, including `server.js`,
  `auth.js`, `business.js`, `chat.js`, `db.js`, `delivery.js`,
  `courier.js` + `courier-adapters/`, `seller-imports.js`,
  `supplier-orders.js`, `marketplaces.js`, `mlm-3x3.js`,
  `payment-admin.js`, `seller-tax.js`, `gst.js`, `package.json` and
  `package-lock.json`
- `apps/{buyer-app,seller-app,admin-panel,delivery-panel}/dist/` — built frontends
- `PRODUCTION-DEPLOY.md` — this file

Explicitly **excluded** (script enforces this): `*.db`, `*.db-shm`,
`*.db-wal`, `.env*`, `node_modules/`, `downloads/`.

## 2. Deploy the backend (Node app on Hostinger)

1. **Back up first**: copy the current backend folder to a permanent
   location outside the versioned build folder and rename it
   `backend-backup-YYYY-MM-DD`. Copy `justbrand.db`, `justbrand.db-wal`
   and `justbrand.db-shm` consistently (stop writes or use SQLite
   `.backup`), then verify `PRAGMA integrity_check` and SHA-256. Do **not**
   delete anything yet.
2. Upload the package's complete `backend/` source over the existing
   backend folder, **without removing the live database or `.env`**.
3. **NEVER upload/overwrite/delete:**
   - `justbrand.db` (and `-shm`/`-wal`) — the live production database
   - `.env` — production environment variables (`JWT_SECRET`, `CORS_ORIGINS`, ports)
4. In the Node app's terminal on Hostinger:
   ```sh
   npm install --omit=dev
   ```
   (`bcryptjs`, `better-sqlite3`, `cors`, `dotenv`, `express`, `jsonwebtoken` —
   same versions as `backend/package-lock.json`.)
5. Restart the Node application from the Hostinger hPanel.
6. Schema safety: every table/index uses `CREATE TABLE IF NOT EXISTS` /
   `CREATE INDEX IF NOT EXISTS` — startup **adds missing tables only** and
   never drops or resets existing data.

## 3. Deploy the four frontends (static drops)

Upload each `dist/` to its existing hosting location (the same layout used
in `deploy-staging/`):

| Panel | Package path | Upload to |
|---|---|---|
| Buyer | `apps/buyer-app/dist/` | Buyer site `public_html` (buyer domain/subfolder) |
| Seller | `apps/seller-app/dist/` | Seller site `public_html` |
| Admin | `apps/admin-panel/dist/` | Admin site `public_html` |
| Delivery | `apps/delivery-panel/dist/` | Delivery site `public_html` |

Keep a dated backup of each replaced folder (existing
`deploy-staging/*-backup-*` convention). Frontends call the production API
via the hardcoded `https://justbrand-in-144629.hostingersite.com` in source —
**no environment variable or URL changes are needed or allowed.**

## 4. Post-deploy verification (read-only smoke)

```sh
B=https://justbrand-in-144629.hostingersite.com
for p in /api/health /api/products /api/categories /api/site/content \
         /api/payment/config /api/family/gifts /api/mlm/level-commissions; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' $B$p)"
done
```

Expected after backend update: **all 200** (categories was 404 before).
Admin-only integration endpoints must return **401 without a token**:
`/api/admin/supplier-integrations`, `/api/admin/courier/api-status`,
`/api/admin/launch-status`.

Supplier credentials are configured in Admin → Commerce → Supplier &
Manufacturer. Courier live booking requires the server-side secrets listed
in `docs/COURIER-INTEGRATION.md`; without them the UI must show
Manual / Not Configured or Sandbox. Never put API keys in this file.

Anonymous security checks (must NOT be 200):

```sh
for p in /api/customers/me /api/admin/mlm/settings /api/chat/threads /api/mlm/me; do
  echo "$p -> $(curl -s -o /dev/null -w '%{http_code}' $B$p)"
done
```

Expected: **401** for auth-gated routes (404 only before the deploy).

Manual login checks per panel (buyer, seller, admin, delivery) — use real
accounts on production; do **not** register test users or create test
orders on the production database.

## 5. Hard rules

- No database reset / reinitialize / delete, ever.
- No `.env` edits, no production URL changes.
- No payment-gateway or live money transaction testing.
- Do not deploy until the user gives the final confirmation.
- Rollback = restore the dated backup folders from step 2/3; the database
  is never part of a rollback because it is never touched.
