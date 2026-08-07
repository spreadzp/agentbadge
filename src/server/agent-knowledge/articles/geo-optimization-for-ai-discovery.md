---
related_capabilities:
  - geo-optimization
related_services:
  - geo-consulting
---
# GEO Optimization for AI Discovery

## Summary

Generative Engine Optimization (GEO) is the practice of making your content and APIs discoverable by AI agents, not just human users. As AI agents become primary consumers of web services, GEO is as important as traditional SEO.

## What GEO Means

Traditional SEO targets search engine crawlers and human readers. GEO targets AI agents that:

- Read `llms.txt` for API discovery
- Parse `agent-card.json` for capability matching
- Use `ai-sitemap.xml` for resource enumeration
- Consume structured JSON over Markdown over HTML

## Key GEO Signals

### Machine-Readable Endpoints

- `/.well-known/agent-card.json` — Agent Card with capabilities, endpoints, payment config
- `/llms.txt` — Markdown API spec for LLMs
- `/ai-sitemap.xml` — XML resource discovery map
- `/agent-guide/` — Knowledge layer for agent onboarding

### Structured Data

- JSON-LD with `@type` for each page
- OpenAPI 3.1 spec at `/api/specs`
- Consistent error format: `{ error, code, retryable, hint }`

### Content Negotiation

- Serve `application/json` when `Accept: application/json`
- Serve `text/markdown` when `Accept: text/markdown`
- Fall back to HTML for browsers

## GEO vs SEO

| Aspect | SEO | GEO |
|--------|-----|-----|
| Audience | Search engines | AI agents |
| Format | HTML | JSON, Markdown |
| Discovery | Sitemap.xml | ai-sitemap.xml, llms.txt |
| Metadata | Meta tags | Agent Card, OpenAPI |
| Payment | Ads, subscriptions | x402 per-call |

## How We Can Help

The AgentBadge team helps make your service agent-discoverable — from `llms.txt` generation to Agent Card implementation and OpenAPI specs. See `/agent-guide/team/services` for details.
