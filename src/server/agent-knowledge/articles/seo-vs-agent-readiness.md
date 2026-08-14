---
related_capabilities:
  - ai-agent-architecture
  - geo-optimization
related_services:
  - ai-agent-consulting
  - geo-consulting
---
# Your API Has SEO. Does It Have Agent Readiness?

## Summary

SEO optimized websites for search engines. Agent Readiness optimizes APIs for AI agents. This article explains why a good SEO score doesn't mean an API is agent-ready, the four dimensions of Agent Readiness, and how to test your API.

## Problem

Your API might have excellent SEO on its landing page, proper meta tags, a sitemap, and good Google indexing. But when an AI agent tries to use it, the agent hits a wall.

SEO helps a search engine **understand a page**. An agent needs to **take an action** — discover endpoints, authenticate, call APIs, handle errors, recover. These are different problems requiring different infrastructure.

A search engine reads. An agent acts.

## AgentBadge Relevance

AgentBadge measures Agent Readiness using deterministic checks — not AI opinions. Each check produces evidence: HTTP response, header, body fragment. The same URL + same ruleset version always produces the same score.

AgentBadge doesn't certify. It measures.

## Key Concepts

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — Definition and why it matters for the agentic web
- [Scoring Engine](/agent-guide/concepts/scoring) — How APIs are scored using binary rules with evidence
- [Trust Badge](/agent-guide/concepts/badge) — What the badge means (trust signal, not certification)

## SEO vs Agent Readiness

| SEO | Agent Readiness |
|-----|-----------------|
| Search engines find your website | AI agents find your API |
| `robots.txt` tells crawlers what to index | `llms.txt` tells agents what your API does |
| Sitemap helps Google discover pages | Agent card helps agents discover capabilities |
| Meta tags describe page content | OpenAPI spec describes API endpoints |
| Page speed affects ranking | Machine-readability affects agent usability |
| Search ranking = visibility | Agent Readiness score = usability |

## Four Dimensions of Agent Readiness

1. **Discovery** — Can agents find your API? (`llms.txt`, well-known endpoints, ai-sitemap)
2. **Documentation** — Can agents understand your API? (OpenAPI spec, machine-readable descriptions)
3. **Authentication** — Can agents authenticate? (OAuth discovery, token endpoint, scopes)
4. **Machine-readability** — Can agents process responses? (structured errors, rate limit headers, content negotiation)

Each dimension is independent. An API can excel in Documentation but fail in Discovery.

## Capabilities

- [Passive Scanner](/agent-guide/capabilities/scanner) — Non-intrusive HTTP-based scanning of public endpoints
- [CLI Tool](/agent-guide/capabilities/cli) — Local scanning via npm/npx, free and private

## CLI Commands

```bash
# Scan an API
npx @agentbadge/cli scan https://api.example.com

# Scan with verbose output
npx @agentbadge/cli scan https://api.example.com --verbose

# Output JSON report
npx @agentbadge/cli scan https://api.example.com --format json > report.json
```

## API Endpoints

- `GET /agent-guide/` — Agent Knowledge Layer index
- `GET /agent-guide/context` — Product context and what AgentBadge does
- `GET /agent-guide/learn` — Step-by-step learning path
- `GET /agent-guide/knowledge-map.json` — Structured graph of concepts and capabilities
- `GET /agent-guide/concepts/agent-readiness` — Agent Readiness concept
- `GET /agent-guide/concepts/scoring` — Scoring engine concept
- `GET /agent-guide/concepts/badge` — Trust badge concept
- `GET /agent-guide/capabilities/scanner` — Passive scanner capability
- `GET /agent-guide/capabilities/cli` — CLI tool capability
- `GET /llms.txt` — LLM entry point

## Self-Test: 7 Questions

If a new AI agent encountered your API today, could it independently answer:

1. Where is the OpenAPI spec?
2. What authorization is needed?
3. What capabilities does the API offer?
4. What errors can occur?
5. What are the rate limits?
6. How much does it cost?
7. Can an agent complete a task end-to-end?

If 3+ answers are "not sure" — you have an Agent Readiness gap.

## Recommended Actions

