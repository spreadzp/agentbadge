# Payments API: legacy → /api/v1 migration guide

EPIC-221 (D-221-5). The legacy Stripe-only checkout surface is
soft-deprecated. All legacy endpoints still work — they now return
`Deprecation: true` and `Sunset` headers and a `Link` header pointing at the
successor surface. Migrate when convenient; nothing breaks in-flight.

## Endpoint map

| Legacy (deprecated)                          | Successor (v1)                                   |
| -------------------------------------------- | ------------------------------------------------ |
| `GET  /api/payment/products`                 | `GET  /api/v1/catalog/products`                  |
| `POST /api/payment/checkout`                 | `POST /api/v1/payments` + `POST /:id/attempts`   |
| `GET  /payment/success`, `/payment/canceled` | `GET  /checkout/success`, `/checkout/cancel`     |
| `POST /api/stripe/webhook`                   | **unchanged** — serves both flows                |

## Payload changes

### Create payment

Legacy:

```json
POST /api/payment/checkout
{ "productId": "passport-bronze", "email": "a@b.c",
  "metadata": { "accountId": "0.0.1" } }
```

v1 (two calls — create the payment, then attach a rail):

```json
POST /api/v1/payments
{ "productCode": "PASSPORT_BRONZE",
  "metadata": { "accountId": "0.0.1", "name": "agent", "capabilities": ["scan"] } }
→ { "payment": { "id": "pay_…", "status": "PENDING" } }

POST /api/v1/payments/pay_…/attempts
{ "provider": "STRIPE" }            // or { "provider": "DIRECT_USDC", "network": "eip155:1874" }
→ { "redirectUrl": "https://checkout.stripe.com/…" }          // STRIPE
→ { "paymentInstructions": { "recipient", "amount", "reference", "expiresAt" } } // USDC
```

### Field mapping

- `productId` (kebab, e.g. `passport-bronze`) → `productCode` (canonical, e.g. `PASSPORT_BRONZE`).
  `GET /api/v1/catalog/products` returns both; `productCodeForLegacyId()` maps them server-side.
- `metadata` — legacy accepted flat `Record<string,string>`; v1 validates the
  object against the product's catalog schema (`string` / `string[]` fields;
  missing required fields → `400` before any payment row is created).
- `email` → no top-level field in v1; Stripe collects the email inside the
  hosted checkout session. Receipts/customer correlation is via `customerId`.

### Status + receipt

- `GET /api/v1/payments/:id` — payment status + attempts.
- `GET /api/v1/payments/:id/receipt` — receipt once CONFIRMED.

### Rails

- `provider: "STRIPE"` → `redirectUrl` (hosted Stripe Checkout).
- `provider: "DIRECT_USDC"` + `network` (CAIP-2, e.g. `eip155:1874` Arc,
  `eip155:84532` Base, `solana:…` Solana) → `paymentInstructions` with the
  server-configured recipient/token contract, `amount`, `reference`
  (payment id — must travel in the transfer memo), `expiresAt`.
  Client-supplied `recipient`/`tokenContract` are rejected.

## Sunset

`Sunset: Thu, 31 Dec 2026 00:00:00 GMT` — shared with the marketplace
deprecation constant (`LEGACY_SUNSET`). Removal happens in a separate
cleanup epic, after the sunset date.
