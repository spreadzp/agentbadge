---
related_capabilities:
  - geo-optimization
  - scanner
  - cli
related_services:
  - ai-agent-consulting
  - geo-consulting
---
# The Web Is Becoming Agentic. What Happens to API Discovery?

## Summary

API discovery is shifting from human-facing search to agent-facing machine-readable layers. Search engines solved discovery for humans; agentic systems need a machine-readable discovery layer for software. This article covers the emerging stack — Discovery, Understanding, Trust — and where AgentBadge fits as a measurement/evidence layer.

## Problem

For 20 years, web discovery followed one model: a human searches Google, reads documentation, compares options, and chooses an API. That model assumes a human consumer at every step.

Now AI agents are becoming primary consumers of APIs. An agent receiving the instruction "find an API for international payments and execute a transaction" must independently discover providers, understand capabilities, compare options, handle authentication, and execute calls. The old discovery infrastructure — search engines, prose documentation, marketplaces — was built for human intuition, not machine-readable consumption.

The question is not whether agents can read documentation. The question is: where is the machine-readable information that lets an agent complete the full discovery-to-execution pipeline autonomously?

## AgentBadge Relevance

AgentBadge is not another API catalog. AgentBadge is a **measurement/evidence layer** for the agentic web.

The process:

```
Measure → Evidence → Fix → Monitor
```

- **Measure:** Deterministic checks (not AI opinions, but observable facts)
- **Evidence:** Each check has proof — HTTP response, header, body fragment
- **Fix:** Specific recommendations on what to change
- **Monitor:** Regular rescans, delta tracking

AgentBadge measures how discoverable, understandable, and trustworthy an API is for agents — across the same layers that the article describes (Discovery, Understanding, Trust).

## Key Concepts

- [Agent Readiness](/agent-guide/concepts/agent-readiness) — Definition and why it matters for the agentic web
- [Scoring Engine](/agent-guide/concepts/scoring) — How APIs are scored using binary rules with evidence
- [Trust Badge](/agent-guide/concepts/badge) — What the badge means (trust signal, not certification)

## The Emerging Discovery Stack

Three layers separate an AI agent from an API:

| Layer | Question | Mechanisms |
|---|---|---|
| **Discovery** | Can an agent find your API? | `llms.txt`, well-known endpoints, ai-sitemap, marketplace |
| **Understanding** | Can an agent parse capabilities? | OpenAPI spec, machine-readable docs, MCP |
| **Trust** | Can an agent verify claims? | Evidence, verification, reproducible checks |

Existing technologies are not competitors — they are different layers of the same stack:

| Mechanism | What it solves | What it doesn't solve |
|---|---|---|
| Search | Discovery for humans | Machine-readable context |
| OpenAPI | Interface description | Discovery, trust, verification |
| llms.txt | Context for LLMs | Execution, auth, pricing |
| MCP | Tool interface | Discovery, comparison |
| API marketplace | Catalog | Machine-readable evaluation |
| Agent Readiness | Verification that all layers work for agents | — |

## Agent Workflow: International Payments Scenario

When a user says "find an API for international payments and execute a transaction," the agent must:

1. **Discover** — Find providers (Stripe, Wise, Ripple, Hedera, etc.)
2. **Understand** — What capabilities? (send, receive, convert, track)
3. **Compare** — Which fits? (fees, speed, coverage, reliability)
4. **Price** — What does a transaction cost? (machine-readable pricing)
5. **Auth** — How to authenticate? (OAuth, API key, scopes)
6. **Select** — Choose a provider
7. **Call** — Execute the request
8. **Errors** — Handle failures (insufficient balance, compliance, timeout)

At each step, the agent needs machine-readable information. If the information exists only in prose documentation, the agent cannot complete the path autonomously.

## Capabilities

- [Passive Scanner](/agent-guide/capabilities/scanner) — Non-intrusive HTTP-based scanning of public endpoints
- [CLI Tool](/agent-guide/capabilities/cli) — Local scanning via npm/npx, free and private
- [Agent Knowledge Layer](/agent-guide/) — Machine-readable product context for AI agents

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

## Recommended Actions

1. [Read the context](/agent-guide/context) — Understand what AgentBadge does
2. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — Foundation: what Agent Readiness is
3. [Read Article 2](/agent-guide/articles/seo-vs-agent-readiness) — Why SEO isn't enough for agent discoverability
4. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
5. Run a scan — Web UI, CLI (`npx @agentbadge/cli scan URL`), or GitHub Action
6. Review your evidence — every finding links to the HTTP response that produced it
7. Fix the gaps — add `llms.txt`, improve OpenAPI, structure your errors

