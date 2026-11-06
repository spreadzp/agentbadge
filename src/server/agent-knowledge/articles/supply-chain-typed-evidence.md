---
related_capabilities:
  - agent-guide
  - economic-ledger
related_services:
  - ai-agent-consulting
---
# Brick #2: A Link Is Not a Fact — Typed Evidence in a Verifiable Supply Chain

## Summary

Typed evidence references (`{type, hash, issuer, uri?}`) travel inside the `handoff` event payload of the AgentBadge economic ledger and are replayed into per-hop read state as `ShipmentHop.evidence` with `evidenceAssertedBy` provenance and per-ref `issuerMatchesParty`. Each ref = one of seven types (`signature | gps | document | api_response | image | weight | temperature`) + a 0x-prefixed 32-byte hash + the claiming participant + optional URI. Brick #2 of the Bedrij supply-chain series — proves that evidence belongs to the transition.

## For Agents

- **Write path (strict):** `handoffHop(..., evidenceRefs)` → `EvidenceRefWriteSchema` via `buildEconomicEvent` (default `mode: "write"`) — closed 7-type enum, hash → lowercase `0x`+64hex, URI allowlist `http(s)/ipfs/ar`, credentials/control-chars rejected, canonicalized to `new URL(u).href`, list pre-checked 1–32 before per-item parse, bounded error echoes.
- **Read path (lenient):** `EvidenceRefSchema`/`EvidenceListSchema` inside `HandoffPayloadSchema` — open type (unknown future types ≤32 chars tolerated, render as "other"), uri ≤2048 chars unvalidated; stored events always replay.
- **Replay gates:** `shipmentState` `safeParse`s every stored payload and lifts claims only for the canonical `seqFor(hopIndex,"handoff")` event — a forged event with a valid payload but wrong seq never enters public state.
- **API:** `GET /api/ledger/shipments/:id` → `hops[].evidence[]` (with `issuerMatchesParty`) + `hops[].evidenceAssertedBy` (the actor that attached the refs).
- **Schema package:** `@agentbadge/econ-events@0.1.3` exports `EvidenceRefSchema`, `EvidenceRefWriteSchema`, `EvidenceListSchema`, `EVIDENCE_TYPES`, `EVIDENCE_MAX_PER_EVENT` (32), and `buildEconomicEvent(input, {mode: "write"|"replay"})`.
- **Guards:** advisories aggregate per write (`evidence third-party issuers` warning) and never block; `ShipmentOrderError` for cardinality/schema violations; hop cap 64 per shipment; `light: true` replay mode skips evidence parsing on the hot path.

## Trust Boundary

Evidence refs are **advisory pointers**, never verification. A hash proves specific bytes existed — not accuracy. An issuer is a self-declared claim at the same trust level as participant roles (Brick #1); `issuerMatchesParty: false` flags third-party issuers as an advisory, it does not block the write. The ledger never fetches `uri` — resolving it is a consumer trust decision. Issuer registries, countersigned evidence, oracle attestations and on-chain anchors are future layers.

## Verification Status

- Adversarial AI audit of the implementation: REQUEST CHANGES (0 Critical / 2 High / 7 Medium) → all findings fixed or documented-accepted → regression coverage per finding.
- 118 package tests + 35 supply-chain server tests green; findings archived in `docs/EPICS/213-supply-chain-evidence/reviews/evidence-REVIEW.md`.
- `@agentbadge/econ-events@0.1.3` published on npm; backward compatible — pre-213 handoffs without `evidence` replay unchanged, and `mode: "replay"` preserves stored-event parsing.
