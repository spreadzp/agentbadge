# AgentBadge — Context

## What Is AgentBadge?

AgentBadge is a platform that helps APIs become **Agent Ready** — discoverable, understandable, and usable by AI agents.

We believe the next wave of API consumption will come from AI agents, not just humans. AgentBadge bridges the gap between API providers and AI agents by providing:

1. **Passive scanning** — No code changes, no SDK to install
2. **Transparent scoring** — Open ruleset, same rules for everyone
3. **Evidence-based reports** — Every finding has HTTP evidence
4. **Trust badge** — Display your score, not a certification

## Two Products

### Agent Readiness (Primary)

Agent Readiness is the core product. It scans any API endpoint and scores it across multiple dimensions:

- **Discovery** — Can agents find your API? (`llms.txt`, sitemap, well-known endpoints)
- **Documentation** — Can agents understand your API? (OpenAPI spec, structured docs)
- **Authentication** — Can agents authenticate? (clear auth flow, API keys)
- **Machine-readability** — Is your API response machine-parseable? (JSON, structured errors)

The scanner is **passive and non-intrusive** — it sends HTTP requests to your public endpoints, just like an AI agent would. No code changes required, no SDK to install, no agent to deploy.

### Hedera Marketplace (Secondary, Case Study)

The Hedera Marketplace is a live implementation of agent-ready infrastructure on the Hedera blockchain. It demonstrates:

- On-chain agent identity (Passport NFTs, DIDs)
- P2P task marketplace (post, claim, deliver, complete)
- A2A messaging via Hedera Consensus Service
- Cryptographic agent signing

The marketplace serves as a **case study** for what agent-ready infrastructure looks like in practice.

## What Agent Readiness Means

Agent Readiness is the degree to which an API or service can be discovered, understood, and used by AI agents **without human intervention**.

It's like SEO, but for AI agents instead of search engines. Just as SEO made websites discoverable by search engines, Agent Readiness makes APIs discoverable by AI agents.

### Why It Matters

AI agents are becoming a major consumer of APIs. If your API isn't agent-ready:

- Agents can't **find** your API (no `llms.txt`, no sitemap)
- Agents can't **understand** your API (no OpenAPI, no structured docs)
- Agents can't **authenticate** (unclear auth flow)
- Agents can't **use** your API (unstructured responses, no error codes)

AgentBadge scores your API on all these dimensions and gives you a clear report with evidence.

## What the Scanner Does

The scanner sends HTTP requests to your API endpoints, exactly like an AI agent would:

1. **Fetches** your endpoints (GET requests)
2. **Checks** for `llms.txt`, `robots.txt`, `sitemap.xml`, `/.well-known/agent-card.json`
3. **Validates** OpenAPI spec if present
4. **Tests** authentication clarity
5. **Analyzes** response structure (JSON, error codes, HATEOAS links)
6. **Scores** each dimension with evidence

No code changes. No SDK. No agent deployment. Just point the scanner at your API URL.

## What the Badge Means

The AgentBadge trust badge displays your Agent Readiness score. It is:

- **A trust signal**, not a certification — we don't guarantee your API works
- **Transparent** — the ruleset is open, anyone can see how scoring works
- **Evidence-based** — every finding links to the HTTP response that produced it
- **Dynamic** — re-scan after changes to update your score

## Open Ruleset Principle

AgentBadge uses the **same rules for everyone**. The scoring ruleset is open and transparent:

- No special treatment for specific frameworks or platforms
- No subjective scoring — every rule is a binary check with evidence
- No pay-to-play — free tier available, same rules as paid

This ensures fairness and trust in the scoring system.

## Compliance Checking

AgentBadge provides a `check_compliance` MCP tool that lets AI agents scan any URL for isitagentready compliance. This tool runs the same agent readiness scanner that powers the AgentBadge platform.

### Using the `check_compliance` MCP Tool

Call the tool with a URL to scan:

```json
{
  "tool": "check_compliance",
  "arguments": {
    "url": "https://example.com"
  }
}
```

### Response Structure

The tool returns a JSON object with:

- `score` — Overall compliance score (0-100)
- `rules_checked` — Total number of rules evaluated
- `rules_passed` — Number of rules that passed
- `rules_failed` — Number of rules that failed
- `categories` — Breakdown by category (discovery, documentation, authentication, etc.)
- `findings` — Array of individual rule results with evidence

### Interpreting Results

- **80+** — Agent ready. The site passes most isitagentready checks.
- **60-79** — Partially ready. Some compliance gaps remain.
- **Below 60** — Not agent ready. Significant work needed.

### Compliance Endpoints

The following `/.well-known/` endpoints contribute to the compliance score:

| Endpoint | Format | Purpose |
|----------|--------|---------|
| `/.well-known/agent-card.json` | JSON | Server identity manifest |
| `/.well-known/api-catalog` | JSON | API Catalog (RFC 9727) |
| `/.well-known/oauth-protected-resource` | JSON | OAuth Protected Resource (RFC 9728) |
| `/.well-known/agent-skills/index.json` | JSON | Agent Skills discovery |
| `/.well-known/http-message-signatures-directory` | JSON | Web Bot Auth (HTTP Message Signatures) |
| `/auth.md` | Markdown | Agent authentication instructions |
| `/llms.txt` | Text | LLM-friendly API specification |
| `/ai-sitemap.xml` | XML | AI resource discovery map |

### Learn More

- **IsItAgentReady:** https://isitagentready.com
- **Full scanner docs:** `/agent-guide/context`
- **API specification:** `/api/specs`

