## Explanation

SEO (Search Engine Optimization) and agent readiness are often confused because they share some practices, but they optimize for fundamentally different consumers. Understanding the distinction is critical for building APIs that serve both human searchers and AI agents.

**SEO** optimizes content for search engine crawlers — Googlebot, Bingbot, and others. The goal is to rank higher in search results so humans click through to your website. SEO focuses on HTML content: meta tags, structured data (JSON-LD), internal linking, page speed, mobile-friendliness, and keyword relevance. The audience is a crawler that indexes HTML and a human who clicks the link.

**Agent readiness** optimizes APIs and services for AI agents — autonomous programs that discover, understand, and execute API calls without human intervention. The goal is not ranking but executability. Agent readiness focuses on machine-readable documentation (OpenAPI, llms.txt), structured error responses, rate limit declarations, pricing transparency, and consistency between documentation and implementation. The audience is an agent that reads specs and makes HTTP requests.

**Shared practices** include structured data (JSON-LD for SEO, OpenAPI for agents), clear URL structures, sitemaps (XML sitemaps for SEO, llms.txt for agents), and consistent metadata. Both benefit from fast response times and reliable uptime.

**Key differences** are in audience, format, and goal:

| Dimension | SEO | Agent Readiness |
|-----------|-----|-----------------|
| Audience | Search crawlers + humans | AI agents |
| Format | HTML pages | API endpoints + specs |
| Goal | Ranking & click-through | Discovery & execution |
| Success metric | Organic traffic | Successful API calls |
| Content type | Editorial content | Machine-readable specs |
| Errors | 404 pages, soft errors | Structured error responses |

An API can have excellent SEO (rank #1 for "best payment API") but fail agent readiness (no OpenAPI spec, unstructured errors, no rate limits). Conversely, an API can be perfectly agent-ready but invisible in search results. Both are needed for different audiences.

## Example

**Same API optimized for SEO vs agent readiness:**

```json
// SEO approach — HTML page about the API
{
  "url": "https://api.example.com/",
  "html": "<title>Payment API — Fast & Reliable</title>",
  "json_ld": {
    "@type": "SoftwareApplication",
    "name": "Payment API",
    "offers": { "@type": "Offer", "price": "0" }
  }
}

// Agent readiness approach — machine-readable metadata
{
  "llms.txt": "https://api.example.com/llms.txt",
  "openapi": "https://api.example.com/openapi.json",
  "agent_guide": "https://api.example.com/agent-guide.md",
  "error_format": "application/problem+json",
  "rate_limits": "X-RateLimit-* headers"
}
```

Both are valid optimizations — they just serve different consumers.
