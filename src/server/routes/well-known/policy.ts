import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { didAuthSectionCompact } from "../../lib/did-auth-docs";

export const policyRoutes = new Hono();

// ─── LLM Policy (Epic 20) ──────────────────────────────────────

function loadLlmPolicy(): object {
  const candidates = [
    resolve(process.cwd(), "public/.well-known/llm-policy.json"),
    resolve(process.cwd(), "../public/.well-known/llm-policy.json"),
  ];
  for (const p of candidates) {
    if (existsSync(p)) {
      try {
        return JSON.parse(readFileSync(p, "utf-8"));
      } catch {
        // fallthrough to default
      }
    }
  }
  return {
    policy: "AgentBadge LLM Crawler Policy",
    version: "1.0",
    summary: "Default policy. See repository for the canonical version.",
  };
}

policyRoutes.get(
  "/.well-known/llm-policy.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "LLM crawler policy",
    description:
      "Returns a JSON document specifying how LLM providers and crawlers may use AgentBadge content. Covers pre-training, fine-tuning, RAG indexing, summarization, quotation, and agentic actions.",
    responses: { 200: { description: "LLM policy JSON" } },
  }),
  (c) =>
    c.json(loadLlmPolicy(), 200, {
      "Cache-Control": "public, max-age=86400",
    }),
);

// ─── ai.txt (SLICE-45-3) ──────────────────────────────────────

policyRoutes.get(
  "/ai.txt",
  describeRoute({
    tags: ["Discovery"],
    summary: "ai.txt — AI agent usage policy",
    description:
      "Returns ai.txt with User-agent and Allow/Disallow directives for AI agents.",
    responses: {
      200: {
        description: "ai.txt",
        content: { "text/plain": {} },
      },
    },
  }),
  () => {
    const body = `# ai.txt — AI Agent Usage Policy
# https://agentbadge.xyz

User-agent: *
Allow: /
Disallow: /api/admin/
Disallow: /api/work-requests/

# AI agents are welcome to:
# - Read public documentation
# - Access agent-guide endpoints
# - Use the scanner CLI
# - Submit work requests via API

# AI agents must not:
# - Attempt to access admin endpoints
# - Submit spam or abusive requests
# - Ignore rate limits
`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
);

// ─── agents.txt (SLICE-47-12) ─────────────────────────────────

policyRoutes.get(
  "/agents.txt",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent access policy",
    description: "Human-readable policy for AI agents accessing this site.",
    responses: {
      200: { description: "Agent policy text", content: { "text/plain": {} } },
    },
  }),
  () => {
    const policy = `# AgentBadge — Agent Access Policy

AI agents are welcome to access this site.
- Rate limit: 60 requests/minute per IP
- Paid endpoints require x402 payment (see /.well-known/x402.json)
- MCP endpoint: /mcp
- LLM context: /llms.txt and /llms-full.txt
- Agent card: /.well-known/agent-card.json
- OpenAPI spec: /openapi.json
- Sitemap: /ai-sitemap.xml
- Respect robots.txt and crawl-delay directives

## Authentication

Read endpoints are free — no authentication required.

Mutation endpoints (POST /market/*, POST /a2a/*) require a DID signature. Use the challenge endpoint at GET /auth/challenge to get a canonical challenge string, sign it with your Hedera account key, and send the signature in the X-AgentBadge-Signature header. See llms.txt for full details.

${didAuthSectionCompact()}

## Agency Profile

AgentBadge is an agency for the agentic web. We help businesses become agent-ready
through audit, identity, and marketplace services on Hedera.

- Team overview: /agent-guide/team
- Capabilities: /agent-guide/team/capabilities
- Capabilities (JSON): /agent-guide/team/capabilities.json
- Services: /agent-guide/team/services
- Availability: /agent-guide/team/availability
- Matching criteria: /agent-guide/team/match

## Capabilities

- Agent Readiness Scanner — audit APIs/websites against 72+ agent readiness rules
- On-Chain Agent Passports — NFT-based agent identity on Hedera Token Service
- Agent Marketplace — peer-to-peer task marketplace with x402 HBAR payments
- MCP Server Development — custom MCP server implementation
- Hedera Blockchain Integration — smart contract and dApp development
- AI Agent Architecture — consulting and system design

## Contacts

- Contact form: /contact
- Work requests: POST /api/work-requests
- Demand registry: POST /api/demand/request
- Security contact: /.well-known/security.txt
`;
    return new Response(policy, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
