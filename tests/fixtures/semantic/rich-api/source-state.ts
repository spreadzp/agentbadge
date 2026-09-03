import type { SourceState } from "../../../../src/agent-readiness/scanner/source-state";
import type { ResponseSnapshot } from "../../../../src/agent-readiness/scanner/snapshot";

function snap(url: string, body: string | null, contentType = "application/json", status = 200): ResponseSnapshot {
  return {
    url,
    status,
    bodyHash: "abc123",
    bodySize: body?.length ?? 0,
    contentType,
    resolvedIp: "93.184.216.34",
    fetchedAt: "2025-01-15T00:00:00Z",
    fetchTimeMs: 100,
    redirectChain: [],
    body,
    headers: {},
  };
}

// ─── Rich API Fixture ("Stripe-lite") ─────────────────────────────
// Design goals:
//   - OpenAPI: operations with descriptions + examples (some bare)
//   - agent-guide: capabilities, partial pricing, sandbox mentioned
//   - llms.txt: prose pricing only (no machine-readable)
//   - agents.txt: present with AI-agent rules
//   - NO: rate limits, error schemas, retry semantics, versioning, securitySchemes
//
// Expected semantic outcomes:
//   AB-146 (operation descriptions): VERIFIED (some have descriptions)
//   AB-147 (parameter semantics): INFERRED (partial — some params lack descriptions)
//   AB-148 (examples): INFERRED (partial — some examples present)
//   AB-149 (error schemas): GAP (no 4xx/5xx responses declared)
//   AB-150 (pricing discoverability): INFERRED (partial — pricing in guide but not machine-readable)
//   AB-151 (rate limits): GAP (no rate limits anywhere)
//   AB-152 (pricing consistency): VERIFIED (only one source declares pricing)
//   AB-153 (authentication clarity): GAP (no securitySchemes in OpenAPI)
//   AB-154 (retry semantics): GAP (no Idempotency-Key or Retry-After)
//   AB-155 (versioning): GAP (no info.version or deprecation policy)
//   AB-156 (sandbox): VERIFIED (sandbox in guide)
//   AB-157 (agent policy): VERIFIED (agents.txt has AI rules)
//   AB-158 (capability list): VERIFIED (capabilities array in guide)
//   AB-159 (business constraints): INFERRED (partial — some constraints mentioned)
//   AB-160 (support path): VERIFIED (support email in guide)

const openapiBody = JSON.stringify({
  openapi: "3.1.0",
  info: {
    title: "Example Payment API",
    version: "1.0.0",
    description: "A payment processing API for developers.",
  },
  servers: [
    { url: "https://api.example.com", description: "Production" },
  ],
  paths: {
    "/charges": {
      get: {
        summary: "List all charges",
        description: "Retrieves a list of all charges with optional pagination.",
        parameters: [
          {
            name: "limit",
            in: "query",
            description: "Maximum number of charges to return (1-100).",
            required: false,
            schema: { type: "integer", minimum: 1, maximum: 100 },
          },
          {
            name: "cursor",
            in: "query",
            required: false,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "A list of charges",
            content: {
              "application/json": {
                example: { data: [{ id: "ch_123", amount: 5000, currency: "usd" }], has_more: false },
              },
            },
          },
        },
      },
      post: {
        summary: "Create a charge",
        description: "Creates a new charge for a customer.",
        requestBody: {
          content: {
            "application/json": {
              example: { amount: 5000, currency: "usd", customer_id: "cus_123" },
            },
          },
        },
        responses: {
          "200": {
            description: "Charge created successfully",
            content: {
              "application/json": {
                example: { id: "ch_123", amount: 5000, currency: "usd", status: "succeeded" },
              },
            },
          },
        },
      },
    },
    "/charges/{id}": {
      get: {
        summary: "Retrieve a charge",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Charge details",
          },
        },
      },
      post: {
        summary: "Refund a charge",
        description: "Refunds a charge partially or fully.",
        parameters: [
          {
            name: "id",
            in: "path",
            required: true,
            schema: { type: "string" },
          },
        ],
        responses: {
          "200": {
            description: "Refund processed",
          },
        },
      },
    },
    "/customers": {
      get: {
        summary: "List customers",
        responses: {
          "200": {
            description: "List of customers",
          },
        },
      },
    },
  },
});

