## Where They Overlap

Both AgentBadge and MCP (Model Context Protocol) are open source and work at the intersection of AI agents and APIs. Both recognize that AI agents need structured, reliable ways to interact with APIs — and both want to make that interaction better.

MCP servers expose tools and data sources to AI agents. AgentBadge scans APIs to verify they're ready for agent consumption. If you're building AI agent infrastructure, you're likely to encounter both.

## Where They Differ

**MCP is a connection protocol.** It defines how an AI agent connects to a server, discovers available tools, and calls them. MCP assumes the API is already agent-ready — it doesn't check whether the API has proper error handling, whether robots.txt allows AI crawlers, or whether the OpenAPI spec is complete.

**AgentBadge is a readiness certification service.** It scans your API against 122 rules across 4 pillars (Discovery, Understandability, Executability, Verifiability) and scores how prepared your API is for AI agent consumption. AgentBadge doesn't connect agents to tools — it verifies that the connection will work.

Key differences:

- **MCP doesn't score or certify.** There's no "MCP readiness score" — it's a protocol, not an assessment.
- **AgentBadge doesn't handle connections.** It won't help an agent call your API — it checks whether your API is ready to be called.
- **MCP doesn't check discovery.** Agents find MCP servers through configuration, not through robots.txt or llms.txt.
- **AgentBadge checks the full readiness stack** — from discovery (can agents find you?) to execution (can agents call your endpoints correctly?) to verification (can agents trust the results?).

## Use Case Matrix

| Use Case | AgentBadge | MCP | Both |
|----------|-----------|-----|------|
| Connecting AI agents to tools | — | ✓ | — |
| Scanning API for agent readiness | ✓ | — | — |
| Certifying API with on-chain identity | ✓ | — | — |
| Protocol for agent-to-server communication | — | ✓ | — |
| Checking robots.txt and llms.txt | ✓ | — | — |
| Verifying OpenAPI spec completeness | ✓ | — | — |
| Building agent infrastructure | — | ✓ | — |
| End-to-end: certify + connect | — | — | ✓ |
