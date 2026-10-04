---
related_capabilities:
  - ai-agent-architecture
  - backend-development
related_services:
  - ai-agent-consulting
---
# The Money Layer: Cross-Chain Agent Payments Settling on Arc

## Summary

AgentBadge's payment layer lets an AI agent pay for an API call with USDC held on any Circle Gateway-covered chain — the seller always receives USDC on Arc. One `402 Payment Required` response advertises three rails; the buyer signs one EIP-3009 authorization; the facilitator batches and settles. Verified live on October 4, 2026 (Base Sepolia and Arc Testnet deposits → paid 200 responses).

## The Three Payment Rails

Every gated endpoint returns one `402` with `accepts[]` covering:

- **`exact`** — vanilla x402, settled through a facilitator
- **`GatewayWalletBatched`** — Circle Gateway unified balance: deposit USDC on any covered chain, spend from it with a single signature
- **`eip3009-client-broadcast`** — self-settle for Arc-native buyers

Model: **multi-chain access, single-chain settlement** — payments accepted from anywhere, accounting and venue fees booked on Arc.

## How to Pay as an Agent

1. `GET` a gated resource → receive `402` + `PAYMENT-REQUIRED` header (base64 `accepts[]`)
2. Pick an `accept` whose network you hold USDC on; echo it back in `paymentPayload.accepted` plus `resource`
3. Sign an EIP-3009 `TransferWithAuthorization` (Gateway: 14-day `maxTimeoutSeconds` minimum)
4. Retry the request with `payment-signature` header → `200` + paid resource

Buyer status without auth: `GET /api/pay/gateway/transfers/:id` (terminal flag + refund note).
Deposit instructions: `GET /api/pay/gateway/deposit-info`.

## Key Facts (dogfood-verified 2026-10-04)

- **Deposit = `approve` + `deposit(token, value)`** on GatewayWallet — a raw ERC-20 `transfer()` moves tokens but never credits the unified balance
- **Credit latency:** Arc Testnet ~10–15 s; Base Sepolia ~31 min (L1 finality, ~65 ETH blocks)
- **"Unified" is per-domain:** a Base-domain balance cannot pay an Arc-domain accept — the facilitator checks balance per domain
- **Terminal states:** `authorized → settling → settled | expired | failed`; expired autorefunds on the source chain; `agentbadge_gateway_expiry_rate` Prometheus gauge tracks the rate
- **Fees layer:** provider fee + Gateway 0.005% + gas intents; `gatewayFeeHint` in accepts declares it
- **Evaluator-as-a-service:** `POST /api/eaas/verdicts` — EIP-712 `VerdictArtifact` (offline-verifiable); a reject verdict is also a paid artifact (fail-closed); `CLASS_EAAS` subscription tiers with auto-fallback to per-call x402
- **One boundary:** all rails share one facilitator client, router, spend ledger (`sourceChain` attribution), and failure store — `@agentbadge/circle-payments@0.1.16`

## Endpoints

| Need | Endpoint |
|------|----------|
| Paid API access | `402 accepts[]` on any gated route |
| Transfer status | `GET https://agentbadge.xyz/api/pay/gateway/transfers/:id` |
| Deposit info | `GET https://agentbadge.xyz/api/pay/gateway/deposit-info` |
| Venue stats | `GET https://agentbadge.xyz/api/venue/stats` |

## Links

- Blog article: https://agentbadge.xyz/blog/arc-c3-money-layer
- Agent Venue: https://agentbadge.xyz/market
