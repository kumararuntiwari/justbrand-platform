# JustBrand — Hostinger Production Deployment Steps

> Prepared for the customer-facing production release of all four panels.
> **Read fully before executing. No step here overwrites the production
> database or environment variables.**

## 0. Current production state (verified by smoke test)

Production backend: `https://justbrand-in-144629.hostingersite.com`

| Endpoint | Status | Meaning |
|---|---|---|
| `GET /api/health` | 200 | Server + DB alive |
| `GET /api/products` | 200 | Product feed OK |
| `GET /api/site/content` | 200 | Admin-controlled content OK |
| `GET /api/payment/config` | 200 | COD/UPI config OK |
| `GET /api/family/gifts` | 200 | JustBrand Family catalog OK |
| `GET /api/mlm/level-commissions` | 200 | Level config OK |
| `GET /api/categories` | **404** | **Backend on server is STALE (route exists in this repo)** |
| `GET /api/customer/orders` | **404** | **Stale backend** |
| `GET /api/sellers/orders` | **404** | **Stale backend** |
| `GET /api/mlm/me` | **404** | **Stale backend** |
| `GET /api/chat/threads` (anon) | **404** | **Stale backend (chat module not deployed)** |
| `PUT /api/admin/orders/1/payment` (anon) | 401 | Auth gate OK |
| `GET /api/customers/me` (anon) | 401 | Auth gate OK |

Conclusion: **frontends are production-ready; the Node backend on Hostinger
must be updated to this repo's `backend/` source.** That is exactly what
steps 2–3 below do — nothing else needs to change.

## 1. Build the package (local machine, repo root)

```sh
sh ./scripts/package-production.sh
```

Output: `downloads/justbrand-production-YYYY-MM-DD.zip`

Package contents:
- `backend/` — server source (`server.js`, `auth.js`, `business.js`,
  `chat.js`, `db.js`, `delivery.js`, `package.json`, `package-lock.json`)
- `apps/{buyer-app,seller-app,admin-panel,delivery-panel}/dist/` — built frontends
- `PRODUCTION-DEPLOY.md` — this file

Explicitly **excluded** (script enforces this): `*.db`, `*.db-shm`,
`*.db-wal`, `.env*`, `node_modules/`, `downloads/`.

## 2. Deploy the backend (Node app on Hostinger)

1. **Back up first**: download the current backend folder and rename it
   `backend-backup-YYYY-MM-DD` on the server (same convention already used
   in `deploy-staging/`). Do **not** delete anything yet.
2. Upload the package's `backend/` source over the existing backend folder,
   **overwriting only the source files listed above**.
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
