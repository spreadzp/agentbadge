# SLICE-220-10 — Stripe test-mode dogfood findings

## Live run results

| Run | reference | Outcome | Evidence |
|-----|-----------|---------|----------|
| dogfood-1794249231130 | `…-cf6944e8` | paid → **DISPUTED** (network_match) | `stripe-dogfood-1794249231130.json`, `evidence-stripe-checkout.png`, `evidence-stripe-success.png` |
| dogfood-1794249430271 | `…-dce13195` | paid → **CONFIRMED → REFUNDED** | `stripe-dogfood-1794249430271.json`, `evidence-stripe-checkout-2.png`, `evidence-stripe-success-2.png`, `evidence-stripe-receipt-refund.png`, `stripe-api-dump.json` |

Rail ids (test mode, safe to publish):

- Session: `cs_test_a1lCXjgOrZJBwhDSZJcxrKmG8hdln7n9zge9kVeeutWtYJPo12Kn1cJHcD`
- PaymentIntent: `pi_3UZxSNK84Am2sMrt1u6C60WB` — stored on receipt as `transactionHash`
- Charge: `ch_3UZxSNK84Am2sMrt1p5QgMoy`
- Refund: `re_3UZxSNK84Am2sMrt1hWQWfFI` (succeeded, 100¢ = $1.00)
- DISPUTED run refund: `re_3UZxPfK84Am2sMrt0jtXjH5B` via `pi_3UZxPfK84Am2sMrt0ToqjL8K` (manual API refund of the first $1)

## Proven on the live rail

- **Dedupe**: second `createPayment` with same reference + fingerprint → `deduped:true`, same payment id, no second Checkout Session.
- **Fingerprint conflict**: same reference, different amount → `conflict` message, `deduped:false`, no new row.
- **Exactly-once confirm**: `edge-reconfirm` → `deduped:true`, receipts stayed `1`.
- **Claim-first refund**: `edge-rerefund` → `REFUNDED` short-circuit AND `railRefundCount:1` — no second rail charge.
- **Receipt fields**: `externalReference` = session id, `transactionHash` = PaymentIntent id.

## Finding 220-10-F1 — fiat rail + `network` expectation → DISPUTED on captured funds

First run passed `network: "stripe-testmode"` at create. Verification check 8
(`network_match`) compares `attempt.network` with `evidence.network`; Stripe
Checkout evidence never carries a network tag → check fails while
`payment_status: "paid"` → payment DISPUTED with real captured funds.

- **Severity**: Medium — caller error, but the API makes it easy to trip on fiat
  rails and lands funds in DISPUTED instead of failing fast.
- **Contract fix**: do NOT pass `network` for fiat rails (script updated;
  `network` is for `eip155:*`-style onchain tags).
- **Worth discussing at re-audit**: should `createPayment` reject a `network`
  value on providers whose evidence never reports one (STRIPE), or should
  `evidenceFromCheckoutSession` surface a rail tag like `"stripe"`? Also:
  a payment already DISPUTED-by-verification with captured funds cannot be
  refunded through `refundPayment` (claim is CONFIRMED→DISPUTED), so recovery
  requires a rail-side refund — we did `re_3UZxPf…` manually via API.

## Post-audit re-verification run (2026-11-09, fixed code)

Re-run after the 220-reaudit hardening (provider capability guard,
persisted expectations, claim-first refund hardening). All green:

| Step | Result |
|------|--------|
| create | `pay_0b005225-60f9-4a58-a20d-ab6a226c0ae6` PROCESSING, session `cs_test_a1VtHe8FxYMU9K9iKbSytIq1AVreFvxtTmrovIo2RT7ReQixX0n6JIMQGP` |
| edge-dedupe | `deduped:true`, same payment id |
| edge-fiat-network-guard | **`guardRejected:true`** — `network` on STRIPE now throws at create, the 220-10-F1 bug is unreachable |
| edge-fingerprint-conflict | `deduped:false`, conflict error, no new row |
| confirm | **CONFIRMED** — receipt `externalRef` = session, `txHash` = `pi_3UZzR1K84Am2sMrt1Y6iuI1j` |
| edge-reconfirm | `deduped:true`, receipts stayed `1` |
| refund | **REFUNDED** — `re_3UZzR1K84Am2sMrt1uxL6SzD` |
| edge-rerefund | sequential `REFUNDED` + concurrent `["REFUNDED","REFUNDED"]`, **`railRefundCount:1`** — exactly-once proven on the live rail |
| final | `REFUNDED` |

- Transcript: `stripe-dogfood-1794257054489.json`
- Screenshot (success page, `dogfood@agentbadge.xyz` prefilled via
  `customer_email`): `evidence-stripe-success-postfix.png`
- `220-10-F1` resolution: the capability guard now rejects `network` at
  create before any row exists; the DISPUTED-refund exit also exists
  (DISPUTED + rail-verified SUCCESS evidence → refundable).
