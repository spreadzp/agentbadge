## Explanation

OpenAPI is the foundation of agent readiness — but it is only the foundation. Many teams assume that publishing an OpenAPI spec makes their API agent-ready. It does not. OpenAPI describes what endpoints exist; agent readiness ensures agents can find, understand, and successfully use those endpoints.

**What OpenAPI covers well:** endpoint paths, HTTP methods, request parameters, request body schemas, response schemas, authentication schemes, and status codes. A well-written OpenAPI spec tells an agent exactly what to call and what to expect back. This is necessary and valuable.

**What OpenAPI misses entirely:**

1. **Discovery** — OpenAPI does not tell agents where to find the spec itself. An agent needs `robots.txt` or `llms.txt` to discover the OpenAPI URL. Without discovery, the spec is invisible.

2. **Agent guide** — OpenAPI describes the "what" but not the "how." An agent guide explains authentication flows in practice, common usage patterns, idempotency keys, pagination conventions, and workflow sequences. Agents need this context to use the API correctly.

3. **Error handling** — OpenAPI can define error response schemas, but it does not enforce structured error formats. An agent-ready API returns RFC 7807 Problem Details (`application/problem+json`) with consistent fields. Many APIs with OpenAPI specs still return plain text errors or inconsistent JSON error shapes.

4. **Rate limits** — OpenAPI can document rate limits in the description, but the actual enforcement happens via headers. Agent-ready APIs return `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `Retry-After` headers. Agents use these to self-throttle.

5. **Pricing** — OpenAPI has no standard way to declare pricing. An agent needs to know if an endpoint costs money before calling it. Agent-ready APIs expose a `pricing.json` endpoint or declare costs in `llms.txt`.

6. **Consistency** — OpenAPI describes the contract, but the live API may diverge. Agent readiness includes verification — checking that actual responses match the documented schema. Tools like AgentBadge scan for these inconsistencies.

The gap between "has OpenAPI" and "agent-ready" is typically 6-10 additional checks. None require rewriting the API — they are metadata, headers, and documentation layers added on top.

## Example

**API with perfect OpenAPI spec but failing agent readiness:**

```yaml
# openapi.json — flawless spec
openapi: 3.1.0
info:
  title: Payment API
  version: 1.0.0
paths:
  /payments:
    post:
      summary: Create payment
      requestBody:
        content:
          application/json:
            schema:
              type: object
              properties:
                amount: { type: number }
                currency: { type: string }
      responses:
        200:
          description: Payment created
        400:
          description: Bad request
```

**What the agent readiness scanner finds:**

```text
✗ AB-001: No robots.txt allowing AI agents
✗ AB-003: No llms.txt file
✗ AB-007: No agent guide
✗ AB-011: No rate limit headers in responses
✗ AB-010: No pricing.json endpoint
✗ AB-012: Errors return plain text, not application/problem+json
✓ AB-004: OpenAPI spec exists and is valid

Score: 1/7 checks passed — NOT agent-ready
```

The OpenAPI spec is correct but useless to agents who cannot find it, do not know how to authenticate, cannot handle errors, and get rate-limited without warning.
