---
related_capabilities:
  - scanner
  - geo-optimization
related_services:
  - api-development
---

# Machine-Readable Interfaces

## What Is Machine-Readable?

Machine-readable means a resource is structured for programmatic consumption — JSON manifests, Markdown docs, OpenAPI specs, well-known endpoints — rather than HTML meant for human eyes. For agents, "machine-readable" is the difference between parseable and guesswork: a `/.well-known/agent-card.json` can be fetched and acted on; a marketing page cannot.

## The Machine-Readable Stack

- **Well-known URIs** — `/.well-known/*` endpoints (agent-card, mcp.json, x402.json, did.json, security.txt) per RFC 8615.
- **llms.txt** — LLM-friendly site catalog.
- **OpenAPI / JSON Schema** — API contracts agents can validate against.
- **Markdown knowledge layer** — `/agent-guide/*` serves clean Markdown for agent consumption.
- **Structured errors** — JSON error bodies with codes and suggestions, not HTML error pages.

## AgentBadge Machine-Readable Surface

Our scanner checks customer APIs for exactly this stack — 200+ rules across discovery, docs, auth, and payments. Our own surface is the reference: every manifest, every error contract, every knowledge page is machine-readable by design.

## Related

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — the scoring framework
- [API Discovery](/agent-guide/concepts/api-discovery) — the discovery layer
- [Passive Scanner](/agent-guide/capabilities/scanner) — checks machine-readability
- [MCP](/agent-guide/concepts/mcp) — machine-readable tools
