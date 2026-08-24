---
related_capabilities:
  - ai-agent-architecture
  - mcp-development
  - scanner
  - cli
related_services:
  - ai-agent-consulting
---
# What Does an AI Agent Actually Need to Understand an API?

## Summary

Beyond OpenAPI: the 8 layers of context an AI agent needs to use an API reliably — discovery, capabilities, inputs, authentication, semantics, output, errors, and safety. OpenAPI describes the interface; agent context makes it usable.

## Problem

An API can be perfectly documented for humans and still be nearly impossible for an AI agent to use. OpenAPI describes structure — paths, methods, schemas. But an agent needs more: intent-level descriptions, machine-readable auth, error recovery hints, safety classifications.

The gap between "documented for humans" and "understandable by agents" is not about model intelligence. It's about missing context layers.

## 8 Context Layers

### 1. Discovery — "What is this API?"

Agent cannot use an API it cannot find. Machine-readable discovery via `llms.txt`, `/.well-known/openapi`, `ai-sitemap.xml`, and `link rel="service"` from homepage.

**Bad:** No llms.txt, no .well-known, no ai-sitemap. API is invisible to autonomous discovery.

**Better:** `llms.txt` at root, `/.well-known/openapi` or `/.well-known/service-desc`, `ai-sitemap.xml` with API endpoints.

### 2. Capabilities — "What can I do here?"

Agents plan actions at the intent level, not HTTP method level. `POST /orders` — is that creating, updating, or processing?

**Bad:** Bare endpoint listing. Agent sees HTTP methods but doesn't understand intent.

**Better:** Capability descriptions: "search products", "create orders", "check order status", "cancel an order".

### 3. Inputs — "What do I need to provide?"

Agents cannot read between the lines. Empty `description: ""` means the agent doesn't know what to send.

**Bad:** `customer_id: string, description: ""`

**Better:** `customer_id: UUID, required, "UUID of an existing customer, obtained from GET /customers", example, constraints`.

### 4. Authentication — "Do I have permission?"

One of the top failure causes. Agents need machine-readable auth metadata to autonomously authenticate.

**Bad:** Human OAuth docs with browser redirect flows. Agent cannot execute browser steps.

**Better:** `securitySchemes` in OpenAPI + `/.well-known/oauth-authorization-server` (RFC 8414) for machine-readable discovery.

### 5. Semantics — "What does this operation actually mean?"

Critical for autonomous agents: is the operation safe? Can it be retried? Are there side effects? Does it charge money?

**Bad:** `POST /api/v2/process, summary: "Process", description: ""`

**Better:** `x-agent-semantics: { operation: create, side-effects: true, idempotent: false, charges-money: true, safe-to-retry: false }`

### 6. Output — "What will I get?"

Agents need action chains. Not just "what came back" but "what to do next."

**Bad:** `responses: 200, description: "OK", schema: type: object`

**Better:** Full response schema with `enum`, `format`, `description`, `examples`, and `next_actions` array.

### 7. Errors — "What if something goes wrong?"

Good agent APIs describe not only how to succeed but how to recover. Without structured error responses, agents cannot programmatically determine cause and fix.

**Bad:** `400 Bad Request {"error": "invalid_request"}`

**Better:** RFC 9457 Problem Details + field-level errors + recovery hints: `errors: [{field: "customer_id", code: "invalid_format", message: "Expected UUID format"}]`, `recovery_hint: "Obtain a valid customer_id from GET /customers"`

### 8. Safety — "Is it safe to do this?"

`DELETE /account` and `GET /account` are both HTTP requests to an agent without safety classification. But the risk is entirely different.

**Bad:** No safety classification. Agent treats all operations the same.

**Better:** `x-agent-safety: { risk-level: financial, reversible: false, requires-confirmation: true, warning: "This action permanently deletes the account" }`

Safety levels: `read-only` → `write` → `destructive` → `financial` → `irreversible`.

## Agent Readiness

These 8 context layers = 8 categories of measurement. Agent Readiness is the measurable set of properties that determine whether an autonomous agent can discover, understand, and successfully use your API.

- [What Is Agent Readiness?](/agent-guide/articles/what-is-agent-readiness) — foundational concept
- [Why AI Agents Fail to Use APIs](/agent-guide/articles/why-ai-agents-fail-apis) — 7 failure modes these layers solve

## Measurement

```bash
# Run the AgentBadge scanner
npx @agentbadge/cli scan https://api.example.com

# JSON report
npx @agentbadge/cli scan https://api.example.com --format json > report.json
```

72 checks in seconds. Free, no signup.

## API Endpoints

- `GET /agent-guide/` — Agent Knowledge Layer index
- `GET /agent-guide/knowledge-map.json` — Structured graph of concepts and capabilities
- `GET /agent-guide/concepts/agent-readiness` — Agent Readiness concept
- `GET /agent-guide/concepts/scoring` — Scoring engine concept
- `GET /agent-guide/articles/what-is-agent-readiness` — Article 1: foundation
- `GET /agent-guide/articles/seo-vs-agent-readiness` — Article 2: SEO vs Agent Readiness
- `GET /agent-guide/articles/web-becoming-agentic-api-discovery` — Article 3: agentic web discovery
- `GET /agent-guide/articles/seo-geo-agent-readiness` — Article 4: SEO → GEO → Agent Readiness
- `GET /agent-guide/articles/why-ai-agents-fail-apis` — Article 5: 7 failure modes
- `GET /agent-guide/articles/why-openapi-isnt-enough` — Article 7: why OpenAPI isn't enough
- `GET /llms.txt` — LLM entry point
- `GET /ai-sitemap.xml` — Machine-readable resource map

## Recommended Actions

1. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — Foundation: what Agent Readiness is
2. [Read Article 5](/agent-guide/articles/why-ai-agents-fail-apis) — 7 failure modes these 8 layers solve
3. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
4. Run a scan — `npx @agentbadge/cli scan https://your-api.com`
5. Review evidence — every finding links to the HTTP response that produced it
6. Fix gaps — add `llms.txt`, complete OpenAPI descriptions, add error schemas, add safety metadata
7. Monitor — re-scan after changes to track improvements

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `discovery` (concept), `authentication` (concept), `semantics` (concept), `safety` (concept), `machine-readability` (concept), `scanner` (capability), `ai-agent-architecture` (capability), `what-ai-agent-needs-to-understand-api` (article)
- **Edges**:
  - `what-ai-agent-needs-to-understand-api` → defines → `agent-readiness`
  - `what-ai-agent-needs-to-understand-api` → measured by → `scanner`
  - `what-ai-agent-needs-to-understand-api` → requires → `discovery`
  - `what-ai-agent-needs-to-understand-api` → requires → `authentication`
  - `what-ai-agent-needs-to-understand-api` → requires → `semantics`
  - `what-ai-agent-needs-to-understand-api` → requires → `safety`
  - `agent-readiness` → measured by → `scanner`
  - `ai-agent-architecture` → related to → `agent-readiness`

---

*This article is part of the AgentBadge Content Marketing Wave 2, Block B. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
