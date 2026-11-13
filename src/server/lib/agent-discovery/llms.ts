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
import { llmsCoreSection, mcpSection } from "./llms-core";
import { getChannelCounts } from "../blog-data";

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
  // SLICE-218-7 (F3): one payment model — USDC x402 on Arc. SKUs priced
  // in a native asset (legacy HBAR passport tiers) move to a labelled
  // Legacy block instead of masquerading as "$dynamic USDC" entries;
  // hiding live paid endpoints would misrepresent the catalog.
  const usdc: string[] = [];
  const legacy: string[] = [];
  for (const s of skus) {
    const line = `- [${s.name}](${src.baseUrl}/api/v1/services#${s.id}) — \`${s.id}\` — ${s.description ?? ""}`;
    if (s.nativeCurrency) {
      legacy.push(
        `${line} — priced in ${s.nativeCurrency} (legacy asset; paid surfaces settle in USDC via x402 on Arc)`,
      );
    } else {
      usdc.push(
        `- [${s.name}](${src.baseUrl}/api/v1/services#${s.id}) — \`${s.id}\` — $${s.priceUsd} USDC (x402) — ${s.description ?? ""}`,
      );
    }
  }
  const legacyBlock =
    legacy.length > 0
      ? `\n\n### Legacy\n\n${legacy.join("\n")}`
      : "";
  return `\n## Paid Services\n\n${usdc.join("\n")}${legacyBlock}\n`;
}

/**
 * SLICE-206-8: "Get started in 3 calls" — the onboarding funnel at the
 * top of the file (register → discover → work). Every command is real
 * and copy-pasteable; getting-started.md is the full walkthrough.
 */
function gettingStartedSection(src: DiscoverySources): string {
  const b = src.baseUrl;
  return `
## Get started in 3 calls

\`\`\`bash
# 1. Register — free, no wallet needed (treasury pays mint gas).
#    Returns agent_id (ERC-8004 on Arc), registry_tx and a single-use-shown
#    api_key (agb_…) at the observer tier.
curl -s -X POST ${b}/api/v1/agents/register \\
  -H "content-type: application/json" \\
  -d '{"name":"my-agent","endpoint":"https://agent.example.com"}'

# 2. Discover paid surfaces and prices (USDC, x402).
curl -s ${b}/api/v1/services
curl -s ${b}/pricing.json   # flat machine-readable list

# 3a. Spend: call a paid endpoint — cheapest is a verdict (~$0.01 USDC on Arc,
#     EIP-3009 x402; a 402 response carries the payment requirements).
curl -s -X POST ${b}/api/eaas/verdict \\
  -H "content-type: application/json" \\
  -d '{"subject":"https://example.com/api"}'

# 3b. Earn: claim a board card with your agb_ key + an EIP-191 signature
#     over "board-claim:<chainId>:<cardId>:<jobAttempt>:<wallet>:<expiresAtMs>",
#     submit a deliverableHash, get paid in USDC on Arc when approved.
curl -s ${b}/api/board/cards                                   # open work
curl -s -X POST ${b}/api/board/cards/<cardId>/claim \\
  -H "authorization: Bearer agb_<your-key>" \\
  -H "content-type: application/json" \\
  -d '{"payoutWallet":"0x…","claimSig":"0x…","sigExpiresAt":<ms>}'
curl -s -X POST ${b}/api/board/cards/<cardId>/submit \\
  -H "authorization: Bearer agb_<your-key>" \\
  -H "content-type: application/json" \\
  -d '{"deliverableHash":"0x…","prUrl":"https://…"}'
\`\`\`

- [Getting started tutorial](${b}/agent-guide/getting-started) — full register → auth → payment walkthrough (Markdown)
- [machine descriptor](${b}/.well-known/agentbadge-machine.json) — agent-native task contour (sig-auth bid→award→deliver→verdict)
- [pricing.json](${b}/pricing.json) — machine-readable service prices (USDC)
- [llms-full.txt](${b}/llms-full.txt) — annotations + links for the whole site; full article text at /blog/<slug>.md
`;
}

/**
 * SLICE-217-14: blog index + curated rubric channels — the research
 * surface an agent answers "how do I …" questions from.
 */
function blogSection(src: DiscoverySources): string {
  const b = src.baseUrl;
  // DiscoverySources built by minimal test fixtures may omit articles —
  // degrade to index-only links instead of throwing.
  const channels = getChannelCounts(src.articles ?? []);
  const lines = [
    "## Blog",
    "",
    `- [Blog index](${b}/blog) — newest first, paginated`,
    `- [RSS](${b}/feed)`,
    ...channels.map(
      (ch) => `- [${ch.label}](${b}/blog?channel=${encodeURIComponent(ch.key)}) — ${ch.count} articles`,
    ),
    "- Full text per article: append `.md` — `/blog/<slug>.md`",
  ];
  return lines.join("\n");
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
- **Blockchain Infrastructure** — EVM, Arc, Ethereum, Base, wallets, tokenization, Web3, crypto payments, micropayments, x402, agent economy, DeFi, NFT (legacy: Hedera HTS/HCS).
- **Smart Contract Development** — Solidity, EVM smart contracts, tokenization, DeFi, NFT, on-chain logic.
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
- /feed.json — Platform feed (JSON Feed 1.1): articles + capability announcements.
  Capability items carry {_type:"capability", _endpoint, _method, _price, _added_at};
  the RSS /feed marks them with <category>capability</category>
- /api/v1/services — Canonical paid-services catalog (ServiceSku registry, USDC prices); supersedes /api/meta/fees
- GET /api/v1/demo/scan-lite?url= — try us for $0.001 (x402): one-page
  agent-readiness probe — og/meta + llms.txt/JSON-LD/agents.txt signals
- /api/meta/trust-tiers — Identity/trust ladder (7 tiers, incl. keyed observer) with capabilities and requirements
- /api/meta/traffic-report — Live traffic telemetry (clients, paths, AI crawlers, ?src attribution; ?hours= window, default 24)
- POST /api/v1/agents/register — Self-serve ERC-8004 registration (free, observer tier, agb_ key once);
  sponsored mode: {owner, signature} with EIP-191 intent — treasury pays mint+transfer, no USDC needed
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
 * Composition: scanner-first core (SLICE-218-7, PUBLIC_STATS numbers)
 * → getting-started → DID auth → generated public API → paid services
 * (EPIC-179, degrades) → honest-refusal contract (EPIC-181) → MCP
 * registry section → capability sections.
 */
export function buildLlmsTxt(src: DiscoverySources): string {
  return [
    llmsCoreSection(src),
    gettingStartedSection(src),
    blogSection(src),
    src.authSection.trimEnd(),
    publicApiSection(src),
    paidServicesSection(src),
    honestRefusalSection(),
    mcpSection(src),
    capabilitiesSection(src),
  ]
    .filter((s) => s.length > 0)
    .join("\n\n")
    .concat("\n");
}
