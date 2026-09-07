## Explanation

Making an API agent-ready is a systematic process that spans four pillars: discovery, understandability, executability, and verifiability. Each pillar addresses a specific bottleneck that prevents AI agents from using your API effectively.

**Discovery** is the first step. AI agents need to find your API before they can use it. This means having a `robots.txt` file that explicitly allows AI agent crawlers, an `llms.txt` file at the root that lists your API documentation and capabilities, and DNS records or well-known URIs that point to your OpenAPI spec. Without these signals, your API is invisible to agents — no matter how well-designed it is.

**Understandability** comes next. Once an agent finds your API, it needs to understand what the API does and how to use it. An OpenAPI specification is the foundation — it describes endpoints, parameters, request bodies, and response schemas. But understandability also requires an agent guide: a markdown document that explains authentication flows, rate limits, common usage patterns, and error handling conventions. The agent guide bridges the gap between machine-readable specs and practical usage.

**Executability** ensures that an agent can actually make requests and get useful responses. This means consistent error formats (RFC 7807 Problem Details), clear rate limit headers (`X-RateLimit-Limit`, `X-RateLimit-Remaining`), predictable pagination, and responses that match the documented schema. Many APIs have excellent documentation but fail executability checks because the actual responses diverge from the spec.

**Verifiability** is the final pillar. An agent (or its operator) should be able to verify that the API behaves as documented. This includes consistency between the OpenAPI spec and live responses, valid structured data in responses, and machine-readable metadata that can be checked programmatically. Tools like AgentBadge scan APIs against a ruleset of 60+ checks to verify agent readiness.

The transformation from a standard API to an agent-ready API is not about rewriting — it's about adding machine-readable layers. Most of the work is metadata: `robots.txt`, `llms.txt`, an agent guide, structured error responses, and rate limit headers. The core API logic stays the same.

## Example

**Before** — a typical REST API with no agent-readiness features:

```
GET /api/users/123
→ 200 OK
   { "id": 123, "name": "Alice" }

# No robots.txt, no llms.txt, no OpenAPI spec
# Errors return plain text: "User not found"
# No rate limit headers
```

**After** — the same API, agent-ready:

```
# robots.txt
User-agent: *
Allow: /

# llms.txt
# AgentBadge API
## Documentation
- OpenAPI: https://api.example.com/openapi.json
- Agent Guide: https://api.example.com/agent-guide.md
## Authentication
- Bearer token in Authorization header
## Rate Limits
- 100 requests/minute

# GET /api/users/123
→ 200 OK
   Content-Type: application/json
   X-RateLimit-Limit: 100
   X-RateLimit-Remaining: 99
   { "id": 123, "name": "Alice" }

# Error response (RFC 7807)
→ 404 Not Found
   Content-Type: application/problem+json
   {
     "type": "https://api.example.com/errors/not-found",
     "title": "User not found",
     "status": 404,
     "detail": "User 123 does not exist"
   }
```
