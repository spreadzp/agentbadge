---
related_capabilities:
  - on-chain-recording
  - keeperhub
related_services:
  - on-chain-scan-recording
---

# On-Chain Recording

On-Chain Recording is the process of writing scan results to a blockchain via the TrustRegistry smart contract on Base Sepolia.

## How It Works

1. Agent scans a site with `confirm: true`
2. Server triggers a KeeperHub `record-scan` workflow
3. KeeperHub executes the on-chain transaction calling `recordScan()` on TrustRegistry
4. The scan result (URL, score, rules passed/total, timestamp) is permanently recorded on Base Sepolia
5. If the site passes, a TrustBadge (soulbound NFT) and AgentPassport NFT are minted

## Contracts

- **TrustRegistry** (`0x2e0fb96976a461acfeb7fd4605d6a20311a5da91`) — Records scan results on Base Sepolia
- **TrustBadge** (`0x6e408672e56001dc24a5db68107f9abf900f87e3`) — Soulbound NFT for verified sites
- **AgentPassport** (`0x69043c847e9ee79b7128ec6d280f5f25fc76aba9`) — ERC-721 identity NFT on Base

## MCP Tools

- `record_scan` — Trigger on-chain scan recording
- `workflow_status` — Check KeeperHub workflow execution status
- `audit_events` — Read on-chain audit events

## Related Concepts

- [Trust Badge](/agent-guide/concepts/trust-badge) — Soulbound NFT for verified agents
- [Scoring Engine](/agent-guide/concepts/scoring) — How scan scores are calculated
