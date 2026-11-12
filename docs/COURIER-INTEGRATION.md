# JustBrand Courier Integration

## Architecture

- `backend/courier-adapters/shiprocket.js` — real Shiprocket REST adapter
  (auth, serviceability/rates, adhoc order, AWB, label, manifest, pickup,
  tracking, cancellation, NDR/RTO).
- `backend/courier-adapters/india-post.js`, `ekart.js`, `dtdc.js`,
  `delhivery.js`, `xpressbees.js` — separate Manual / Not Configured
  adapters. They never fabricate a booking, AWB or tracking scan.
- `backend/courier.js` — additive shipment schema, admin/seller/buyer APIs,
  multi-seller shipment groups, webhook handling and tracking history.
- Existing order totals, GST, payment, Family commission and the local
  person-based Delivery Partner workflow are untouched.

## Live-mode safety

Shiprocket is called **only** when both conditions are true:

1. Required server-side secrets exist.
2. `COURIER_LIVE_ENABLED=1`.

Otherwise the adapter is sandbox/dry-run. In sandbox:

- a shipment is stored with a clearly labelled `TEST-` AWB;
- no external courier is contacted;
- label/manifest/pickup/tracking actions do not invent live data;
- the admin can record the courier's real AWB/status manually.

`COURIER_LIVE_ENABLED` must stay unset/`0` in preview. Set it to `1` only
for a deliberate production go-live after all launch checks pass.

## Server-side secrets

Configure these through Freebuff Settings → Environment (never in Git,
SQLite, logs, the admin UI or chat):

### Shiprocket

- `SHIPROCKET_EMAIL` — Shiprocket API user email
- `SHIPROCKET_PASSWORD` — Shiprocket API user password
- `SHIPROCKET_TOKEN` — optional pre-issued token (otherwise login is used)
- `SHIPROCKET_PICKUP_LOCATION` — optional default pickup nickname
- `SHIPROCKET_PICKUP_PINCODE` — optional default pickup PIN
- `SHIPROCKET_WEBHOOK_TOKEN` — required for the signed webhook
- `COURIER_LIVE_ENABLED=1` — only when real bookings are intended

### Other partners (not live until onboarding is complete)

- India Post: `INDIA_POST_CUSTOMER_ID`, `INDIA_POST_API_USERNAME`,
  `INDIA_POST_API_PASSWORD`, `INDIA_POST_CONTRACT_ID`
- Ekart: `EKART_CLIENT_ID`, `EKART_CLIENT_SECRET`, `EKART_MERCHANT_CODE`
- DTDC: `DTDC_API_KEY`, `DTDC_CUSTOMER_CODE`
- Delhivery: `DELHIVERY_API_TOKEN`, `DELHIVERY_CLIENT_NAME`
- Xpressbees: `XPRESSBEES_API_KEY`, `XPRESSBEES_CUSTOMER_CODE`

These names are also shown in the admin API-status screen. The old
`apiCredentials` database column is no longer accepted; `initCourier()`
clears any legacy value.

## Shiprocket setup

1. Activate the Shiprocket account and complete its KYC.
2. Create an API user under Shiprocket Settings → API.
3. Create a pickup location and note its exact nickname.
4. Add the API user's email/password as server-side secrets.
5. Add a webhook URL in Shiprocket Settings → API → Webhooks:
   `https://<backend-host>/api/courier/webhook/shiprocket`
6. Set the same security token as `SHIPROCKET_WEBHOOK_TOKEN` (sent as
   `x-api-key`).
7. Test connection in Admin → Courier Partners. A sandbox result is not a
   live success.
8. Only after a controlled launch, set `COURIER_LIVE_ENABLED=1`.

## India Post contractual onboarding

India Post API access is not self-serve. JustBrand needs, from the local
India Post booking office / DoP CEPT process:

- a registered business customer ID;
- a separate agreement/contract for each service (Speed Post, Business
  Parcel, COD where applicable);
- DoP/CEPT-issued API username and password for that customer ID;
- contract ID(s) and an allotted article/barcode ID range;
- an approved dispatch/pickup address/PIN and pickup schedule;
- server/IP approval and UAT sign-off;
- COD remittance and reconciliation terms.

Until these exist, India Post remains **Manual / Not Configured**. The admin
records the real AWB/label/pickup reference from India Post's own system.

## Ekart onboarding

Ekart remains Manual / Not Configured until an enterprise/merchant
agreement exists, API client ID/secret + merchant code are issued, the
pickup location is approved, and the rate/COD/reverse terms are agreed.

## API surface

- `POST /api/courier/serviceability` — public PIN/rate/ETA check.
- `GET /api/admin/orders/:id/shipment-groups` — seller-wise groups.
- `POST /api/admin/orders/:id/shipments/quote` — rate comparison.
- `POST /api/admin/orders/:id/shipments` — book one seller group.
- `POST /api/admin/courier/shipments/:id/action` — label, manifest,
  pickup, tracking, cancel, NDR, RTO.
- `POST /api/courier/webhook/shiprocket` — signed webhook with idempotency.
- Seller: `/api/sellers/courier/pickup`,
  `/api/sellers/orders/:id/shipment-groups`,
  `/api/sellers/orders/:id/shipments/quote`,
  `/api/sellers/orders/:id/shipments`,
  `/api/sellers/courier/shipments/:id/action`.

## Tests

```sh
node tests/jb-courier-network.verify.mjs
node tests/jb-courier-payment.verify.mjs
```

`jb-courier-network.verify.mjs` starts a local fake Shiprocket server and
uses a throwaway SQLite DB. It never contacts a real courier.
