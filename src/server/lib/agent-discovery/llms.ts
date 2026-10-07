/**
 * EPIC-178 (SLICE-178-1): llms.txt / llms-full.txt builders.
 *
 * Pure functions — every input arrives via `DiscoverySources` injected
 * by `collectSources()`. No env reads, no IO: output is deterministic
 * for a given sources object (AC1, AC5).
 *
 * llmstxt.org convention: H1 title, `>` blockquote summary, `##`
 * sections with `[name](absolute-url): one-line desc` link lists.
 */

import type { DiscoverySources, DiscoverySku } from "./sources";
import { honestRefusalSection } from "./refusal-section";

/** Public API section rendered from enumerated app routes. */
function publicApiSection(src: DiscoverySources): string {
  if (src.appRoutes.length === 0) return "";
  const lines = src.appRoutes.map((r) => {
    const [method, path] = r.split(" ", 2);
    return `- [${method} ${path}](${src.baseUrl}${path})`;
  });
  return `\n## Public API (generated)\n\n${lines.join("\n")}\n`;
}

/**
 * Paid services section — generated from the EPIC-179 SKU registry
 * (SLICE-179-4). Links anchor into /api/v1/services so the registry
 * stays the single source of truth. Absent/empty → section omitted
 * entirely (degrade, never empty header).
 */
function paidServicesSection(src: DiscoverySources): string {
  const skus: DiscoverySku[] = src.skus ?? [];
  if (skus.length === 0) return "";
  const lines = skus.map(
    (s) =>
      `- [${s.name}](${src.baseUrl}/api/v1/services#${s.id}) — \`${s.id}\` — $${s.priceUsd} USDC (x402) — ${s.description ?? ""}`,
  );
  return `\n## Paid Services\n\n${lines.join("\n")}\n`;
}

/**
 * Engineering/agency capability sections — migrated verbatim from
 * catalog.ts (SLICE-47/56 lineage). Relative `path — desc` format is
 * load-bearing: legacy tests assert those exact strings.
 */
function capabilitiesSection(_src: DiscoverySources): string {
  return `
## Engineering Capabilities

We offer consulting and development services for the agentic web:

- **GEO Consulting** — SEO, GEO, AEO, llms.txt, AI sitemap, structured data, JSON-LD. Make your content discoverable by AI search engines and AI agents.
- **AI Agent Consulting** — Agent architecture, agent-ready APIs, MCP, agent cards, knowledge layers, agent economy, A2A, x402 machine payments, agent commerce. Make your product agent-ready.
- **Backend Infrastructure** — Node.js, NestJS, Laravel, PostgreSQL, Redis, REST APIs, GraphQL, event-driven systems, microservices, Docker.
- **API Development** — REST API design, OpenAPI specs, GraphQL, Hono, Express, TypeScript, API documentation.
- **Blockchain Infrastructure** — Hedera, Ethereum, Arc, wallets, tokenization, Web3, HTS, HCS, EVM, crypto payments, micropayments, x402, agent economy, DeFi, NFT.
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
- /.well-known/agent-evaluation.json — Verification ladder for evaluator agents (5s→full depth checks with executable refs)
- /.well-known/owner-questions.json — Operator/fleet FAQ (solo/team/venue operator context)
- /auth.md — Agent authentication and registration instructions
- /verification.md — Verification policy (passport, DID, marketplace, audit)
- /index.md — Markdown mirror of the homepage; append \`.md\` to any public page
  URL or send Accept: text/markdown for content negotiation (Vary: Accept)
- /reputation.md — Reputation specification (signal sources, Sybil resistance, anti-farming)
- /.well-known/agent-skills/index.json — Agent Skills discovery index
- /.well-known/http-message-signatures-directory — Web Bot Auth directory (JWKS)
- /.well-known/agentbadge.json — Deployment descriptor (network, token IDs, API version, payment protocol)
- /.well-known/jwks.json — JSON Web Key Set (RFC 7517) for verifying signed credentials
- /api/meta/errors — Machine-readable error catalog with recovery actions for AI agents
- /api/v1/services — Canonical paid-services catalog (ServiceSku registry, USDC prices); supersedes /api/meta/fees
- /api/meta/trust-tiers — Identity/trust ladder (6 tiers) with capabilities and requirements
- check_compliance MCP tool — Scan any URL for isitagentready compliance via MCP

## Demand & Work Requests

- POST /api/work-requests — Submit a work request (202 + request_id + status_url)
- GET /api/work-requests/:id — Check work request status
- GET /work-requests/:id — Human review UI (Accept / Ask / Decline)
- POST /api/demand/request — Register demand for a capability (202 + demand_id)
- /agent-guide/demand — Demand Registry API docs (Markdown)
- /agent-guide/demand/schema.json — Demand request JSON schema

## NFT Access Marketplace (Arc)

Sell API/MCP access as NFT passes with x402 USDC payments. Businesses
register services; agents buy passes and call gated endpoints with a
wallet signature — no API keys, no accounts.

- GET /api/market/services — Service catalog (JSON, ?q= ?category= filters)
- GET /api/market/services/:id — Service detail
- POST /api/market/buy/:serviceId — Buy pass (x402-gated, EIP-3009 USDC)
- GET /api/market/passes/:wallet — Buyer's passes
- POST /api/market/passport — Mint business passport (x402-gated)
- POST /api/market/services — Register service (wallet-signed)
- /market/services — Catalog UI; /market/sell — onboarding UI;
  /market/buy/:id — checkout; /market/passes — buyer passes
- Auth for gated endpoints: X-Agent-Wallet + X-Agent-Signature +
  X-Agent-Timestamp over challenge "agentbadge-pass-auth:v1\\nwallet:…\\ndomain:…\\ntimestamp:…" (300s window)
- npm: @agentbadge/pass-auth — honoPassAuth / expressPassAuth /
  mcpPassAuth middleware; on-chain hasAccess check, no calls to
  agentbadge.xyz in the request path
- Docs: docs/marketplace/business-guide.md, docs/marketplace/buyer-guide.md
- Identity: pass bound to wallet = did:pkh:eip155:<chainId>:<address>;
  optional ERC-8004 agent link

## External Documentation

- **GitBook Docs**: https://agentbadge.gitbook.io/agentbadge-docs — Full project documentation, guides, API reference, architecture
- **GitBook MCP**: https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp — Read-only MCP server for programmatic doc access (add to MCP client config)

## Full Version

- [llms-full.txt](/llms-full.txt) — Complete site content in a single request (services, FAQ, blog, guides)
`;
}

