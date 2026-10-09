---
slug: arc-c11-verdict-transparency
title: "Verdict transparency: hash-chain + heartbeat head-anchor"
related_capabilities: [verify-verdict, chain-proof, chain-head]
related_services: [eaas]
---

# Verdict Transparency — AgentBadge verdict hash-chain

Every verdict extends a linear hash-chain (`entryHash = keccak256(prevHash ‖ artifactHash)`); the head anchors to the Arc Memo contract on a heartbeat (`ARC_CHAIN_FLUSH_MS`, epochSeq increments even in empty windows).

## Endpoints (free, rate-limited)

- `GET /api/eaas/chain` — head, count, `chainOk`, anchor meta.
- `GET /api/eaas/chain/entries?from&to&limit` — paged entries (cap 100).
- `GET /api/eaas/chain/proof/:verdictId` — `{seq, path, head}` inclusion suffix.
- `GET /api/eaas/verdicts/:id/verify` — `chain:{included,seq?,headHash}` field.

## Verify offline

Fetch proof → fold `computeEntryHash(prevHash, artifactHash)` over `path[]` → compare to `head.headHash` or the on-chain Memo event `memoId = keccak("chain:eaas-verdicts:<epochSeq>")`.

## Dogfood

`bun run scripts/eaas-chain-dogfood.mts` — 3 paid verdicts → force flush → real Memo event on Arc testnet.
