## Explanation

AI agents use APIs through a multi-step pipeline: discovery, documentation reading, authentication, request execution, response handling, and call chaining. Each step has specific requirements, and failures at any step halt the agent's workflow.

**Step 1: Discovery.** Agents find APIs through several channels. They check `robots.txt` for AI bot permissions, read `llms.txt` for API documentation links, query well-known URIs (`.well-known/openapi.json`), and follow DNS records or directory listings. Some agents also use natural language search to find APIs mentioned in documentation. Without discovery files, the agent cannot find the API at all.

**Step 2: Documentation reading.** Once the agent finds the API, it reads the OpenAPI specification to understand endpoints, parameters, and response schemas. It reads the agent guide for authentication flows, common patterns, and error conventions. It reads `llms.txt` for a high-level summary. The agent builds an internal model of the API: what calls are possible, what parameters are required, and what responses to expect.

**Step 3: Authentication.** The agent determines how to authenticate from the OpenAPI security schemes and agent guide. Common patterns: Bearer tokens in the `Authorization` header, API keys in headers or query parameters, OAuth 2.0 flows, or mTLS certificates. The agent needs clear, machine-readable auth instructions — ambiguous auth is a common failure point.

**Step 4: Request execution.** The agent constructs and sends HTTP requests based on its internal model. It sets headers, serializes request bodies, and handles URL encoding. Rate limit headers (`X-RateLimit-Remaining`) tell the agent when to throttle. A well-designed API makes this step predictable: consistent parameter names, standard HTTP methods, and clear content types.

**Step 5: Response handling.** The agent parses the response, checks the status code, and extracts data. Structured error responses (RFC 7807 `application/problem+json`) let the agent understand failures and decide whether to retry, request different parameters, or report an error to the user. Unstructured errors ("Something went wrong") force the agent to guess, leading to retry loops or abandoned tasks.

**Step 6: Call chaining.** Real tasks require multiple API calls. An agent might: search for a user, create a payment for that user, verify the payment status, and send a notification. Each call depends on data from the previous one. Agent-ready APIs support chaining by using consistent ID formats, predictable pagination, and clear relationship links between resources.

The entire pipeline runs autonomously. If any step fails, the agent cannot complete its task — which is why agent readiness checks each step independently.

## Example

**Agent making a multi-step API call chain:**

```text
1. Agent reads llms.txt
   → Finds: OpenAPI at /openapi.json, Agent Guide at /agent-guide.md

2. Agent reads OpenAPI spec
   → Finds: POST /users/search, GET /users/{id}/payments, POST /payments

3. Agent authenticates
   → Reads: "Bearer token in Authorization header"
   → Sets: Authorization: Bearer sk_agent123

4. Agent searches for user
   → POST /users/search {"email": "alice@example.com"}
   ← 200 OK {"data": {"id": "usr_456", "name": "Alice"}}

5. Agent fetches payment history
   → GET /users/usr_456/payments?limit=5
   ← 200 OK, X-RateLimit-Remaining: 98
   ← {"data": [{"id": "pay_789", "amount": 5000}]}

6. Agent creates new payment
   → POST /payments {"user_id": "usr_456", "amount": 3000}
   ← 201 Created {"data": {"id": "pay_999", "status": "pending"}}

7. Agent handles rate limit
   → X-RateLimit-Remaining: 1
   → Agent waits 60s before next call
```

Each step depends on the previous one succeeding. Structured responses, consistent IDs, and rate limit headers make the chain possible.
