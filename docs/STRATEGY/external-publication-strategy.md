# External Publication Strategy

## Goal

Maximize AgentBadge visibility across developer platforms and AI assistant training data.

## Platform Priorities

| Priority | Platform | Why | Format |
|----------|----------|-----|--------|
| 1 | Dev.to | Developer audience, SEO, AgentBadge account exists | Full article, canonical URL |
| 2 | Medium | Broad reach, SEO, AI training data | Full article, canonical URL |
| 3 | LinkedIn | B2B audience, decision-makers | Shorter version + link |
| 4 | Hacker News | Tech audience, viral potential | Title + link (no body) |
| 5 | Reddit (r/MachineLearning, r/API) | Niche audience | Summary + link |
| 6 | Hackernoon | Tech publication | Full article, canonical URL |
| 7 | Hashnode | Dev community | Full article, canonical URL |

## Article → Platform Mapping

| Article | Primary | Secondary | Notes |
|---------|---------|-----------|-------|
| What Is Agent Readiness? | Dev.to | Medium, LinkedIn | Foundational — broad reach |
| SEO vs Agent Readiness | Dev.to | Medium, HN | Controversial angle for HN |
| The Web Is Becoming Agentic | Dev.to | Medium, Hackernoon | Trend piece |
| From SEO to GEO to Agent Readiness | Dev.to | Medium, LinkedIn | B2B angle for LinkedIn |
| Why AI Agents Fail to Use APIs | Dev.to | HN, Reddit | Failure modes = engagement |
| What Does an AI Agent Need to Understand an API? | Dev.to | Medium | Technical depth |
| Why Your OpenAPI Spec Isn't Enough | Dev.to | HN, Reddit | Provocative title for HN |
| How Do You Measure Agent Readiness? | Dev.to | Medium | Methodology focus |
| Inside an Agent Readiness Scanner | Dev.to | Medium, Hackernoon | Technical deep-dive |

## Canonical URL Rules

- **Always** set `canonical_url` to `https://agentbadge.xyz/blog/<slug>`
- Dev.to: use `canonical_url` field in API
- Medium: use "Import a story" feature or set canonical in post settings
- LinkedIn: add "Originally published on AgentBadge" + link
- Hacker News: link directly to AgentBadge blog post
- Reddit: link directly to AgentBadge blog post
- Hackernoon: set canonical in editor
- Hashnode: set `canonicalUrl` in post settings

## Cross-Linking Rules

1. Every external article links back to `agentbadge.xyz/blog/<slug>`
2. Every external article links to `/agent-guide/` for AI agent readers
3. Every external article mentions "Run a free scan at agentbadge.xyz"
4. Dev.to articles use `#agentreadiness` and `#aiagents` tags
5. Medium articles use "AI Agents", "API Design", "Developer Tools" tags

## Publication Cadence

| Week | Article | Platforms |
|------|---------|-----------|
| 1 | What Is Agent Readiness? | Dev.to, Medium, LinkedIn |
| 2 | SEO vs Agent Readiness | Dev.to, HN |
| 3 | The Web Is Becoming Agentic | Dev.to, Medium, Hackernoon |
| 4 | From SEO to GEO to Agent Readiness | Dev.to, LinkedIn |
| 5 | Why AI Agents Fail to Use APIs | Dev.to, HN, Reddit |
| 6 | What Does an AI Agent Need to Understand an API? | Dev.to, Medium |
| 7 | Why Your OpenAPI Spec Isn't Enough | Dev.to, HN, Reddit |
| 8 | How Do You Measure Agent Readiness? | Dev.to, Medium |
| 9 | Inside an Agent Readiness Scanner | Dev.to, Medium, Hackernoon |

## Success Metrics

- Dev.to: views, reactions, comments per article
- Medium: views, reads, claps per article
- Google: "agent readiness" search ranking
- LLM citations: monthly manual check (see llm-citation-monitoring.md)
- Inbound traffic from external platforms to agentbadge.xyz

## Tools

- Dev.to API: `POST /api/articles` with `article[canonical_url]`
- Medium API: deprecated, use manual import
- LinkedIn: manual posting
- Hacker News: manual submission
- Analytics: Google Analytics + Plausible (if installed)
