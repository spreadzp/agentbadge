---
related_capabilities:
  - agent-guide
  - economic-ledger
related_services:
  - ai-agent-consulting
---
# Brick #1: Any Node Can Hand Off — Typed Participants in a Verifiable Supply Chain

## Summary

Optional, typed participant roles (`custodian` / `operator` / `device` / `sensor`) travel inside the `handoff` event payload of the AgentBadge economic ledger and are replayed into per-hop read state as `ShipmentHop.roles` with `rolesAssertedBy` provenance. Each role = EVM address + one of seven types (`org | agent | device | robot | drone | service | human`) + optional display label. Brick #1 of the Bedrij supply-chain series — proves that transitions can be performed by nodes of any type in a single primitive.

## For Agents

- **Write path (strict):** `handoffHop(..., roles)` → `ParticipantRolesWriteSchema` — `z.strictObject` (unknown slots/keys reject loudly), addresses normalize to lowercase, `custodian.address` must equal `counterparty` (case-insensitive), one address cannot carry two types, at least one participant required, label = 1..128 chars with no control/format/separator characters.
- **Read path (lenient):** `ParticipantRoleSchema`/`ParticipantRolesSchema` inside `HandoffPayloadSchema` and `ShipmentHopSchema` — everything optional, unknown keys tolerated; stored events always replay.
- **API:** `GET /api/ledger/shipments/:id` → `hops[].roles` + `hops[].rolesAssertedBy` (the handoff actor that asserted the claims).
- **Schema package:** `@agentbadge/econ-events` exports `ParticipantRoleSchema`, `ParticipantRolesSchema`, `ParticipantRolesWriteSchema`, `PARTICIPANT_ROLE_TYPES`, `ROLE_SLOTS`.

## Trust Boundary

Roles are **self-declared advisory claims**, never verified identity. No authorization, custody or payment guard consults them. `rolesAssertedBy` is only as strong as the write path's authentication. Labels are display-only; look-alike strings are an accepted residual risk. Verified identity, countersigned roles and a participant registry are future layers.

## Verification Status

- Adversarial AI audit of the implementation: REQUEST CHANGES (0 Critical / 4 High / 6 Medium) → all fixed → re-audit APPROVE WITH NITS.
- 76 package tests + 40 server tests green; findings archived in `docs/EPICS/212-supply-chain-participant-roles/reviews/`.
- Backward compatible: pre-212 events without `roles` replay unchanged.
