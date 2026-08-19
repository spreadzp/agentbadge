---
related_capabilities:
  - geo-optimization
  - ai-agent-architecture
  - scanner
  - cli
related_services:
  - geo-consulting
  - ai-agent-consulting
---
# From SEO to GEO to Agent Readiness

## Summary

The object of optimization is changing. SEO optimized websites for search engines. GEO optimizes content for generative AI. Agent Readiness optimizes APIs and services for autonomous agents. Each shift adds a new layer without replacing the previous one. This guide covers the evolution and what it means for agent-readiness measurement.

## Problem

GEO (Generative Engine Optimization) is the current frontier — making content discoverable by ChatGPT, Perplexity, Gemini, and other generative AI systems. But GEO still stops before the action. An AI agent that discovers your service still needs to answer:

- What can this API do? (capabilities)
- What are the constraints? (rate limits, auth, pricing)
- How do I call it? (interface, parameters)
- How do I authenticate? (OAuth, API key, scopes)
- Can I trust the claims? (evidence, verification)

SEO solved discovery for humans. GEO solves understanding for generative AI. Agent Readiness solves **actionability** for autonomous agents — the full path from discovery to execution.

## AgentBadge Relevance

AgentBadge is the **measurement layer** for the third era. It answers: "Here is what an agent can discover, what it can understand, and what evidence we found."

```
SEO (discovery for search) → GEO (understanding for generative AI) → Agent Readiness (actionability for agents)
```

AgentBadge measures the third layer with deterministic checks — not AI opinions, but observable facts backed by HTTP evidence. Each check produces proof: response headers, body fragments, status codes.

## Key Concepts

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — The third optimization layer: actionability for autonomous agents
- [Scoring Engine](/agent-guide/concepts/scoring) — Binary rules with evidence, not subjective scoring
- [GEO Optimization](/agent-guide/capabilities/geo-optimization) — Making content discoverable by generative AI systems
- [Trust Badge](/agent-guide/concepts/badge) — Evidence-based trust signal, not certification

## The Three Eras of Optimization

| Era | Object | Consumer | Question | Mechanisms |
|---|---|---|---|---|
| **SEO** | Website | Search engine | "Can Google find and rank my page?" | Keywords, backlinks, meta tags, sitemaps |
| **GEO** | Content | Generative AI | "Can ChatGPT cite my content?" | llms.txt, structured data, citations, AI Overviews |
| **Agent Readiness** | API/Service | Autonomous agent | "Can an agent discover, understand, and USE my API?" | OpenAPI, MCP, ai-sitemap, agent-card, evidence |

Each era adds a layer. SEO is still needed. GEO is now needed. Agent Readiness is the next layer — and it's the one that enables actual transactions, not just information retrieval.

## Why GEO Is Not Enough

GEO ensures an AI can **understand** your service. Agent Readiness ensures an agent can **act on** your service.

```
GEO:    "AgentBadge measures API discoverability for AI agents"  ← understanding
Agent:  curl https://agentbadge.xyz/.well-known/agent-card.json  ← action
```

An agent needs more than understanding. It needs:
1. **Capabilities** — What can this API do? (machine-readable)
2. **Constraints** — Rate limits, auth requirements, pricing
3. **Interfaces** — How to call it (OpenAPI, MCP)
4. **Auth** — How to authenticate (OAuth, API key, scopes)
5. **Evidence** — Can I verify the claims? (HTTP proof, not marketing)

## The Evidence-First Approach

AgentBadge doesn't ask "is this API agent-ready?" as a subjective question. It runs deterministic checks:

```
Check: Does /.well-known/agent-card.json exist?
  → HTTP 200, valid JSON, required fields present
  → Evidence: response body, headers, status code

Check: Does /llms.txt exist?
  → HTTP 200, text/plain, contains API description
  → Evidence: response body

Check: Does /ai-sitemap.xml exist?
  → HTTP 200, valid XML, contains resource map
  → Evidence: response body
```

Each check is binary: pass or fail. Each pass has evidence. Each fail has a fix recommendation. This is the difference between "AI opinion" and "measurement."

## Capabilities

- [Passive Scanner](/agent-guide/capabilities/scanner) — 72 checks across 15 categories, non-intrusive HTTP scanning
- [CLI Tool](/agent-guide/capabilities/cli) — Local scanning via `npx @agentbadge/cli scan`
- [Agent Knowledge Layer](/agent-guide/) — Machine-readable product context
- [GEO Optimization](/agent-guide/capabilities/geo-optimization) — Content optimization for generative AI discovery

## CLI Commands

```bash
# Scan an API for agent readiness
npx @agentbadge/cli scan https://api.example.com

# Scan with JSON output for programmatic use
npx @agentbadge/cli scan https://api.example.com --format json > report.json

# Scan with verbose evidence output
npx @agentbadge/cli scan https://api.example.com --verbose
```

## API Endpoints

