# GitBook Diagrams

D2 sources for diagrams embedded in the AgentBadge GitBook docs.
Style matches `hackathon/demo/docs/diagrams/` (sketch mode, layered colors).

## Rebuild

```bash
for f in *.d2; do d2 "$f" "${f%.d2}.svg"; done
```

d2 CLI: `/home/dev/.local/bin/d2` (or `npx d2`).

## Map

| Source | Embedded in |
| --- | --- |
| 01-system-overview-v2 | getting-started/architecture |
| 02-x402-self-settle-flow | products/payments |
| 03-venue-marketplace-lifecycle | products/venue-marketplace |
| 04-eaas-verdict-flow | products/evaluator-as-a-service |
| 05-agent-wallet-envelope | products/agent-wallet |
| 06-payer-binding-flow | products/payments |
| 07-identity-multichain | products/agent-passport-identity |
| 08-data-persistence | getting-started/architecture |

## Upload flow

SVGs are uploaded as GitBook space files via `insert_files` in a change request
(`ref` → `![Alt](./ref.svg)` inside the same batch). Do not commit generated SVGs.