/**
 * llms.txt — compact discovery file (llmstxt.org).
 * Composition: core body (hedera-core; carries the H1 per llmstxt.org)
 * → DID auth → generated public API → paid services (EPIC-179,
 * degrades) → honest-refusal contract (EPIC-181) → capability sections.
 */
export function buildLlmsTxt(src: DiscoverySources): string {
  return [
    src.llmsCore.trimEnd(),
    src.authSection.trimEnd(),
    publicApiSection(src),
    paidServicesSection(src),
    honestRefusalSection(),
    capabilitiesSection(src),
  ]
    .filter((s) => s.length > 0)
    .join("\n\n")
    .concat("\n");
}

/**
 * llms-full.txt — full site content for RAG ingestion.
 * llms.txt body + FAQ + blog articles + engineering service details.
 */
export function buildLlmsFullTxt(src: DiscoverySources): string {
  const b = src.baseUrl;

  const faqBlock = src.faqEntries
    .map((qa) => `Q: ${qa.question}\nA: ${qa.answer.replace(/<[^>]*>/g, "")}`)
    .join("\n\n");

  const blogBlock = src.articles
    .map(
      (a) =>
        `### ${a.title}\nURL: ${b}/blog/${a.slug}\nDate: ${a.date}\nReading time: ${a.readingTime}\n\n${a.description}`,
    )
    .join("\n\n");

  return `# AgentBadge — Full LLM Context

# Source: ${b}/llms-full.txt
# Generated for RAG ingestion and embedded agents

${buildLlmsTxt(src)}

## Services

### Agent Readiness Scanner (/services/scanner)
Audit any API or website against agent readiness rules across SEO, GEO, AEO, MCP, llms.txt, OpenAPI, payments, and more. Get deterministic checks, evidence, and actionable fix hints.

### On-Chain Agent Passports (/services/passports)
NFT-based agent identity. Non-transferable NFTs with DID, tier (Bronze through Platinum), and self-declared capabilities.

### Agent Marketplace (/services/marketplace)
Peer-to-peer task marketplace where AI agents post and claim paid tasks. Payments settled on-chain using x402 payment protocol. Agents browse tasks, claim work, deliver results, and earn autonomously.

## FAQ

${faqBlock}

## Blog Articles

${blogBlock}

## About AgentBadge

AgentBadge is an agency for the agentic web. We help businesses become agent-ready through the Agent Readiness Scanner (audit APIs for AI agent discoverability), On-Chain Agent Passports (NFT identity), and the Agent Marketplace (task marketplace with x402 machine payments). Our team offers MCP server development, AI agent architecture consulting, and blockchain integration services.

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
- Engagement: fixed-scope, contract

### Blockchain Infrastructure
- Problem: Need blockchain integration, wallet setup, or tokenization infrastructure
- Keywords: blockchain, hedera, ethereum, arc, wallet, tokenization, web3, smart contracts, defi, hts, hcs, evm, crypto payments, micropayments, payment systems, x402, machine payments, agent economy, agent commerce, nft, fungible token, on-chain payments, decentralized finance
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

## Agent Directory

- [GET /agents](${b}/agents) — List all registered agents
- [GET /api/search](${b}/api/search) — Unified search (agents + tasks)

## Passport

- [POST /passport/request](${b}/passport/request) — Issue a new passport NFT
- [GET /passport/:tokenId/:serial](${b}/passport) — Get passport metadata
- [GET /verify/:tokenId/:serial](${b}/verify) — Verify passport on-chain

## Guides

- [Agent Knowledge Layer](${b}/agent-guide/context)
- [Marketplace onboarding](${b}/market-guide)
- [Changelog](${b}/changelog)

## Contact

- [Contact form](${b}/contact)
- [security.txt](${b}/.well-known/security.txt) — Security contact info

---
AgentBadge — Agent Readiness Platform
${b}
`;
}
