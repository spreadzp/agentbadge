---
related_capabilities:
  - ai-agent-architecture
  - backend-development
related_services:
  - ai-agent-consulting
---
# Buyer-Side Caps: A Paying Client That Cannot Overspend

## Summary

`@agentbadge/circle-payments` ships an x402 buyer client that refuses to exist without limits: `createPayingClient({caps, signer})` throws `TypeError` when `PaymentCaps` is omitted — `{maxPaymentUsd, sessionBudgetUsd, allowedNetworks?}`. Every 402 is validated before signing (`validateAccepts`), spend is recorded at sign/broadcast, and the `agentbadge pay` CLI enforces the same caps with `--print-only` as an unsigned pre-flight check.

## Contract Enforced Before Signing

- `x402Version === 2`; `scheme ∈ {exact, eip3009-client-broadcast, gateway-batch}`; `network` ∈ caps.allowedNetworks; `asset` === USDC(chain); `amount <= maxPaymentUsd` (atomic, decimals=6).
- `extra.decimals !== 6` → refuse — never infer token decimals (mis-scale footgun).
- Refusals return `{ok:false, reason, field, value}` — named field + rejected value.
- Cap breach → `CapExceededError {cap, requested}`; budget breach → `BudgetExhaustedError {spent, budget, requested}`; retried-402 → `PaymentNotAcceptedError` (never pay twice for one request).

## Runtime Pieces

- `SpendTracker` — session cumulative; `spent += amount` on sign/broadcast, not on 402; `onSpend(entry)` persist hook.
- `paginateAll(pageFn, {cursorField, itemsField, maxPages})` — every page is a payment counted against the budget.
- Gateway auto-deposit: `gateway.autoDepositUsd` tops the gateway balance before the request (ensureFunded pattern).
- Payer-binding: `extra.payerBinding` → retry carries `X-Wallet`, `X-Sig`, `X-Timestamp` (EIP-191, `agentbadge-pay:v1`).

## CLI

`agentbadge pay <url> --max-payment 0.25 --budget 5 [--method POST] [--print-only]`
Exit codes: `0` ok · `2` refusal/cap · `3` network. Caps via flags or env (`AGENTBADGE_MAX_PAYMENT`, `AGENTBADGE_BUDGET`); private key only via env. `--print-only` prints `{amount, network, payTo}` and exits unsigned.

## Endpoints

| Need | Endpoint |
|------|----------|
| Service catalog (SKU + input_schema + price_usd) | `GET /api/v1/services` |
| Committed OpenAPI artifact (X402 components) | `GET /openapi.yaml` |
| LLM entry point | `GET /llms.txt` |
| Refusal contract | `GET /api/meta/refusal-contract` |

## Verify It

`validateAccepts` expectations match the committed `openapi.yaml` components: `x402Version: 2`, `extra.decimals: 6`, `charged: false`. CI runs `bun run check:openapi` — spec drift fails the gate. Reader repro: `agentbadge pay <url> --max-payment 0.25 --budget 5 --print-only`.

## Links

- Blog article: https://agentbadge.xyz/blog/arc-c18-sdk-caps
- SDK: https://www.npmjs.com/package/@agentbadge/circle-payments
- Service catalog: https://agentbadge.xyz/api/v1/services
