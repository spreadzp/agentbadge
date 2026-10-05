---
related_capabilities:
  - ai-agent-architecture
  - backend-development
related_services:
  - ai-agent-consulting
---
# Owner Controls for Agent Wallets: Approve, Deny, Suspend — Never Sign

## Summary

AgentBadge owner controls gate whether a payment broadcast is honored as paid — they never sign or broadcast on the agent's behalf. Four controls sit on top of the spending envelope: velocity caps, an approval threshold that parks payments for a human signature, a suspend/resume kill-switch evaluated before every other check, and a per-kind allowlist. Proven live on Arc testnet October 5, 2026 (velocity deny → hold → approve → settle → suspend → resume → kind deny, full audit trail).

## The Four Controls

- **Velocity** — `maxTxPerHour` / `maxAmountPerHour` rolling windows → `402 velocity_tx | velocity_amount` with `used`, `limit`, `resetAt`, `windowSec`
- **Approval hold** — spend above `approvalAboveUsd` parks the intent → `402 approval_required` (`approvalId`, `expiresAt`); signed `approve` mints a single-use permit matched on amount + kind + endpoint; retry settles
- **Kill-switch** — `POST suspend` runs before all other checks → every payment returns `spend_suspended`; `resume` restores
- **Allow-kinds** — `allowedKinds` allowlist; off-list kinds get `kind_not_allowed` with attempted kind + allowlist echoed

## Owner Control API

| Action | Endpoint |
|--------|----------|
| Set/replace envelope | `PATCH /api/wallets/:address/envelope` (full-object replace, not merge) |
| List pending approvals | `GET /api/wallets/:address/approvals?status=pending` |
| Approve / reject parked intent | `POST /api/wallets/:address/approvals/:id/approve` / `.../reject` |
| Suspend / resume | `POST /api/wallets/:address/suspend` / `.../resume` |
| Signed audit feed | `GET /api/wallets/:address/audit` |

Control calls use EIP-191 signed headers: `x-wallet`, `x-sig`, `x-timestamp` over a pathname-only challenge (`wallet|method|path|timestamp`).

## Deny Codes

`velocity_amount`, `velocity_tx`, `approval_required`, `approval_queue_full`, `spend_suspended`, `kind_not_allowed`, `spend_cap` — all 402s carry a machine-readable `denied` field the agent can act on.

## Key Facts (dogfood-verified 2026-10-05)

- **Custody boundary:** control plane admits/denies settlement; agent wallet keeps the key — worst-case breach is denial of service, not spend
- **Permit is single-shot:** approve → one settlement of that exact payment, then consumed
- **Queue bounded:** overflow → `approval_queue_full`; approvals expire on their own (`expiresAt` ~1h)
- **PATCH replaces:** sending a partial envelope silently drops `approvalAboveUsd` — always send the full object
- **Case-insensitive wallets:** parked approvals are stored lowercase; lookups must `COLLATE NOCASE` (fixed during this dogfood)
- **Audit complete:** `spend.velocity_denied`, `approval.requested`/`decided`/`consumed`, `wallet.suspended`/`suspended_deny`/`resumed`, `spend.kind_denied`
- **Repro:** `scripts/agent-wallet-controls-dogfood.mts` — self-registers, walks all four controls, verifies audit

## Links

- Blog article: https://agentbadge.xyz/blog/arc-c13-owner-controls
- Wallets console: https://agentbadge.xyz/wallets
- Arc testnet explorer: https://testnet.arcscan.app
