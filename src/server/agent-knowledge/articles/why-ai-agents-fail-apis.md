---
related_capabilities:
  - scanner
  - cli
  - ai-agent-architecture
related_services:
  - ai-agent-consulting
---
# Why AI Agents Fail to Use APIs

## Summary

AI agents don't fail because the model is stupid. They fail because APIs are designed for humans, not autonomous software. This guide covers 7 failure modes — from discovery to runtime — and how AgentBadge measures each one with deterministic checks.

## Problem

A developer gives an agent a task: "Find a payment API and process a refund." The agent needs to:

1. **Discover** the API (where is it?)
2. **Understand** it (what does it do?)
3. **Authenticate** (how do I get a token?)
4. **Know semantics** (is this endpoint safe? idempotent?)
5. **Parse schemas** (what fields come back?)
6. **Recover from errors** (what went wrong? should I retry?)
7. **Act safely** (can I retry without double-charging?)

At each step, the agent can fail — not because the model lacks intelligence, but because the API infrastructure was designed for a human who fills gaps with context, experience, and intuition.

A valid OpenAPI file is necessary but not sufficient. The spec can be structurally correct but semantically empty.

## AgentBadge Relevance

AgentBadge measures each failure mode with deterministic checks — not AI opinions, but observable facts backed by HTTP evidence:

```
Discovery failure    → AB-001..AB-010  (llms.txt, .well-known, ai-sitemap)
Documentation failure → AB-020..AB-030  (OpenAPI completeness, descriptions, examples)
Auth failure         → AB-030..AB-040  (securitySchemes, OAuth discovery, RFC 8414)
Semantic failure     → AB-040..AB-050  (description quality, idempotency metadata)
Schema failure       → AB-050..AB-060  (response schemas, type specificity, examples)
Error recovery       → AB-060..AB-070  (Problem Details, error codes, retry guidance)
Runtime failure      → AB-070..AB-072  (idempotency keys, rate limit headers, safety)
```

Each check is binary: pass or fail. Each pass has evidence. Each fail has a fix recommendation.

## Key Concepts

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — The property of being usable by autonomous agents
- [Scoring Engine](/agent-guide/concepts/scoring) — Binary rules with evidence, not subjective scoring
- [Agent Knowledge Layer](/agent-guide/) — Machine-readable product context for AI agents

## The Seven Failure Modes

### 1. Discovery Failure

Agent cannot find the API. No `llms.txt`, no `/.well-known/` endpoints, no `ai-sitemap.xml`, no `link rel="service"` from homepage.

**Agent sees:** Marketing HTML pages, no machine-readable API description.
**Human assumes:** "Our API is at docs.example.com. Everyone knows that."
**Fix:** `llms.txt` at root, `/.well-known/openapi`, `ai-sitemap.xml`, `link rel="service"`.
**Measured by:** AgentBadge Discovery checks (AB-001 through AB-010).

### 2. Documentation Failure

OpenAPI spec exists but is semantically empty. Descriptions are one word or empty. No examples. No error schemas.

**Agent sees:** Structure without meaning. `summary: "Get user"` — what fields? what format?
**Human assumes:** "It says 'Get user'. Obviously it returns a user object."
**Fix:** Full descriptions for every endpoint, parameter, and response. Examples. Error schemas.
**Measured by:** AgentBadge Documentation checks (completeness, descriptions, examples).

### 3. Authentication Failure

Auth documentation is written for humans. OAuth flow described with browser redirects. No machine-readable `securitySchemes`. No OAuth discovery endpoint.

**Agent sees:** HTML page with OAuth instructions for humans. No token endpoint URL in OpenAPI.
**Human assumes:** "OAuth 2.0 is standard. Everyone knows how it works."
**Fix:** `securitySchemes` in OpenAPI with full descriptions. Token endpoint URL. `client_credentials` support. `/.well-known/oauth-authorization-server` (RFC 8414).
**Measured by:** AgentBadge Authentication checks (auth metadata, OAuth discovery, security schemes).

### 4. Semantic Failure

Endpoint exists but agent doesn't understand what it does. `POST /api/v2/process` — process what? Create? Update? Delete? Is it safe? Is it idempotent?

**Agent sees:** HTTP method + path + parameters. No semantic metadata.
**Human assumes:** "The endpoint name is self-explanatory."
**Fix:** Full `description` fields with semantics. `idempotent: true/false`. Side effects documentation. Semantic labels.
**Measured by:** AgentBadge Semantic checks (description completeness, semantic clarity, idempotency).

### 5. Schema Failure

Response schema is incomplete or missing. `type: object` without properties. No `enum` for constrained values. No `format` for types. No examples.

