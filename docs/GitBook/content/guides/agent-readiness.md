# Agent Readiness

Agent readiness is a measure of how well a website or service is prepared for interaction with AI agents. It evaluates compliance with emerging standards for agent discovery, authentication, payment, and communication.

## What is Checked?

The scanner evaluates 70+ checks across 17 categories:

1. **Discovery** — robots.txt, agents.txt, llms.txt, sitemap, well-known URIs
2. **Authentication** — OAuth discovery, HTTP Message Signatures, agent auth
3. **Payment** — x402, L402, Bazaar, payment headers
4. **Communication** — A2A, MCP, WebMCP, HCS messaging
5. **Identity** — DID, agent cards, passports
6. **Infrastructure** — DNS-AID, DNSSEC, TLS, headers
7. **Content** — Content negotiation, structured data, meta tags

## Scoring

- **0-59:** Not agent-ready (red badge)
- **60-79:** Partially ready (yellow badge)
- **80-89:** Mostly ready (blue badge)
- **90-100:** Fully agent-ready (green badge)

## How to Improve Your Score

1. Run a scan: `bun run cli -- scan https://your-site.com`
2. Review the report for failing checks
3. Follow the fix hints for each failed check
4. Re-scan to verify improvements

{% hint style="info" %}
See the [Scanner Usage](scanner-usage.md) guide for detailed CLI commands and output formats.
{% endhint %}
