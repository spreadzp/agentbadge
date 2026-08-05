# Agent Readiness

Agent Readiness is the degree to which an API or service can be discovered, understood, and used by AI agents without human intervention.

## Why It Matters

AI agents are becoming a major consumer of APIs. If your API isn't agent-ready, agents can't find it, understand it, or use it effectively.

## How It's Measured

AgentBadge scans your API passively (no code changes) and scores it across multiple dimensions:

- **Discovery** — Can agents find your API? (llms.txt, sitemap, well-known endpoints)
- **Documentation** — Can agents understand your API? (OpenAPI, structured docs)
- **Authentication** — Can agents authenticate? (clear auth flow, API keys)
- **Machine-readability** — Is your API response machine-parseable? (JSON, structured errors)

## Related Concepts

- [Scoring Engine](/agent-guide/concepts/scoring) — How we calculate your score
- [Trust Badge](/agent-guide/concepts/badge) — Display your score
- [Open Ruleset](/agent-guide/concepts/ruleset) — Transparent rules