**Agent sees:** `type: object` — no properties, no examples, no way to know what fields exist.
**Human assumes:** "The response is obvious from the docs."
**Fix:** Full response schemas with all properties. `enum` for constrained values. `format` for types. Examples in OpenAPI.
**Measured by:** AgentBadge Schema checks (response schema completeness, type specificity, examples).

### 6. Error Recovery Failure

Error responses are unstructured. `400 Bad Request {"error": "invalid_request"}` — invalid what? Which parameter? Should the agent retry?

**Agent sees:** HTTP status code + vague error body. No machine-readable error codes. No retry guidance.
**Human assumes:** "The error message explains what's wrong."
**Fix:** Structured error responses (RFC 9457 Problem Details). Machine-readable error codes. Parameter-level error details. `Retry-After` header.
**Measured by:** AgentBadge Error Recovery checks (error schema, problem details, retry guidance).

### 7. Runtime/Action Failure

API works but is unsafe for autonomous use. No idempotency keys. No rate limit headers. Side effects not documented. Agent retries a transfer → double charge.

**Agent sees:** Endpoint works, but no idempotency key support. No information about retry safety.
**Human assumes:** "Obviously you don't retry a transfer."
**Fix:** Idempotency key support for mutation endpoints. `Retry-After` and rate limit headers. Side effects documentation. Safe/unsafe operation labeling.
**Measured by:** AgentBadge Runtime checks (idempotency, rate limits, safety metadata).

## Valid OpenAPI ≠ Agent-Ready API

```
Valid OpenAPI                    Agent-Ready API
✓ Structure is correct           ✓ + Full descriptions
✓ Paths are defined              ✓ + Examples for every response
✓ Schemas exist                  ✓ + Complete response schemas
✓ Security schemes listed        ✓ + Machine-discoverable auth
                                  ✓ + Error schemas with Problem Details
                                  ✓ + Idempotency metadata
                                  ✓ + Discovery endpoints (llms.txt, .well-known)
```

This is like valid HTML that isn't accessible. Technically correct, but unusable for a class of consumers.

## Capabilities

- [Passive Scanner](/agent-guide/capabilities/scanner) — 72 checks across 15 categories, non-intrusive HTTP scanning
- [CLI Tool](/agent-guide/capabilities/cli) — Local scanning via `npx @agentbadge/cli scan`
- [Agent Knowledge Layer](/agent-guide/) — Machine-readable product context

## CLI Commands

```bash
# Scan an API for agent readiness — covers all 7 failure modes
npx @agentbadge/cli scan https://api.example.com

# JSON output for programmatic use
npx @agentbadge/cli scan https://api.example.com --format json > report.json

# Verbose evidence output
npx @agentbadge/cli scan https://api.example.com --verbose
```

## API Endpoints

- `GET /agent-guide/` — Agent Knowledge Layer index
- `GET /agent-guide/knowledge-map.json` — Structured graph of concepts and capabilities
- `GET /agent-guide/concepts/agent-readiness` — Agent Readiness concept
- `GET /agent-guide/concepts/scoring` — Scoring engine concept
- `GET /agent-guide/articles/what-is-agent-readiness` — Article 1: foundation
- `GET /agent-guide/articles/seo-vs-agent-readiness` — Article 2: SEO vs Agent Readiness
- `GET /agent-guide/articles/web-becoming-agentic-api-discovery` — Article 3: agentic web discovery
- `GET /agent-guide/articles/seo-geo-agent-readiness` — Article 4: SEO → GEO → Agent Readiness
- `GET /llms.txt` — LLM entry point
- `GET /ai-sitemap.xml` — Machine-readable resource map

## Recommended Actions

1. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — Foundation: what Agent Readiness is
2. [Read Article 4](/agent-guide/articles/seo-geo-agent-readiness) — Evolution: SEO → GEO → Agent Readiness
3. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
4. Run a scan — `npx @agentbadge/cli scan https://your-api.com`
5. Review evidence — every finding links to the HTTP response that produced it
6. Fix gaps — add `llms.txt`, complete OpenAPI descriptions, add error schemas, support idempotency
7. Monitor — re-scan after changes to track improvements

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `scanner` (capability), `scoring` (concept), `ai-agent-architecture` (capability), `why-ai-agents-fail-apis` (article)
- **Edges**:
  - `why-ai-agents-fail-apis` → identifies → `agent-readiness`
  - `why-ai-agents-fail-apis` → measured by → `scanner`
  - `agent-readiness` → measured by → `scanner`
  - `scanner` → feeds into → `scoring`
  - `ai-agent-architecture` → related to → `agent-readiness`

---

*This article is part of the AgentBadge Content Marketing Wave 2, Block B. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