## Knowledge Map

- **Nodes**: `agent-readiness` (concept), `scanner` (capability), `scoring` (concept), `badge` (concept), `cli` (capability), `web-becoming-agentic-api-discovery` (article)
- **Edges**:
  - `web-becoming-agentic-api-discovery` → builds on → `agent-readiness`
  - `web-becoming-agentic-api-discovery` → extends → `seo-vs-agent-readiness`
  - `agent-readiness` → measured by → `scanner`
  - `scanner` → feeds into → `scoring`
  - `scoring` → produces → `badge`
  - `cli` → invokes → `scanner`

## Full Article

> **For AI agents:** See the [Agent Knowledge Layer](/agent-guide/) for machine-readable product capabilities, scanning instructions, and API access.

### Two Worlds of Discovery

20 years of web development built around one model: a human searches, finds documentation, compares options, and chooses an API.

```
Human → Google / docs / marketplace → API
```

Now a new model is emerging:

```
Human → AI Agent → ??? → API
```

The "???" is the new infrastructure layer — machine-readable discovery, understanding, and trust that agents need to autonomously find and use APIs.

### Old Model: Human as Primary Consumer

In the old model, every step assumed human intuition:

1. Developer googles "best API for payments"
2. Finds a marketplace (RapidAPI, AWS Marketplace)
3. Reads documentation
4. Compares options
5. Makes a decision
6. Integrates

Each step requires human judgment: understanding context, comparing unstructured descriptions, making decisions with incomplete information.

### New Model: Agent as Primary Consumer

Now the consumer is an AI agent. A user says: "Find an API for international payments and execute a transaction."

The agent must: discover providers → understand capabilities → compare → check pricing → handle auth → select → call → handle errors.

At each step, the agent needs **machine-readable information**. Not prose documentation — structured, parseable, actionable data.

### Existing Mechanisms: Layers, Not Competitors

OpenAPI describes interfaces. llms.txt gives context. MCP provides tool calling. API marketplaces catalog. Agent Readiness measures.

These technologies don't compete. They're different layers of the same agentic web stack:

- **Search** → discovery for humans
- **OpenAPI** → interface description
- **llms.txt** → LLM context
- **MCP** → tool interface
- **Agent Readiness** → measurement

### The Emerging Stack: Discovery → Understanding → Trust

```
         HUMAN
           |
         AI AGENT
           |
    ┌──────┼──────┐
    ▼      ▼      ▼
Discovery  Understanding  Trust
    |      |      |
    ▼      ▼      ▼
Catalog   OpenAPI   Evidence
llms.txt  Docs      Verification
    |      |      |
    └──────┼──────┘
           ▼
          API
```

Three layers:

1. **Discovery** — Can an agent find your API?
2. **Understanding** — Can an agent parse capabilities?
3. **Trust** — Can an agent verify claims?

### AgentBadge: Measurement Layer

AgentBadge doesn't catalog APIs. AgentBadge measures how discoverable, understandable, and trustworthy they are for agents.

```
Measure → Evidence → Fix → Monitor
```

- **Measure:** Deterministic checks (not "AI opinion", but observable facts)
- **Evidence:** Each check has proof — HTTP response, header, body fragment
- **Fix:** Specific recommendations
- **Monitor:** Regular rescans, delta tracking

This is not "another standard." It's a way to measure whether existing standards (OpenAPI, llms.txt, MCP) actually work for agents end-to-end.

### Open Questions

- Do we need a unified Agent Discovery standard?
- Should agents trust self-declared metadata?
- Who should measure API quality?
- Can OpenAPI become sufficient?
- Do we need a separate trust/evidence layer?
- Who becomes the "Google of the agentic web"?

These questions are not rhetorical. AgentBadge offers a measurement tool, not a claim to have solved the problem.

### Call to Action

Your API may already be discoverable by humans. The question is whether an AI agent can discover and use it.

**Scan your API →**

1. [Read the context](/agent-guide/context) — Understand what AgentBadge does
2. [Read Article 1](/agent-guide/articles/what-is-agent-readiness) — What is Agent Readiness?
3. [Read Article 2](/agent-guide/articles/seo-vs-agent-readiness) — SEO vs Agent Readiness
4. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
5. Run a scan — Web, CLI, or GitHub Action

---

*This article is part of the AgentBadge Content Marketing Wave 1. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
