---
related_capabilities:
  - ai-agent-architecture
  - backend-development
related_services:
  - ai-agent-consulting
---
# Honest Refusal Contract: Refused Requests Are Never Billed

## Summary

AgentBadge publishes a machine-readable refusal contract at `GET /api/meta/refusal-contract` (zod `version:"1.0"`). Every refusal body carries `charged:false`. The x402 settle seam is two-phase — `verify()` then `commit()` or `refuse(code)` — so declined requests never settle. Self-settled payments that already landed on-chain (Arc `eip3009-client-broadcast`) get an auto-refund: a `refund_log` record plus a `refund:{status, tx}` block in the refusal body.

## Refusal Matrix

| Code | HTTP | Charge | Refund |
|------|------|--------|--------|
| `policy_refusal` | 409 | never | — |
| `insufficient_subject` | 422 | never | — |
| `execution_failed` | 502 | never | auto |
| `data_unavailable` | 503 | never | — |

`data_unavailable` (503) means upstream data is down — refused, never billed, never answered with stale data presented as fresh.

## Degraded & Honest-Zero

- Degraded paid-surface responses carry top-level `degraded:true`, `data_status:"fresh"|"stale"|"unavailable"`, `stale_since` (ISO-8601).
- Empty collections return `[]` + `note:"no_data"` — never synthetic placeholder rows (CI lint enforces this).
- Only free-tier responses may carry degraded markers; paid requests on unavailable data are refused.

## Disclosure

Unilateral decisions (evaluator reject, client cancel on venue jobs) carry `disclosure:{decided_by, appeal, basis}` — who decided, on what basis, where to appeal.

## Endpoints

| Need | Endpoint |
|------|----------|
| Machine-readable refusal contract | `GET /api/meta/refusal-contract` |
| Error catalog with recovery actions | `GET /api/meta/errors` |
| Service catalog (canonical prices) | `GET /api/v1/services` |
| LLM entry point (refusal section) | `GET /llms.txt` |
| Verification policy (§9) | `GET /verification.md` |

## Verify It

`402 accepts[].amount` is canonical price truth — verify against `priceBaseUnits` in the service catalog. Clients can reconcile `charged:false` refusal bodies against their own ledger; any refusal that settled is a bug report.

## Links

- Blog article: https://agentbadge.xyz/blog/arc-c17-honest-refusal
- Refusal contract: https://agentbadge.xyz/api/meta/refusal-contract
- llms.txt: https://agentbadge.xyz/llms.txt
