# EPIC-72: MCP Namespacing

## Goal

Reorganize MCP tools into logical namespaces for better discoverability and maintainability.

## Namespaces

- **passport** — Passport issuance, verification, tier upgrades
- **market** — Marketplace tasks, claiming, delivery, payment
- **discovery** — Agent directory, search, capability matching
- **audit** — Audit trail, compliance checks, report verification

## Key Deliverables

- 65 MCP tools organized into 4 namespaces
- Namespace-prefixed tool names (e.g., `passport.request_passport`)
- Updated MCP descriptor and tool schemas
- Documentation updates for all namespaces

## Source

- [EPIC-72 full document](https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS/)
