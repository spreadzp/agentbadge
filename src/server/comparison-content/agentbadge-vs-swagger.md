## Where They Overlap

Both AgentBadge and Swagger (OpenAPI) care about API quality and documentation. Both use the OpenAPI Specification as a foundation — Swagger creates it, AgentBadge verifies it's sufficient. Both want APIs to be well-documented and usable.

Swagger Editor helps you write OpenAPI specs. Swagger UI renders interactive documentation from those specs. AgentBadge scans your API and checks whether the OpenAPI spec exists, is complete, and accurately describes the API's behavior.

## Where They Differ

**Swagger generates documentation for humans.** It creates beautiful, interactive API docs that developers can browse, try requests, and understand endpoints. Swagger assumes humans are reading the documentation — it doesn't optimize for AI agent consumption.

**AgentBadge verifies documentation is sufficient for AI agents.** Having an OpenAPI spec is necessary but not enough. AgentBadge checks:

- **Discovery**: Can agents find your API via robots.txt, llms.txt, or other discovery mechanisms? Swagger doesn't help here.
- **Agent guides**: Is there documentation structured specifically for agent consumption (not just human-readable docs)?
- **Error handling**: Do error responses follow structured, machine-parseable schemas? Swagger documents errors but doesn't verify they're consistent.
- **Docs-vs-implementation consistency**: Does your OpenAPI spec match what your API actually returns? Swagger assumes the spec is accurate.
- **On-chain identity**: Does your API have a verifiable AgentBadge NFT passport? Swagger has no concept of identity.

Swagger creates the spec. AgentBadge verifies it's sufficient for AI agents. You need both.

## Use Case Matrix

| Use Case | AgentBadge | Swagger | Both |
|----------|-----------|---------|------|
| Creating OpenAPI documentation | — | ✓ | — |
| Interactive API explorer (Swagger UI) | — | ✓ | — |
| OpenAPI spec generation | — | ✓ | — |
| API readiness scoring (122 rules) | ✓ | — | — |
| Agent discovery checks (robots.txt, llms.txt) | ✓ | — | — |
| Agent guide verification | ✓ | — | — |
| Error handling consistency checks | ✓ | — | — |
| Docs-vs-implementation verification | ✓ | — | — |
| On-chain identity (NFT passports) | ✓ | — | — |
| End-to-end: document + verify | — | — | ✓ |
