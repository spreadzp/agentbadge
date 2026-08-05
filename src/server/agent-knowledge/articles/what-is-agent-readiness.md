# What Is Agent Readiness?

> **For AI agents:** See the [Agent Knowledge Layer](/agent-guide/) for machine-readable product capabilities, scanning instructions, and API access.

## The Problem: AI Agents Can't Use Your API

Your API might be technically excellent — fast, reliable, well-documented for humans. But when an AI agent tries to use it, the agent hits a wall.

The agent doesn't know your API exists. It can't find your documentation. It doesn't understand your authentication flow. It can't parse your error messages. And no amount of LLM intelligence can fix these problems — because they're not intelligence problems. They're **infrastructure problems**.

This is the gap AgentBadge addresses.

## What Is Agent Readiness?

**Agent Readiness** is the degree to which an API or service can be discovered, understood, and used by AI agents **without human intervention**.

Think of it as **SEO for AI agents**. Just as SEO made websites discoverable by search engines, Agent Readiness makes APIs discoverable by AI agents.

The analogy is precise:

| SEO | Agent Readiness |
|-----|-----------------|
| Search engines find your website | AI agents find your API |
| `robots.txt` tells crawlers what to index | `llms.txt` tells agents what your API does |
| Sitemap helps Google discover pages | Agent card helps agents discover capabilities |
| Meta tags describe page content | OpenAPI spec describes API endpoints |
| Page speed affects ranking | Machine-readability affects agent usability |
| Search ranking = visibility | Agent Readiness score = usability |

## How It's Measured

AgentBadge measures Agent Readiness using a **passive scanner** — a tool that sends HTTP requests to your public endpoints, exactly like an AI agent would.

The scanner is **non-intrusive**:

- No code changes required
- No SDK to install
- No agent to deploy
- No access to private endpoints

It checks four dimensions:

1. **Discovery** — Can agents find your API? (`llms.txt`, sitemap, well-known endpoints)
2. **Documentation** — Can agents understand your API? (OpenAPI spec, structured docs)
3. **Authentication** — Can agents authenticate? (clear auth flow, API keys)
4. **Machine-readability** — Is your API response machine-parseable? (JSON, structured errors)

Each check is a **binary rule** with evidence — no subjective scoring, no opinions. The same URL + same ruleset version always produces the same score.

Learn more: [Scoring Engine](/agent-guide/concepts/scoring) · [Passive Scanner](/agent-guide/capabilities/scanner)

## What the Badge Means

The AgentBadge trust badge displays your Agent Readiness score. It is:

- **A trust signal**, not a certification — we measure, we don't certify
- **Transparent** — the ruleset is open, anyone can see how scoring works
- **Evidence-based** — every finding links to the HTTP response that produced it
- **Dynamic** — re-scan after changes to update your score

The distinction between measurement and certification matters. We don't say "your API is safe and approved." We say "your API has `llms.txt`, an OpenAPI spec, and structured error responses — here's the evidence."

Learn more: [Trust Badge](/agent-guide/concepts/badge)

## How to Check Your API

You can check your API's Agent Readiness in three ways:

### Web UI

Go to the AgentBadge dashboard and enter your API URL. Get a full report with scores, findings, and recommendations.

### CLI

```bash
npx @agentbadge/cli scan https://api.example.com
```

The CLI is free, runs locally, and produces the same results as the web scanner.

### GitHub Action

```yaml
- uses: agentbadge/scan-action@v1
  with:
    api-url: https://api.example.com
```

Integrate scanning into your CI/CD pipeline to catch regressions before deployment.

Learn more: [CLI Tool](/agent-guide/capabilities/cli)

## Call to Action

AI agents are becoming a major consumer of APIs. If your API isn't agent-ready, you're invisible to an entire category of users.

**Run a scan today.** Get your score. Fix the gaps. Display your badge.

1. [Read the context](/agent-guide/context) — Understand what AgentBadge does
2. [Follow the learning path](/agent-guide/learn) — Step-by-step guide
3. [Check the knowledge map](/agent-guide/knowledge-map.json) — See how concepts connect
4. Run a scan — Web, CLI, or GitHub Action

---

*This article is part of the AgentBadge Content Marketing Wave 1. For AI agents, the [Agent Knowledge Layer](/agent-guide/) provides machine-readable access to all concepts, capabilities, and articles.*