1. [Read the context](/agent-guide/context) — Understand what AgentBadge does
2. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — Foundation: what Agent Readiness is
3. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
4. Run a scan — Web UI, CLI (`npx @agentbadge/cli scan URL`), or GitHub Action
5. Review your evidence — every finding links to the HTTP response that produced it
6. Fix the gaps — add `llms.txt`, improve OpenAPI, structure your errors
7. Display your badge — show your measured Agent Readiness score

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `scanner` (capability), `scoring` (concept), `badge` (concept), `cli` (capability), `seo-vs-agent-readiness` (article)
- **Edges**:
  - `seo-vs-agent-readiness` → builds on → `agent-readiness`
  - `agent-readiness` → measured by → `scanner`
  - `scanner` → feeds into → `scoring`
  - `scoring` → produces → `badge`
  - `cli` → invokes → `scanner`

## Full Article

> **For AI agents:** See the [Agent Knowledge Layer](/agent-guide/) for machine-readable product capabilities, scanning instructions, and API access.

### 20 Years of SEO → A New Era

We've spent 20 years making websites discoverable by search engines. `robots.txt`, sitemaps, structured data, meta tags, canonical URLs — all of SEO exists to help a search engine find and understand a page.

Now there's a new consumer of information: the AI agent. It doesn't just need to find a page. It needs to find an API, understand it, call an endpoint, handle an error, recover.

```
Web page  →  Search engine  →  SEO
API       →  AI agent       →  Agent Readiness
```

This isn't an evolution of SEO. It's a new layer.

### SEO ≠ Discoverability

Your API can have excellent SEO on its landing page, proper meta tags, a sitemap, and good Google indexing — and still be invisible to an AI agent.

Why? Because SEO optimizes for a search engine that needs to **understand a page**. An agent needs to **take an action**. These are different tasks.

A search engine reads. An agent acts.

### Human-Readable vs Machine-Readable

The key difference between SEO and Agent Readiness is the format of information.

**Human-readable (good for developers):**
```
"To refund an order, contact our support team at support@example.com
or visit the refunds page in your dashboard."
```

**Machine-readable (good for agents):**
```json
POST /refund
Authorization: Bearer {token}
Content-Type: application/json

{
  "order_id": "ord_123",
  "reason": "customer_request"
}

→ 200 OK
{
  "refund_id": "ref_456",
  "status": "processed",
  "amount": 99.00
}
```

A human can guess. An agent can't. An agent needs structure.

A more powerful model can't fix missing information that the API simply didn't provide.

### Four Dimensions of Agent Readiness

| Dimension | Question | What We Check |
|-----------|----------|---------------|
| **Discovery** | Can an agent find the API? | `llms.txt`, well-known, OpenAPI URL, ai-sitemap |
| **Documentation** | Can an agent understand capabilities? | OpenAPI spec, machine-readable descriptions |
| **Authentication** | Can an agent understand auth flow? | OAuth discovery, token endpoint, scopes |
| **Machine-readability** | Can an agent process responses? | Structured errors, rate limit headers, content negotiation |

Each dimension is independent. An API can be excellent in Documentation but fail in Discovery.

### AgentBadge: Measure, Don't Certify

AgentBadge doesn't certify APIs. It measures how accessible an API is to agents.

The process:
```
Measure → Evidence → Fix → Monitor
```

- **Measure:** 72 deterministic checks (not "AI opinion", but observable facts)
- **Evidence:** each check has proof — HTTP response, header, body fragment
- **Fix:** specific recommendations on what to change
- **Monitor:** regular rescans, delta tracking

Why not "AI scoring": LLMs can hallucinate. Deterministic checks can't. If we say "OpenAPI spec not found" — that's a fact, not an opinion.

### Call to Action

AI agents are becoming a major consumer of APIs. If your API isn't agent-ready, you're invisible to an entire category of users.

**Run a free Agent Readiness scan.**

1. [Read the context](/agent-guide/context) — Understand what AgentBadge does
2. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — What is Agent Readiness?
3. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
4. Run a scan — Web, CLI, or GitHub Action

---

*This article is part of the AgentBadge Content Marketing Wave 1. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