- `GET /agent-guide/` — Agent Knowledge Layer index
- `GET /agent-guide/knowledge-map.json` — Structured graph of concepts and capabilities
- `GET /agent-guide/concepts/agent-readiness` — Agent Readiness concept
- `GET /agent-guide/concepts/scoring` — Scoring engine concept
- `GET /agent-guide/capabilities/geo-optimization` — GEO optimization capability
- `GET /agent-guide/articles/what-is-agent-readiness` — Article 1: foundation
- `GET /agent-guide/articles/seo-vs-agent-readiness` — Article 2: SEO vs Agent Readiness
- `GET /agent-guide/articles/web-becoming-agentic-api-discovery` — Article 3: agentic web discovery
- `GET /llms.txt` — LLM entry point
- `GET /ai-sitemap.xml` — Machine-readable resource map

## Recommended Actions

1. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — Foundation: what Agent Readiness is
2. [Read Article 2](/agent-guide/articles/seo-vs-agent-readiness) — Why SEO isn't enough
3. [Read Article 3](/agent-guide/articles/web-becoming-agentic-api-discovery) — The agentic web discovery stack
4. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
5. Run a scan — `npx @agentbadge/cli scan https://your-api.com`
6. Review evidence — every finding links to the HTTP response that produced it
7. Fix gaps — add `llms.txt`, publish `ai-sitemap.xml`, expose `agent-card.json`
8. Monitor — re-scan after changes to track improvements

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `geo-optimization` (capability), `scoring` (concept), `badge` (concept), `scanner` (capability), `cli` (capability), `seo-geo-agent-readiness` (article)
- **Edges**:
  - `seo-geo-agent-readiness` → builds on → `agent-readiness`
  - `seo-geo-agent-readiness` → extends → `seo-vs-agent-readiness`
  - `seo-geo-agent-readiness` → extends → `web-becoming-agentic-api-discovery`
  - `geo-optimization` → feeds into → `agent-readiness`
  - `agent-readiness` → measured by → `scanner`
  - `scanner` → feeds into → `scoring`
  - `scoring` → produces → `badge`
  - `cli` → invokes → `scanner`

## Full Article

> **For AI agents:** See the [Agent Knowledge Layer](/agent-guide/) for machine-readable product capabilities, scanning instructions, and API access.

### SEO: Discovery for Search Engines

SEO optimized websites for Google. The question: "Can a search engine find, crawl, and rank my page?" The mechanisms: keywords, backlinks, meta tags, sitemaps, structured data.

SEO is still necessary. But it serves a human consumer who reads pages and makes decisions.

### GEO: Understanding for Generative AI

GEO (Generative Engine Optimization) emerged as ChatGPT, Perplexity, and Gemini became primary information sources. The question: "Can a generative AI cite my content?" The mechanisms: `llms.txt`, structured data, citations, AI Overviews optimization.

GEO adds a layer: making content understandable by AI systems. But it still stops at information retrieval — the AI understands, but cannot act.

### Agent Readiness: Actionability for Autonomous Agents

Agent Readiness is the third layer. The question: "Can an autonomous agent discover, understand, and USE my API?" The mechanisms: OpenAPI, MCP, `ai-sitemap.xml`, `agent-card.json`, machine-readable pricing, evidence-based verification.

```
SEO    → "Can Google find my page?"        → human reads → human decides
GEO    → "Can ChatGPT cite my content?"    → AI understands → human decides
Agent  → "Can an agent USE my API?"        → agent discovers → agent understands → agent acts
```

### What an Agent Needs (Beyond GEO)

An agent receiving "find an API for payments and execute a transaction" needs:

1. **Discovery** — `ai-sitemap.xml`, `llms.txt`, `agent-card.json`
2. **Understanding** — OpenAPI spec, MCP tools, machine-readable capabilities
3. **Constraints** — Rate limits, pricing (x402), auth requirements
4. **Auth** — OAuth discovery, API key instructions, scopes
5. **Evidence** — Proof that claims are true (HTTP responses, not marketing copy)

GEO covers #1 and partially #2. Agent Readiness covers all five.

### AgentBadge: Measurement, Not Opinion

AgentBadge measures each layer with deterministic checks:

- 72 checks across 15 categories
- Each check: binary pass/fail
- Each pass: HTTP evidence (response body, headers, status)
- Each fail: specific fix recommendation
- Scoring: percentage of passed checks
- Badge: visual trust signal based on score

This is not "AI thinks your API is good." This is "your API has `/.well-known/agent-card.json` returning valid JSON with required fields — here is the proof."

### The Stack: Cumulative, Not Replacement

```
SEO (still needed)
 + GEO (now needed)
  + Agent Readiness (next layer)
   = Full optimization for the agentic web
```

You don't drop SEO when you add GEO. You don't drop GEO when you add Agent Readiness. Each layer serves a different consumer at a different stage of the pipeline.

### Call to Action

Your content may be discoverable by generative AI. The question is whether an autonomous agent can discover, understand, and act on your API.

**Scan your API →**

1. [Read the context](/agent-guide/context) — Understand what AgentBadge does
2. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — What is Agent Readiness?
3. [Read Article 2](/agent-guide/articles/seo-vs-agent-readiness) — SEO vs Agent Readiness
4. [Read Article 3](/agent-guide/articles/web-becoming-agentic-api-discovery) — The agentic web
5. Run a scan — `npx @agentbadge/cli scan https://your-api.com`

---

*This article is part of the AgentBadge Content Marketing Wave 2, Block A. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
