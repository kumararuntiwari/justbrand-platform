# JustBrand — Mandatory GST Seller Production Readiness

Status: **implementation and preview verification complete; production deployment
blocked because no Hostinger database/deployment access is available in this
workspace.** No production database, Hostinger file, DNS record, environment
variable or deployment was changed. Last preview audit: **2026-11-09**.

Policy implemented: every seller must have **Admin-approved KYC, Verified PAN and
Admin-approved GSTIN** before a product can be listed or sold. GSTIN may be added
after registration, but unregistered/non-GST selling is disabled completely.

## 1. Implemented behaviour

| Area | Behaviour |
| --- | --- |
| Registration | PAN is mandatory in the Seller UI and production. GSTIN is optional at registration but required before selling. |
| PAN | Starts `Pending Verification`; only an Admin can mark it Verified/Rejected. Rejection requires a reason. |
| GSTIN | Starts `GST Unregistered` without a GSTIN. Submission becomes `GST Verification Pending`; only Admin approval makes it `GST Registered`. |
| KYC | Admin approval is mandatory. KYC changes reset an existing approval to Pending where material. |
| Selling eligibility | Requires KYC Approved + PAN Verified + GSTIN present + Admin GST approval. There is no legacy or unregistered bypass. |
| Product listing | Sellers cannot submit products until eligibility is complete. Existing approved products are filtered live and disappear if tax approval is missing/revoked — without deleting or rewriting rows. |
| Checkout | Quote and order creation both reject a product whose seller is not currently GST-approved. |
| Invoices | New sales use `TAX_INVOICE` with GSTIN and CGST/SGST or IGST. `NON_GST_INVOICE` is no longer offered for new sales. Existing invoice snapshots remain readable and immutable. |
| GST rejection | Admin must give a reason. Seller sees it in KYC, corrects/resubmits the GSTIN, and Admin can approve or reject again. |
| Unregistered approval | Disabled. The old `tax-status` endpoint returns `409 GST_REQUIRED` and changes no row; the Admin UI has no approval button. |
| Admin | PAN/GST filters, seller drawer, rejection reasons, approval timestamps and `seller_audit_log` remain available. |
| Old records | No seller/product/order/invoice rows are deleted or rewritten by the policy. Product visibility and checkout eligibility are evaluated from the current seller profile. |

## 2. Changed files

- `backend/seller-tax.js` — eligibility now requires GST; removed unregistered and legacy selling paths.
- `backend/business.js` — live sellability filter, product-submission gate, checkout gate, Admin unregistered-endpoint refusal.
- `backend/server.js` — buyer product feed, search, PDP and compare-price endpoints filter on live seller eligibility.
- `apps/seller-app/src/pages/SellerRegister.jsx` — removed enrolment/turnover inputs and unregistered copy.
- `apps/seller-app/src/pages/SellerKYC.jsx` — mandatory-GST copy, rejection reason and later-GST flow.
- `apps/seller-app/src/pages/AddProduct.jsx` — product submission disabled until KYC + PAN + GST approval.
- `apps/admin-panel/src/Business.jsx` — unregistered approval removed; disabled-state messaging.
- `tests/jb-seller-tax.test.mjs` — replaced obsolete unregistered suite with 71 mandatory-GST checks.
- `tests/support/mandatory-gst.js` — shared real-API GST onboarding for existing suites.
- `tests/jb-pan-gst-browser-e2e.verify.mjs` — four-panel 51-check mandatory-GST browser flow.
- Other backend and browser suites updated to onboard sellers through real KYC/PAN/GST approval.

## 3. Database changes

The policy itself adds **no destructive migration** and rewrites no existing
records. It uses the already-additive tables/columns:

- `seller_kyc` — PAN/GST statuses, GSTIN, approval/rejection fields.
- `seller_audit_log` — KYC/PAN/GST decisions and reasons.
- `order_invoices` — immutable per-seller invoice snapshots.
- Existing product tax columns remain unchanged.

Legacy product rows are hidden from the public feed/checkout when their seller
does not have current GST approval, but their stored status and data are not
updated. Existing orders/invoices are never changed.

