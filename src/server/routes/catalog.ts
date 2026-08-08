/**
 * Catalog route — GET /catalog, GET /llms.txt, GET /pricing.json
 *
 * Reference: hackathon-flow.md:120 (§5), hedera-tech-reference.md:738-784 (§7.3)
 * SLICE-44-5: GET /pricing.json — machine-readable pricing for AI agents
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { getCatalog, getLlmsTxt } from "@agentgate-hedera/hedera-core";
import { catalogTierSchema } from "../openapi";
import z from "zod";

export const catalogRoutes = new Hono();

catalogRoutes.get(
  "/catalog",
  describeRoute({
    tags: ["Catalog"],
    summary: "Get tier pricing and capabilities",
    responses: {
      200: {
        description: "Catalog retrieved",
        content: {
          "application/json": {
            schema: resolver(z.object({ tiers: z.array(catalogTierSchema) })),
          },
        },
      },
    },
  }),
  (c) => {
    const tiers = getCatalog();
    return c.json({ tiers });
  },
);

catalogRoutes.get(
  "/pricing.json",
  describeRoute({
    tags: ["Catalog"],
    summary: "Machine-readable pricing (AB-010)",
    description:
      "Returns pricing tiers in a flat JSON structure optimized for AI agent consumption. Each tier includes name, price (HBAR), and capabilities array.",
    responses: {
      200: {
        description: "Pricing JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                currency: z.literal("HBAR"),
                tiers: z.array(
                  z.object({
                    name: z.string(),
                    price: z.number(),
                    capabilities: z.array(z.string()),
                  }),
                ),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const tiers = getCatalog();
    return c.json(
      { currency: "HBAR", tiers },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);

catalogRoutes.get(
  "/llms.txt",
  describeRoute({
    tags: ["Catalog"],
    summary: "LLM-friendly catalog (Markdown)",
    responses: {
      200: {
        description: "LLM catalog in Markdown format",
        content: { "text/markdown": {} },
      },
    },
  }),
  (c) => {
    const baseTxt = getLlmsTxt();
    const teamSection = `
## Engineering Capabilities

- /agent-guide/team — Team overview
- /agent-guide/team/capabilities — Capabilities (Markdown)
- /agent-guide/team/capabilities.json — Capabilities (JSON)
- /agent-guide/team/services — Services catalog
- /agent-guide/team/availability — Availability
- /agent-guide/team/contact — Contact channels
- /agent-guide/team/match — Matching criteria
`;
    const txt = baseTxt + teamSection;
    return new Response(txt, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── llms-full.txt (SLICE-47-5) ───────────────────────────────

catalogRoutes.get(
  "/llms-full.txt",
  describeRoute({
    tags: ["Catalog"],
    summary: "Full-text LLM context (concatenated site content)",
    description:
      "Returns the full site content as plain text in a single request. Enables RAG pipelines and embedded agents to ingest all content without browsing multiple pages.",
    responses: {
      200: {
        description: "Full-text content",
        content: { "text/plain": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";
    const baseLlms = getLlmsTxt();

    const fullContent = `# AgentBadge — Full LLM Context

# Source: ${baseUrl}/llms-full.txt
# Generated for RAG ingestion and embedded agents

${baseLlms}

## Engineering Capabilities

- /agent-guide/team — Team overview
- /agent-guide/team/capabilities — Capabilities (Markdown)
- /agent-guide/team/capabilities.json — Capabilities (JSON)
- /agent-guide/team/services — Services catalog
- /agent-guide/team/availability — Availability
- /agent-guide/team/contact — Contact channels
- /agent-guide/team/match — Matching criteria

## API Endpoints

- GET /catalog — Tier pricing and capabilities (JSON)
- GET /pricing.json — Machine-readable pricing (JSON)
- GET /llms.txt — LLM-friendly catalog (Markdown)
- GET /llms-full.txt — This file (full concatenated content)
- GET /.well-known/agent-card.json — Server Agent Card (JSON)
- GET /.well-known/mcp.json — MCP server descriptor (JSON)
- GET /.well-known/oauth-authorization-server — OAuth metadata (JSON)
- GET /.well-known/llm-policy.json — LLM crawler policy (JSON)
- GET /api/specs — OpenAPI 3.1 specification (JSON)
- GET /ai-sitemap.xml — AI resource discovery map (XML)
- GET /robots.txt — Crawler directives
- GET /sitemap.xml — Standard XML sitemap
- GET /ai.txt — AI agent usage policy

## MCP Server

- Endpoint: ${baseUrl}/mcp
- Transport: HTTP (Streamable HTTP + SSE)
- Methods: initialize, tools/list, tools/call
- Tools: 21+ tools for passport, directory, marketplace, audit, messaging

## Marketplace

- GET /market/tasks — List available tasks
- POST /market/tasks — Post a new task (requires passport)
- POST /market/tasks/:id/claim — Claim a task
- POST /market/tasks/:id/deliver — Deliver task results
- POST /market/tasks/:id/complete — Complete task with payment

## Agent Directory

- GET /agents — List all registered agents
- GET /api/search — Unified search (agents + tasks)

## Passport

- POST /passport/request — Issue a new passport NFT
- GET /passport/:tokenId/:serial — Get passport metadata
- GET /verify/:tokenId/:serial — Verify passport on-chain

## Guides

- /agent-guide/context — Agent Knowledge Layer
- /market-guide — Marketplace onboarding guide
- /medical-guide — Medical data skills guide
- /marketplace-guide — Hedera marketplace guide
- /changelog — Product changelog

## Contact

- /contact — Contact form
- /.well-known/security.txt — Security contact info

---
AgentBadge — Agent Readiness Platform on Hedera
${baseUrl}
`;

    return new Response(fullContent, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=300",
      },
    });
  },
);
