# Agent Guide: Payment-Graph Forensics on Arc (arc-c32-payment-forensics)

## Summary

AgentBadge indexes every x402 settle on Arc mainnet as a directed edge `payer → seller` and exposes a public verdict endpoint: `GET /api/v1/risk/:address` returns `pass | caution | block | no_data` with `organicShare`, `effectivePayers`, `coveredPct`, `indexedToBlock`, `lagBlocks`, and `reasons[]`. Circular revenue is detected via Tarjan SCC loops, first-funder tracing, and shared-funder analysis. Thin files return `no_data` — never a fake score.

## What an agent can read

- `GET /api/v1/risk/0x<address>` — payment-graph verdict for any Arc address. No auth, 60 req/min/IP.
- `GET /blog/arc-c32-payment-forensics.json` — Knowledge Object v1 for this article.
- `GET /blog/arc-c32-payment-forensics.md` — the article as markdown.
- `GET /api/openapi.yaml` — full spec including the risk endpoint.

## Response shape

```json
{"verdict":"pass","organicShare":1,"grossVolume":"10274939098",
 "organicVolume":"10274939098","effectivePayers":2.79,"coveredPct":0,
 "reasons":["funding coverage 0% — verdict uses on-chain data only"],
 "indexedToBlock":"27434627","lagBlocks":"2"}
```

## Verdict semantics

- `pass` — organic share ≥ threshold, no loops or self-funding detected.
- `caution` — degraded organic share or shared-funder strikes.
- `block` — SCC loop or dominant seller-funded payers.
- `no_data` — thin file (<5 settles, <2 payers, or <$0.05 gross) or unknown address. NOT a favorable verdict — the address is unmeasured.

## How to integrate (buyer side)

```ts
import { createPayingClient, createRiskGuard } from "@agentbadge/circle-payments";
const client = createPayingClient({ beforePayment: createRiskGuard() });
```

CLI: `pay --risk-check <url>` (or `AGENTBADGE_RISK_ENDPOINT`). `block` → `PaymentRefusedError` before signing; `no_data` policy is configurable.

## Limits

- `coveredPct` discloses funding-trace coverage; 0% means verdicts rely on on-chain edge data only — read `reasons[]`.
- `indexedToBlock`/`lagBlocks` disclose index freshness; a lagging index returns stale-data verdicts, check the fields.
- `verdict` is an evidence-based outcome, not a score or a rating — do not treat `pass` as endorsement.
- Index snapshot as of block ~27.4M (2026-10-23): 301 real settles, 29 sellers, 37 payers, zero loops detected — a young-network baseline, not a permanent property.
- Public funding sources (custodians like Crossmint, faucets) are classified via a registry and count as organic.
