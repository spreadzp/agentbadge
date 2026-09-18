---
related_capabilities:
  - ai-agent-architecture
  - geo-optimization
related_services:
  - ai-agent-consulting
  - geo-consulting
---

# Scan Packs

Scan packs are scoped agent-readiness scans — pay only for the rule bundles you need instead of a full audit.

## How to Choose a Pack

| If you are... | Pack |
|---|---|
| Selling a paid API | `payments-x402` |
| Running an MCP / WebMCP server | `mcp-webmcp` |
| Checking discovery basics (robots, sitemap, llms.txt) | `discovery-crawling` |
| Publishing OpenAPI docs | `openapi-docs` |
| Implementing auth / DID / signatures | `auth-identity` |
| Optimizing SEO / meta / JSON-LD | `page-meta-seo` |
| Serving content-negotiated responses | `content-negotiation` |
| Building agent-facing UX / skills | `skills-agent-ux` |
| Defining semantic / usage policies | `semantic-policy` |
| Verifying live endpoints | `live-verification` |

## Price Classes

Bundles are priced by cost class — light, medium, heavy — reflecting fetch and evaluation cost. Fetch `GET /api/scan-packs` for the live catalog with current prices and rule counts; prices are not duplicated here.

## Full-Scan Discount

Omit `packs` on `POST /api/total-scan` to run all bundles at a discounted flat price — cheaper than buying every pack individually.

## Usage

```json
POST /api/total-scan
{ "url": "https://your-api.example.com", "packs": ["payments-x402", "live-verification"] }
```

Unknown ids return `400` with `validIds`. Legacy aliases (`safety`, `discovery`, `docs`, `payments`) resolve to canonical bundle ids.
