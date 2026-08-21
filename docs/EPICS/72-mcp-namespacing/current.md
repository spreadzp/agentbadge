# EPIC-72 — Current State

## Active Task

SLICE-72-1 COMPLETE. Ready for SLICE-72-2 (Multi-registry architecture).

## What's Done

- [x] EPIC-72 main document created
- [x] 10 slice documents created (SLICE-72-1 through SLICE-72-10)
- [x] Progressive context files initialized (current.md, decisions.md)
- [x] SLICE-72-1: Tool audit & namespace mapping complete
  - Runtime tool count: 65 (captured from `POST /mcp` `tools/list`)
  - Source tool count: 65 (matches runtime — no discrepancy)
  - `docs/MCP/tool-inventory.txt` — runtime tool list
  - `docs/MCP/namespace-mapping.md` — full mapping with reclassification
  - 17 parity-tools reclassified out of audit-mcp into more specific namespaces
  - No tool name collisions

## What's Next

- SLICE-72-2: Refactor `packages/mcp/src/server.ts` to support `NamespaceRegistry` class
- SLICE-72-3: Create parameterized namespace route factory

## Active Decisions

- 4 namespaces: passport-mcp (18 tools), market-mcp (13 tools), discovery-mcp (22 tools), audit-mcp (12 tools)
- Backward compatibility: `/mcp` endpoint remains as aggregator with all tools
- `/.well-known/mcp.json` updated to list all 4 namespace endpoints as `remotes`
- Each namespace gets its own `/.well-known/*-mcp.json` descriptor
- Tool registration functions accept optional `NamespaceRegistry` param (backward compatible)
- Stdio server supports `MCP_NAMESPACE` env var or CLI arg for namespace selection
- parity-tools.ts reclassified: 17 of 26 tools moved to non-audit namespaces based on functional purpose

## Open Questions

- Should `/mcp` aggregator double-register tools or merge namespace `listTools()` results?
  - SLICE-72-9 will decide based on implementation simplicity
- None (resolved: source and runtime both show 65 tools)

## Failed Approaches

- None yet

## Next Checkpoint

- SLICE-72-2: Multi-registry architecture in `packages/mcp`
- Create `NamespaceRegistry` class, refactor `McpServer` to support multiple registries
