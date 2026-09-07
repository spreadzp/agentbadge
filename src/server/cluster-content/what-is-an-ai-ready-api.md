## Explanation

An AI-ready API is one that AI agents can discover, understand, and execute autonomously — without human intervention. This definition has three verbs, each mapping to a concrete set of requirements.

**Discover** means the agent can find the API. In practice, this means the API is listed in machine-readable discovery files: `robots.txt` allows AI agent crawlers, `llms.txt` lists the API's documentation and capabilities, and well-known URIs (`.well-known/openapi.json`) point to the spec. An API that requires a human to find it on a website is not discoverable by agents.

**Understand** means the agent can read the API's documentation and know how to use it. This requires an OpenAPI specification (for endpoints, schemas, parameters), an agent guide (for authentication flows, common patterns, error conventions), and structured metadata (llms.txt, JSON-LD). The agent should be able to answer: "What does this endpoint do? How do I authenticate? What will the response look like?"

**Execute** means the agent can make requests and handle responses correctly. This requires structured error responses (RFC 7807), rate limit headers, consistent response schemas, predictable pagination, and clear authentication. An agent that gets a 429 with no `Retry-After` header cannot self-throttle. An agent that gets a plain text "error" cannot parse the failure reason.

The four pillars of an AI-ready API:

1. **Discovery** — robots.txt, llms.txt, well-known URIs, DNS records
2. **Understandability** — OpenAPI spec, agent guide, structured metadata
3. **Executability** — structured errors, rate limits, consistent responses, pricing transparency
4. **Verifiability** — spec-to-implementation consistency, scanner validation, evidence-based checks

An AI-ready API is not the same as a "good API." A well-designed REST API with excellent documentation for humans may still fail agent readiness if it lacks machine-readable metadata. The transformation is additive: you keep the API and add the layers that agents need.

The practical test is simple: can an AI agent, given only the API's base URL, discover the spec, understand the authentication, make a successful request, and handle errors — all without human help? If yes, the API is agent-ready. If no, there's a gap to close.

## Example

**Anatomy of an agent-ready API response:**

```http
HTTP/1.1 200 OK
Content-Type: application/json
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 1700000000
X-Request-ID: req_abc123

{
  "data": {
    "id": "pay_123",
    "amount": 5000,
    "currency": "USD",
    "status": "completed"
  },
  "meta": {
    "request_id": "req_abc123"
  }
}
```

**The same API's discovery layer:**

```text
# robots.txt
User-agent: *
Allow: /

# llms.txt
# Payment API
## Documentation
- OpenAPI: https://api.example.com/openapi.json
- Agent Guide: https://api.example.com/agent-guide.md
## Authentication
- Bearer token: Authorization: Bearer <token>
## Rate Limits
- 100 requests/minute
## Pricing
- $0.01 per successful payment
```

An agent reading these files can discover the API, understand how to use it, and execute calls — all without human intervention.
