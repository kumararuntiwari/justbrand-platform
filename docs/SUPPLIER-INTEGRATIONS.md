# JustBrand Supplier & Manufacturer Integrations

## Where it lives

- Admin → **Commerce → Supplier & Manufacturer**.
- Backend: `backend/supplier-orders.js` (order sync, webhooks, launch
  status) on top of the existing connector in `backend/seller-imports.js`.
- Credentials are encrypted with AES-256-GCM before they reach SQLite.
  API responses expose only `hasApiKey` / `hasApiSecret` /
  `hasWebhookSecret` and a masked key hint.

## Configuration fields

Each supplier is linked to exactly one seller / manufacturer account:

- provider name, API base URL
- authentication: `api_key`, `bearer`, `basic`, `crmkey`, or `none`
- API key / secret (write-only)
- product endpoint and optional list key
- optional stock endpoint and price endpoint (merged by SKU)
- order endpoint (POST) and optional status endpoint (GET)
- webhook verification secret
- sync frequency, automatic product sync, enabled, order sync enabled

A supplier is **Configured — untested** until **Test connection** succeeds.
Synced products are created as `Pending`; the existing product-approval gate
is still the only way they reach buyers. Saving credentials or changing the
base/product/stock/price endpoint resets the connection status to `Untested`.

## Product / stock / price sync

The connector expects JSON. Default field mapping:

```json
{
  "sku": "sku",
  "name": "name",
  "category": "category",
  "price": "price",
  "comparePrice": "comparePrice",
  "stock": "stock",
  "description": "description",
  "images": "images",
  "hsnCode": "hsnCode"
}
```

The product feed may be an array or wrapped in `products`, `items`, `data`,
or a configured list key. Stock and price feeds are optional; when present
they are merged into the product feed by SKU. Duplicate SKUs are prevented
per seller. Supplier cost and JustBrand markup remain stored separately, so
a re-sync never compounds markup.

## Buyer order → supplier order

`order_items` insertion enqueues one job per `(order, supplier)` through the
`trg_supplier_order_job` trigger. This is atomic with the buyer order and
works for multi-seller orders (one supplier order per seller).

The worker runs every minute and processes due `pending` / `failed` jobs.
It sends:

```json
{
  "orderNumber": "JB...",
  "placedAt": "...",
  "seller": { "code": "...", "name": "...", "shopName": "..." },
  "customer": {
    "name": "...", "phone": "...", "email": "...", "address": "...",
    "city": "...", "state": "...", "pincode": "..."
  },
  "items": [{ "sku": "...", "name": "...", "quantity": 1, "price": 120 }],
  "payment": { "method": "COD", "status": "Pending" },
  "totalAmount": 450,
  "notes": "JustBrand marketplace order"
}
```

Headers include the configured auth plus:

- `Idempotency-Key: jb-<orderNumber>-<integrationId>`

A response is considered successful only when it contains an order id,
status, or tracking reference. The job is then marked `synced`; otherwise it
is `failed` with a visible error. Failed jobs retry up to five times with
backoff and can be retried from the Admin screen. `GET` on the status
endpoint supports `{externalOrderId}` and `{orderNumber}` placeholders.

## Webhook

URL: `POST /api/supplier-webhook/<integrationId>`

Accepted authentication (the webhook secret must be configured first):

- `x-jb-signature: sha256=<HMAC-SHA256(rawBody, webhookSecret)>`
- or `x-webhook-secret: <webhookSecret>`

Payload fields (aliases accepted):

```json
{
  "eventId": "unique-event-id",
  "orderNumber": "JB...",
  "externalOrderId": "SUP-ORDER-1",
  "status": "SHIPPED",
  "trackingNumber": "AWB...",
  "trackingUrl": "https://..."
}
```

Events are idempotent per integration/event key. An unknown order is stored
as `order_not_found` and acknowledged, so a supplier retry storm cannot
create duplicate state.

## Environment

- `JB_CREDENTIAL_KEY` — recommended long random server-side secret used to
  encrypt supplier credentials. If absent, `JWT_SECRET` is used for
  backward compatibility. Rotating it makes old stored credentials
  unreadable; re-enter them in Admin.
- `JB_ALLOW_PRIVATE_SUPPLIER_HOSTS` — test/CI only. Never set in production.
- No supplier API key belongs in `.env`, Git, the Admin UI response, logs,
  or chat.

## Verification

```sh
node tests/jb-supplier-orders.test.mjs
node tests/jb-imports-sync.test.mjs
```

Both suites use a throwaway SQLite database and a local fake supplier. They
never contact a real supplier.
