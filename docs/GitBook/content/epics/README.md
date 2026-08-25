# EPICs & Roadmap

AgentBadge is developed using an EPIC-driven approach. Each EPIC represents a major feature or initiative, broken down into implementable slices. Full EPIC documents live in [`docs/EPICS/`](https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS) in the repository.

## Current Status

The project has progressed through **86 EPICs** (0–86), with EPICs 79 and 80 currently in active development.

- **Scanner**: 104 rules across 16 categories, 41 HTTP fetchers
- **MCP**: 65 tools across 4 namespaces (passport, market, discovery, audit)
- **Payment rails**: x402 (HBAR), MPP, L402 (Lightning), Stripe

## Active Development

| EPIC | Title | Status |
|------|-------|--------|
| EPIC-79 | Article 7: Why Your OpenAPI Spec Isn't Enough for AI Agents | In Progress |
| EPIC-80 | SEO Metadata Consistency | In Progress |

## Recent EPICs (58–86)

| EPIC | Title | Summary |
|------|-------|---------|
| EPIC-58 | Scanner UI & Full Scan | Full scan UI page, parallel fetcher execution, scored report display |
| EPIC-61 | Comment Monitor | Dockerized Bun microservice for monitoring Dev.to comments and generating AI replies |
| EPIC-67 | Stripe Payment Integration | Stripe as additional payment rail alongside x402, MPP, L402 |
| EPIC-69 | AgentGrade CLI Gap Closure | CLI feature parity with agentgrade-cli, new fetchers, JSON output, badge generation |
| EPIC-72 | MCP Namespacing | MCP tools reorganized into 4 namespaces: passport, market, discovery, audit |
| EPIC-74 | Agent Discovery Verification | End-to-end verification of agent discovery flow, DID resolution checks |
| EPIC-75 | AgentGrade Rule Expansion | Ruleset expanded from 97 to 104 rules, new categories: seo_aeo, accessibility |
| EPIC-76 | Accessibility & Security Hardening | WCAG compliance checks, security header validation, SSRF prevention |
| EPIC-78 | MCP REST Parity Compliance | MCP tools exposed via REST API with matching schemas and responses |
| EPIC-79 | Article 7 — OpenAPI for AI Agents | Content marketing: article on why OpenAPI alone isn't sufficient for AI agent discovery |
| EPIC-80 | SEO Metadata Consistency | Consistent OG tags, Twitter cards, JSON-LD across all pages |
| EPIC-82 | Marketplace Auth | Authentication for marketplace task posting and claiming |
| EPIC-84 | Marketplace State Machine | Formal state machine for task lifecycle: posted → claimed → delivered → completed |
| EPIC-85 | Scanner SSRF Endpoint Hardening | SSRF protection for scanner endpoints, URL validation, allowlist |
| EPIC-86 | CI Rate Limiting Hardening | Rate limiting for CI endpoints, abuse prevention |

## Completed Phases

| Phase | EPICs | What Was Delivered |
|-------|-------|--------------------|
| Foundation | 0–27 | Passport core, agent directory, MCP server, UI, marketplace, npm packages, medical data processing, P2P payments |
| Scanner & Compliance | 28–39 | Agent readiness spec, passive scanner, rule engine, scoring, report integrity, CLI, badge service, GitHub Action |
| Growth & Brand | 40–53 | B2B data API, content marketing, landing redesign, scanner fixes, brand repositioning, SEO/AEO, GSC crawl fixes |
| Agent Services | 54–57 | Voice domain testnet, agent-facing services, GitBook MCP integration |
| Scanner UI & Content | 58–68 | Full scan UI, agent knowledge linking, blog publishing, comment monitor, articles 2–4, blog pagination, Stripe integration |
| CLI & Rules Expansion | 69–78 | CLI gap closure, articles 5–6, MCP namespacing, blog OG/AEO enrichment, agent discovery verification, rule expansion, accessibility/security hardening, MCP REST parity |

## Upcoming: Whitechain Integration

EPICs 87–91 are planned for Whitechain Builders Program grant implementation — deploying AgentBadge on Whitechain L2, integrating WhiteBIT MCP tools, and enabling WBT-based payments.

## How EPICs Work

Each EPIC is broken into **slices** — small, atomic units of work that can be implemented independently. Slices follow TDD methodology:

1. **Red Phase** — Write failing tests
2. **Green Phase** — Minimal implementation
3. **Refactor Phase** — Improve code quality

{% hint style="info" %}
Full EPIC documents live in `docs/EPICS/` in the repository. These pages are summaries for the knowledge base.
{% endhint %}