const guideBody = JSON.stringify({
  name: "Example Payment API",
  description: "A payment processing API for developers.",
  sandbox: {
    url: "https://sandbox.example.com",
    description: "Test environment with no real charges.",
  },
  capabilities: [
    {
      name: "Create charge",
      description: "Creates a new charge for a customer.",
    },
    {
      name: "List charges",
      description: "Lists all charges with optional filters.",
    },
    {
      name: "Refund a charge",
      description: "Refunds a charge partially or fully.",
    },
    {
      name: "Manage customers",
      description: "Create, list, and update customer records.",
    },
  ],
  pricing: {
    model: "per_transaction",
    note: "2.9% + 30¢ per successful charge. See pricing page for details.",
  },
  support: {
    email: "support@example.com",
    url: "https://example.com/support",
  },
  constraints: {
    refunds: "Refunds can be issued within 180 days of the original charge.",
    cancellation: "Charges cannot be cancelled once they are captured.",
  },
});

const llmsBody = `# Example Payment API

> A payment processing API for developers.

## Overview

The Example Payment API allows you to create charges, manage customers, and process refunds.

## Pricing

We charge 2.9% + 30¢ per successful transaction. Volume discounts are available for high-volume merchants. Contact sales for custom pricing.

## Authentication

Use API keys passed via the Authorization header as a Bearer token.

## Support

Contact us at support@example.com or visit https://example.com/support
`;

const agentsBody = `# agents.txt — AI Agent Access Control
# https://agentbadge.xyz/agents-txt

User-agent: *
Allow: /
Disallow: /admin
Disallow: /internal

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

# AI agents may use this API for automated requests
# Rate limit: 100 requests per minute
`;

export const richApiSourceState: SourceState = {
  domain: "example.com",
  scannedAt: "2025-01-15T00:00:00Z",
  snapshots: {
    openapi: snap("https://api.example.com/openapi.json", openapiBody),
    guide: snap("https://example.com/.well-known/agent-guide.json", guideBody),
    llms: snap("https://example.com/llms.txt", llmsBody, "text/plain"),
    agents_txt: snap("https://example.com/agents.txt", agentsBody, "text/plain"),
    // Sources NOT present (will be null/missing):
    // pricing: null,  — no pricing.json endpoint
    // ai_txt: null,   — no ai.txt
    // security_txt: null — no security.txt
    // Other standard sources (present but minimal for non-semantic rules):
    robots: snap("https://example.com/robots.txt", "User-agent: *\nAllow: /", "text/plain"),
    sitemap: snap("https://example.com/sitemap.xml", '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://example.com/</loc></url></urlset>', "application/xml"),
    homepage_meta: snap("https://example.com/", '<html><head><title>Example API</title><meta name="description" content="Payment API"></head></html>', "text/html"),
    mcp: snap("https://example.com/.well-known/mcp.json", JSON.stringify({ name: "example-api", version: "1.0.0", tools: [] })),
    llms_full: snap("https://example.com/llms-full.txt", llmsBody, "text/plain"),
    skill: snap("https://example.com/.well-known/skill.md", "# Example API Skill\n\nA payment processing API.", "text/markdown"),
    agents: snap("https://example.com/agents.txt", agentsBody, "text/plain"),
    content_negotiation: snap("https://example.com/", "", "text/html"),
    mcp_probe: snap("https://example.com/.well-known/mcp.json", JSON.stringify({ name: "example-api", version: "1.0.0", tools: [] })),
    infrastructure: snap("https://example.com/.well-known/infrastructure.json", JSON.stringify({ status: "ok" })),
    a2a: snap("https://example.com/.well-known/a2a.json", JSON.stringify({ name: "example-api" })),
    identity: snap("https://example.com/.well-known/webfinger", JSON.stringify({ subject: "acct:api@example.com" })),
    bot_auth: snap("https://example.com/.well-known/bot-auth.json", JSON.stringify({ type: "bearer" })),
    x402: snap("https://example.com/.well-known/x402.json", JSON.stringify({ enabled: false })),
    webmcp: snap("https://example.com/.well-known/webmcp.json", JSON.stringify({ name: "example-api" })),
    og_meta: snap("https://example.com/", '<html><head><meta property="og:title" content="Example API"><meta property="og:description" content="Payment API"></head></html>', "text/html"),
    aeo_content: snap("https://example.com/", '<html><body>Example Payment API documentation</body></html>', "text/html"),
    semantic_html: snap("https://example.com/", '<html><body><main><article><h1>Example API</h1></article></main></body></html>', "text/html"),
    accessibility: snap("https://example.com/", '<html><body><main>Content</main></body></html>', "text/html"),
    content_depth: snap("https://example.com/", '<html><body><p>Detailed content about the API.</p></body></html>', "text/html"),
  } as Record<string, ResponseSnapshot | null>,
};

// ─── Critical variant: same as rich but NO auth declaration ────────
// The rich fixture already has no securitySchemes, so AB-153 is already GAP.
// For the critical floor test, we need a fixture where auth is completely
// undocumented (no mention in guide, no agents.txt auth, no llms.txt auth).
// We reuse richApiSourceState — AB-153 (auth clarity) is already GAP with critical severity.

export { snap };
