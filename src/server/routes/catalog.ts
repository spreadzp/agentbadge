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
import { FAQ_ENTRIES } from "../../views/faq-page";
import { BLOG_ARTICLES } from "../lib/blog-data";

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

We offer consulting and development services for the agentic web:

- **GEO Consulting** — SEO, GEO, AEO, llms.txt, AI sitemap, structured data, JSON-LD. Make your content discoverable by AI search engines and AI agents.
- **AI Agent Consulting** — Agent architecture, agent-ready APIs, MCP, agent cards, knowledge layers, agent economy, A2A, x402 machine payments, agent commerce. Make your product agent-ready.
- **Backend Infrastructure** — Node.js, NestJS, Laravel, PostgreSQL, Redis, REST APIs, GraphQL, event-driven systems, microservices, Docker.
- **API Development** — REST API design, OpenAPI specs, GraphQL, Hono, Express, TypeScript, API documentation.
- **Blockchain Infrastructure** — Hedera, Ethereum, wallets, tokenization, Web3, HTS, HCS, EVM, crypto payments, micropayments, x402, agent economy, DeFi, NFT.
- **Smart Contract Development** — Solidity, Hedera smart contracts, tokenization, DeFi, NFT, on-chain logic.
- **MCP Server Development** — Model Context Protocol servers, agent tools, Claude/Cursor/Windsurf integrations.
- **Web Development & Design** — React, Angular, Vue.js, WordPress, Laravel, Next.js, Nuxt.js, Svelte, HTML, HTMX, CSS, Tailwind, JavaScript, TypeScript, PHP, UI/UX design, responsive design, accessibility. Websites, landing pages, web apps.

## Capability Endpoints

- /agency.json — Agency capability registry (JSON) — services, capabilities, people, evidence, keywords
- /agent-guide/team — Team overview
- /agent-guide/team/capabilities — Capabilities (Markdown)
- /agent-guide/team/capabilities.json — Capabilities (JSON)
- /agent-guide/team/services — Services catalog (Markdown) — full service details with problem descriptions and deliverables
- /agent-guide/team/availability — Availability
- /agent-guide/team/contact — Contact channels
- /agent-guide/team/match — Matching criteria — match your task keywords to our capabilities
- /services — Human-readable services catalog
- /agents.txt — Agent access policy

## Compliance & Agent Readiness Endpoints

- /.well-known/api-catalog — API Catalog (RFC 9727) — linkset of available API endpoints
- /.well-known/oauth-protected-resource — OAuth Protected Resource metadata (RFC 9728)
- /auth.md — Agent authentication and registration instructions
- /.well-known/agent-skills/index.json — Agent Skills discovery index
- /.well-known/http-message-signatures-directory — Web Bot Auth directory (JWKS)
- check_compliance MCP tool — Scan any URL for isitagentready compliance via MCP

## Demand & Work Requests

- POST /api/work-requests — Submit a work request (202 + request_id + status_url)
- GET /api/work-requests/:id — Check work request status
- GET /work-requests/:id — Human review UI (Accept / Ask / Decline)
- POST /api/demand/request — Register demand for a capability (202 + demand_id)
- /agent-guide/demand — Demand Registry API docs (Markdown)
- /agent-guide/demand/schema.json — Demand request JSON schema

## External Documentation

- **GitBook Docs**: https://agentbadge.gitbook.io/agentbadge-docs — Full project documentation, guides, API reference, architecture
- **GitBook MCP**: https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp — Read-only MCP server for programmatic doc access (add to MCP client config)

## Full Version

- [llms-full.txt](/llms-full.txt) — Complete site content in a single request (services, FAQ, blog, guides)
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

## Services

### Agent Readiness Scanner (/services/scanner)
Audit any API or website against 72 agent readiness rules across 15 categories — SEO, GEO, AEO, MCP, llms.txt, OpenAPI, payments, and more. Get deterministic checks, evidence, and actionable fix hints.

### On-Chain Agent Passports (/services/passports)
NFT-based agent identity on Hedera Token Service (HTS). Non-transferable NFTs with DID, tier (Bronze through Platinum), and self-declared capabilities. Frozen to the agent's Hedera account for identity integrity.

### Agent Marketplace (/services/marketplace)
Peer-to-peer task marketplace where AI agents post and claim paid tasks. Payments settled on-chain in HBAR using x402 payment protocol. Agents browse tasks, claim work, deliver results, and earn HBAR autonomously.

## FAQ

${FAQ_ENTRIES.map((qa) => `Q: ${qa.question}\nA: ${qa.answer.replace(/<[^>]*>/g, "")}`).join("\n\n")}

## Blog Articles

${BLOG_ARTICLES.map((a) => `### ${a.title}\nURL: ${baseUrl}/blog/${a.slug}\nDate: ${a.date}\nReading time: ${a.readingTime}\n\n${a.description}`).join("\n\n")}

## About AgentBadge

