# EPIC-47: AgentGrade 100 & CLI Parity

**Goal:** Make agentbadge.xyz server pass 100% AgentGrade compliance, and extend CLI schema/fetchers/rules to support new checks.

**Status:** In Progress

## Blocks

- **A: Server endpoints** (slices 47-4 to 47-12) — content negotiation, llms-full.txt, skill.md, homepage meta, cache headers, OpenAPI, x402, Bazaar, agents.txt, RSS, WebMCP
- **B: CLI schema + fetchers** (slices 47-13 to 47-14) — schema extensions, new fetchers
- **C: CLI rules** (slices 47-15 to 47-16) — new rules for content, MCP, llms, skill, payments, OpenAPI, infra
- **D: CLI flags + orchestrator** (slices 47-17 to 47-18) — new flags, orchestrator integration
- **E: Pretty output + watch** (slice 47-19) — pretty CLI, web report link, --watch
- **F: Testing** (slices 47-20 to 47-22) — server integration tests, CLI unit tests, E2E

## Source Documents

- Full EPIC: `docs/EPICS/47-agentgrade-100-and-cli-parity/EPIC-47-agentgrade-100-and-cli-parity.md`
- SPEC: `docs/CONCURENTS/agent-grade/docs-for-epics/SPEC-01-server-agentgrade-100.md`