## 4. Verification evidence (preview only)

### Backend suites

`node --test tests/*.test.mjs`: **15 files, 961 assertions, 0 failed.**

Highlights:

- `jb-seller-tax.test.mjs`: **71 passed**, covering blocked pre-GST listing,
  unregistered endpoint refusal, GST rejection reason/resubmission, TAX invoices,
  old-invoice immutability and KYC revocation.
- All other suites pass after onboarding their fixture sellers through real
  KYC/PAN/GST approval.

### Browser scripts

All seven existing verification scripts pass after the GST fixture update:

`jb-admin-browser`, `jb-admin-charges`, `jb-admin-courier-ui`,
`jb-admin-preview`, `jb-admin-unavailable`, `jb-buyer-checkout`,
`jb-courier-payment`.

### Four-panel mandatory-GST E2E

`tests/jb-pan-gst-browser-e2e.verify.mjs`: **51/51 checks passed** in the four
isolated preview panels.

Evidence from the successful run:

- seller id **36**, product id **43**
- order #1 `JB1794248637002626` → `INV-JB1794248637002626-1` → `TAX_INVOICE`
- order #2 `JB1794248637584937` → `INV-JB1794248637584937-1` → `TAX_INVOICE`
- delivery partner id **28**
- both invoices contain GSTIN `27AAPFU0939F1ZV` and positive GST
- order #1 invoice is byte-for-byte unchanged after order #2
- unregistered approval button absent; endpoint returns 409
- KYC rejection hides the product without deleting orders/invoices

### Builds

| Panel | Result |
| --- | --- |
| Buyer app | Pass — 48 modules |
| Seller app | Pass — 38 modules |
| Admin panel | Pass — 33 modules (>500 kB warning only) |
| Delivery panel | Pass — 17 modules |

## 5. Production safety gate — blocked

The live Hostinger production database was **not** contacted for read-only schema
inspection, backup, restore or deployment. This workspace has no Hostinger
SSH/SFTP/API credentials, and the historical FTP access could not reach the
backend directory or binary SQLite database.

Therefore the mandatory pre-deploy checks remain **not executed**:

1. live read-only schema compatibility check;
2. production backup plus SHA-256 checksum;
3. restore into a separate test database with `PRAGMA integrity_check`;
4. rollback drill on that restored copy.

The earlier restore drill used the isolated preview database only. It does not
substitute for a production backup. No production deployment should proceed
until all four checks pass.

### Required access

Add these in Freebuff **Settings → Environment** (do not paste secrets in chat):

```text
HOSTINGER_SSH_HOST
HOSTINGER_SSH_USER
HOSTINGER_SSH_PORT
HOSTINGER_SSH_KEY
```

or `HOSTINGER_SSH_PASSWORD` instead of the key. The SSH account must be able to
read/write the Node app directory and read the live `justbrand.db`.

## 6. Deploy sequence once access exists

1. Open production DB read-only; compare schema against the additive requirements.
2. Stop if any compatibility mismatch or data-loss risk appears.
3. Create a consistent production backup; record size and SHA-256.
4. Restore into a separate test DB; verify integrity and row counts.
5. Build/package backend + four frontends; deploy without touching `justbrand.db`
   or production `.env`.
6. Verify `NODE_ENV=production`, PAN mandatory, GST mandatory, Admin approval and
   unregistered selling disabled.
7. Run live health, seller registration, Admin KYC/PAN/GST approval, product
   submission/listing, old buyer checkout, invoice immutability and Delivery checks.
8. Publish the backup path/hash, changed files, DB changes, test results, live URLs
   and rollback instructions.

## 7. Remaining non-deployment gaps

- No live PAN/GSTIN provider verification; Admin review is manual.
- No statutory invoice PDF/e-invoice/credit-note generator.
- Buyer State is not checked against a canonical State master.
- Refund/return tax adjustment flow is not implemented.
- Production migration, backup, restore drill and live smoke tests remain pending
  until Hostinger access is supplied.