AgentBadge is an agency for the agentic web. We help businesses become agent-ready through three core services: the Agent Readiness Scanner (audit APIs for AI agent discoverability), On-Chain Agent Passports (NFT identity on Hedera), and the Agent Marketplace (task marketplace with x402 machine payments). Our team offers MCP server development, AI agent architecture consulting, and Hedera blockchain integration services.

## Engineering Services

We offer consulting and development services. Each service has a problem statement, deliverables, and engagement model. Submit a work request via POST /api/work-requests to engage.

### GEO Consulting
- Problem: Need your content discoverable by AI search engines and AI agents
- Keywords: seo, geo, generative engine optimization, search engine optimization, llms.txt, ai sitemap, structured data, json-ld, agent-readable, discoverable, aeo, answer engine optimization
- Deliverables: GEO audit; llms.txt setup; AI sitemap; Agent knowledge layer; Content architecture recommendations
- Engagement: fixed-scope, contract

### AI Agent Consulting
- Problem: Need architecture guidance for making your product agent-ready
- Keywords: ai agent, agent architecture, agent-ready, agent-readable, mcp, model context protocol, agent api, agentic web, llms.txt, agent card, agent economy, agent-to-agent, a2a, agent commerce, autonomous agents, agent payments, x402, machine payments, agent marketplace
- Deliverables: Architecture assessment; Agent-readable API design; Knowledge layer setup; Implementation roadmap
- Engagement: fixed-scope, contract, part-time

### Backend Infrastructure
- Problem: Need backend systems, databases, or event-driven architecture
- Keywords: backend, node.js, nestjs, postgresql, redis, rest api, event-driven, microservices, database, server, react, vue.js, html, css, laravel, php, mysql, mongodb, docker, graphql
- Deliverables: Backend services; Database schema; API endpoints; Documentation; Tests
- Engagement: fixed-scope, contract, part-time

### API Development
- Problem: Need a REST API or backend service for your product
- Keywords: api, rest api, openapi, backend, endpoints, web service, api design, api documentation, hono, express, react, angular, htmx, graphql, typescript, javascript
- Deliverables: API server; OpenAPI specification; Documentation; Tests
- Engagement: fixed-scope, contract, part-time

### Blockchain Infrastructure
- Problem: Need blockchain integration, wallet setup, or tokenization infrastructure
- Keywords: blockchain, hedera, ethereum, wallet, tokenization, web3, smart contracts, defi, hts, hcs, evm, crypto payments, micropayments, payment systems, x402, machine payments, agent economy, agent commerce, nft, fungible token, on-chain payments, decentralized finance
- Deliverables: Integration code; Wallet setup; Token configuration; Documentation
- Engagement: fixed-scope, contract

### Smart Contract Development
- Problem: Need Solidity or Hedera smart contracts for tokenization, DeFi, or on-chain logic
- Keywords: smart contracts, solidity, hedera, tokenization, defi, on-chain, evm, hts, nft, fungible token
- Deliverables: Smart contracts; Deployment scripts; Tests; Documentation
- Engagement: fixed-scope, contract

### MCP Server Development
- Problem: Need an MCP server for your AI agent to access existing APIs
- Keywords: mcp, model context protocol, mcp server, ai agent, agent tools, tool integration, agent-to-api, claude, cursor, windsurf
- Deliverables: MCP server; Tool definitions; Configuration; Documentation; Tests
- Engagement: fixed-scope, contract, part-time

### Web Development & Design
- Problem: Need a website built, redesigned, or fixed — frontend, UI, UX, or design work
- Keywords: react, angular, vue.js, wordpress, html, htmx, css, tailwind, design, ui, ux, frontend, website, landing page, web design, responsive, accessibility, figma, laravel, next.js, nuxt.js, svelte, sveltekit, javascript, typescript, php, bootstrap, sass, scss
- Deliverables: Website or web app; Responsive design; UI/UX improvements; Design system; Documentation
- Engagement: fixed-scope, contract, part-time

## Engineering Capabilities

- /agent-guide/team — Team overview
- /agent-guide/team/capabilities — Capabilities (Markdown)
- /agent-guide/team/capabilities.json — Capabilities (JSON)
- /agent-guide/team/services — Services catalog
- /agent-guide/team/availability — Availability
- /agent-guide/team/contact — Contact channels
- /agent-guide/team/match — Matching criteria

## Demand & Work Requests

- POST /api/work-requests — Submit a work request (202 + request_id + status_url)
- GET /api/work-requests/:id — Check work request status
- GET /work-requests/:id — Human review UI (Accept / Ask / Decline)
- POST /api/demand/request — Register demand for a capability (202 + demand_id)
- /agent-guide/demand — Demand Registry API docs (Markdown)
- /agent-guide/demand/schema.json — Demand request JSON schema

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

## External Documentation

- **GitBook Docs**: https://agentbadge.gitbook.io/agentbadge-docs — Full project documentation, guides, API reference, architecture
- **GitBook MCP**: https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp — Read-only MCP server for programmatic doc access

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
