---
related_capabilities:
  - scanner
  - geo-optimization
related_services:
  - api-development
---

# API Discovery

## What Is API Discovery?

API discovery is the problem of agents finding and understanding available APIs without human documentation. The web solved discovery for humans (search engines, docs sites); agents need machine-readable equivalents: catalogs, manifests, well-known endpoints, and structured metadata that describe what an API does, how to authenticate, and what it costs.

## The Discovery Stack

- **`llms.txt` / `llms-full.txt`** — LLM-friendly site catalogs (llmstxt.org convention).
- **`/.well-known/agent-card.json`** — A2A agent identity and capabilities.
- **`/.well-known/api-catalog`** — RFC 9727 linkset of API endpoints.
- **`/.well-known/mcp.json` + namespaced descriptors** — MCP server and tool discovery.
- **`/sitemap.xml` + `/ai-sitemap.xml`** — crawlable URL inventories for agents.
- **OpenAPI specs** — the baseline machine-readable contract.

## AgentBadge Discovery Surface

Our own discovery stack is the reference implementation — we scan other APIs for exactly these signals (200+ deterministic rules across discovery, docs, auth, payments) and publish our own manifests at every layer.

## Related

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — how we score discovery
- [Passive Scanner](/agent-guide/capabilities/scanner) — the tool that checks it
- [GEO Optimization](/agent-guide/capabilities/geo-optimization) — generative-engine visibility
- [MCP](/agent-guide/concepts/mcp) — tool-level discovery
