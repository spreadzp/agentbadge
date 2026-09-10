## Where They Overlap

Both AgentBadge and Postman work with APIs and can run automated checks against them. Both have a concept of collections — Postman has request collections, AgentBadge has rule collections organized by pillars. Both care about API quality and help teams ship better APIs.

Postman's test runner can verify that endpoints return expected responses. AgentBadge's scanner verifies that endpoints meet agent-readiness criteria. Both produce reports that help you understand gaps.

## Where They Differ

**Postman is built for human developers.** It provides an interactive UI for sending requests, inspecting responses, writing test scripts, and sharing collections with teammates. Postman excels at manual exploration, automated test suites, mock servers, and API documentation generation.

**AgentBadge is built for AI agent readiness.** It checks things Postman doesn't look at:

- **Discovery**: Does robots.txt allow AI crawlers? Is there an llms.txt file? Can agents find your API?
- **Agent guides**: Does your API have documentation structured for agent consumption?
- **Structured errors**: Do your error responses follow consistent schemas that agents can parse?
- **Docs-vs-implementation consistency**: Does your OpenAPI spec match what your API actually returns?
- **On-chain identity**: Does your API have a verifiable AgentBadge NFT passport?

Postman doesn't check any of these. AgentBadge doesn't do interactive testing, mock servers, or request collections. They operate at different layers of the API lifecycle.

## Use Case Matrix

| Use Case | AgentBadge | Postman | Both |
|----------|-----------|---------|------|
| Manual API testing | — | ✓ | — |
| Mock servers | — | ✓ | — |
| API readiness scoring (122 rules) | ✓ | — | — |
| Agent discovery checks (robots.txt, llms.txt) | ✓ | — | — |
| Agent guide verification | ✓ | — | — |
| On-chain identity (NFT passports) | ✓ | — | — |
| Collection sharing and workspaces | — | ✓ | — |
| Automated test runs | — | ✓ | — |
| End-to-end: test + certify | — | — | ✓ |
