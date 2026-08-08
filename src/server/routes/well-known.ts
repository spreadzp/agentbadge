/**
 * Well-known routes — Agent Card + AI Sitemap
 *
 * SLICE-17-1: GET /.well-known/agent-card.json
 * SLICE-17-9: GET /ai-sitemap.xml
 * SLICE-18-3: GET /robots.txt, GET /sitemap.xml
 * Epic 20: GET /.well-known/llm-policy.json
 * SLICE-45-3: GET /ai.txt
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";
import { serverAgentCardSchema, openApiConfig } from "../openapi";
import { BASE_URL, PUBLIC_PAGES } from "../lib/page-meta";
import { BUILD_DATE } from "../lib/build-info";

export const wellKnownRoutes = new Hono();

/**
 * Build the Server Agent Card from env + OpenAPI config.
 */
function buildAgentCard() {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";
  const facilitatorUrl =
    process.env.x402_FACILITATOR_URL ??
    process.env.FACILITATOR_URL ??
    "https://api.testnet.blocky402.com";
  const network = process.env.HEDERA_NETWORK ?? "testnet";

  return {
    name: openApiConfig.info.title,
    description: openApiConfig.info.description,
    url: baseUrl,
    version: openApiConfig.info.version,
    capabilities: [
      "passport_issuance",
      "passport_verification",
      "agent_directory",
      "a2a_messaging",
      "marketplace",
      "audit_trail",
      "did_resolution",
    ],
    skills: [
      "api_call",
      "payment",
      "data_provide",
      "data_consume",
      "orchestration",
    ],
    endpoints: {
      api: `${baseUrl}/api/specs`,
      docs: `${baseUrl}/docs`,
      mcp: `${baseUrl}/mcp`,
      llms_txt: `${baseUrl}/llms.txt`,
      guides: `${baseUrl}/agent-guide/context`,
      did_resolver: `${baseUrl}/did`,
    },
    payment: {
      protocol: "x402",
      scheme: "exact",
      network: network === "mainnet" ? "hedera:mainnet" : "hedera:testnet",
      asset: "HBAR",
      facilitator: facilitatorUrl,
    },
    blockchain: {
      network,
      passport_token_id: process.env.PASSPORT_TOKEN_ID,
      directory_topic_id: process.env.DIRECTORY_TOPIC_ID,
      audit_topic_id: process.env.AUDIT_TOPIC_ID,
    },
  };
}

wellKnownRoutes.get(
  "/.well-known/agent-card.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Server Agent Card (machine-readable identity manifest)",
    description:
      "Returns the server's Agent Card — a JSON manifest describing capabilities, endpoints, payment, and blockchain config. Used by external agents for discovery.",
    responses: {
      200: {
        description: "Agent Card JSON",
        content: {
          "application/json": {
            schema: resolver(serverAgentCardSchema),
          },
        },
      },
    },
  }),
  (c) => {
    const card = buildAgentCard();
    return c.json(card, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// ─── MCP Server Descriptor (SLICE-44-6 / AB-006) ──────────────────

wellKnownRoutes.get(
  "/.well-known/mcp.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "MCP server descriptor (machine-readable MCP discovery)",
    description:
      "Returns the MCP server descriptor JSON, enabling AI agents to discover and connect to the AgentBadge MCP server programmatically.",
    responses: {
      200: {
        description: "MCP server descriptor JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                name: z.string(),
                version: z.string(),
                description: z.string(),
                remotes: z.array(
                  z.object({
                    name: z.string(),
                    transport: z.string(),
                    url: z.string(),
                  }),
                ),
                tools: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
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
    const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";
    const descriptor = {
      name: "agentbadge",
      version: openApiConfig.info.version,
      description: "AgentBadge MCP server for agent readiness scanning",
      remotes: [
        {
          name: "agentbadge",
          transport: "http",
          url: `${baseUrl}/mcp`,
        },
      ],
      tools: [
        { name: "scan", description: "Scan a URL for agent readiness" },
        { name: "get_score", description: "Get the agent readiness score for a URL" },
      ],
    };
    return c.json(descriptor, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// ─── OAuth Authorization Server Metadata (SLICE-47-3) ──────────

wellKnownRoutes.get(
  "/.well-known/oauth-authorization-server",
  describeRoute({
    tags: ["Discovery"],
    summary: "OAuth authorization server metadata (MCP auth discovery)",
    description:
      "Returns OAuth 2.0 authorization server metadata per RFC 8414. Enables MCP clients to discover authentication requirements.",
    responses: {
      200: {
        description: "OAuth metadata JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                issuer: z.string(),
                authorization_endpoint: z.string(),
                token_endpoint: z.string(),
                registration_endpoint: z.string(),
                response_types_supported: z.array(z.string()),
                grant_types_supported: z.array(z.string()),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";
    return c.json(
      {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/auth/authorize`,
        token_endpoint: `${baseUrl}/auth/token`,
        registration_endpoint: `${baseUrl}/auth/register`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
      },
      200,
      { "Cache-Control": "public, max-age=3600" },
    );
  },
);

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

wellKnownRoutes.get(
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

/**
 * Build the AI sitemap XML string.
 * SLICE-17-9
 */
function buildAiSitemap(): string {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";

  const resources = [
    {
      loc: `${baseUrl}/.well-known/agent-card.json`,
      priority: "1.0",
      format: "json",
      desc: "Server Agent Card — machine-readable identity manifest",
    },
    {
      loc: `${baseUrl}/llms.txt`,
      priority: "1.0",
      format: "text",
      desc: "LLM-friendly API specification in plain text",
    },
    {
      loc: `${baseUrl}/api/specs`,
      priority: "1.0",
      format: "json",
      desc: "OpenAPI 3.1 specification",
    },
    {
      loc: `${baseUrl}/market/tasks`,
      priority: "0.7",
      format: "json",
      desc: "Marketplace task listings — browse available tasks",
    },
    {
      loc: `${baseUrl}/agent-guide/context`,
      priority: "0.9",
      format: "markdown",
      desc: "Agent Knowledge Layer — context, learning path, knowledge map",
    },
    {
      loc: `${baseUrl}/marketplace-guide`,
      priority: "0.8",
      format: "markdown",
      desc: "Hedera marketplace onboarding guide for AI agents",
    },
    {
      loc: `${baseUrl}/market-guide`,
      priority: "0.8",
      format: "markdown",
      desc: "Marketplace guide: post, claim, deliver, complete tasks",
    },
    {
      loc: `${baseUrl}/medical-guide`,
      priority: "0.8",
      format: "markdown",
      desc: "Medical data skills guide",
    },
    {
      loc: `${baseUrl}/catalog`,
      priority: "0.8",
      format: "json",
      desc: "Tier pricing and capabilities catalog",
    },
    {
      loc: `${baseUrl}/agents`,
      priority: "0.8",
      format: "json",
      desc: "List all registered agents with active status",
    },
    {
      loc: `${baseUrl}/api/search`,
      priority: "0.7",
      format: "json",
      desc: "Unified search endpoint — find agents and tasks by query",
    },
  ];

  const entries = resources
    .map(
      (r) => `  <resource>
    <loc>${r.loc}</loc>
    <priority>${r.priority}</priority>
    <format>${r.format}</format>
    <desc>${r.desc}</desc>
  </resource>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<resources>
${entries}
</resources>`;
}

wellKnownRoutes.get(
  "/ai-sitemap.xml",
  describeRoute({
    tags: ["Discovery"],
    summary: "AI Sitemap (resource discovery map for AI agents)",
    description:
      "Returns an XML sitemap listing all machine-readable resources with priority, format, and description. Used by AI agents to discover available endpoints.",
    responses: {
      200: {
        description: "AI Sitemap XML",
        content: {
          "application/xml": {},
        },
      },
    },
  }),
  (c) => {
    const xml = buildAiSitemap();
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── robots.txt (SLICE-18-3) ──────────────────────────────────

wellKnownRoutes.get(
  "/robots.txt",
  describeRoute({
    tags: ["Discovery"],
    summary: "robots.txt — crawler directives with spam bot blocking",
    description:
      "Returns robots.txt with allow rules for useful crawlers (GPTBot, OAI-SearchBot, ClaudeBot, anthropic-ai, PerplexityBot, Google-Extended, Applebot-Extended, CCBot, cohere-ai, Googlebot, Bingbot, DuckDuckBot) and disallow for spam crawlers (AhrefsBot, SemrushBot, MJ12bot, DotBot, BLEXBot, Bytespider) and admin/internal paths.",
    responses: {
      200: {
        description: "robots.txt",
        content: { "text/plain": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /ui/a2a/inbox/fragment

# ── Allow useful LLM / AI crawlers ──
User-agent: GPTBot
Allow: /

User-agent: OAI-SearchBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: anthropic-ai
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: PerplexityBot-User
Allow: /

User-agent: Google-Extended
Allow: /

User-agent: Applebot-Extended
Allow: /

User-agent: CCBot
Allow: /

User-agent: cohere-ai
Allow: /

User-agent: Googlebot
Allow: /

User-agent: Bingbot
Allow: /

User-agent: DuckDuckBot
Allow: /

# ── Block SEO-spam / link-analysis crawlers ──
User-agent: AhrefsBot
Disallow: /

User-agent: SemrushBot
Disallow: /

User-agent: SemrushBot-SA
Disallow: /

User-agent: MJ12bot
Disallow: /

User-agent: DotBot
Disallow: /

User-agent: BLEXBot
Disallow: /

# ── Block high-load Chinese crawler ──
User-agent: Bytespider
Disallow: /

Sitemap: ${baseUrl}/sitemap.xml
`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "public, max-age=86400",
      },
    });
  },
);

// ─── sitemap.xml (SLICE-18-3) ─────────────────────────────────

// Per-page lastmod: dynamic pages use BUILD_DATE, static guides use curated dates
const STATIC_LASTMOD: Record<string, string> = {
  "/agent-guide": "2026-07-25",
  "/market-guide": "2026-07-25",
  "/medical-guide": "2026-07-25",
  "/faq": "2026-07-29",
  "/use-cases": "2026-07-29",
  "/contact": "2026-07-24",
  "/changelog": BUILD_DATE,
};

function pageLastmod(path: string): string {
  return STATIC_LASTMOD[path] ?? BUILD_DATE;
}

function buildSitemap(): string {
  const baseUrl = BASE_URL;

  const urls = PUBLIC_PAGES.map(
    (p) => `  <url>
    <loc>${baseUrl}${p.path}</loc>
    <lastmod>${pageLastmod(p.path)}</lastmod>
    <changefreq>${p.changefreq}</changefreq>
    <priority>${p.priority}</priority>
  </url>`,
  ).join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>`;
}

wellKnownRoutes.get(
  "/sitemap.xml",
  describeRoute({
    tags: ["Discovery"],
    summary: "sitemap.xml — classic XML sitemap for search engines",
    description:
      "Returns a standard XML sitemap listing all public indexable pages with lastmod, changefreq, and priority.",
    responses: {
      200: {
        description: "Sitemap XML",
        content: { "application/xml": {} },
      },
    },
  }),
  (c) => {
    const xml = buildSitemap();
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── ai.txt (SLICE-45-3) ──────────────────────────────────────

wellKnownRoutes.get(
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
  (c) => {
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

// ─── skill.md (SLICE-47-6) ─────────────────────────────────────

wellKnownRoutes.get(
  "/skill.md",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent skill file (agentskills.io spec)",
    description:
      "Returns a markdown skill file with YAML frontmatter (name, description) describing the site's agent capabilities. Per agentskills.io specification.",
    responses: {
      200: {
        description: "Skill markdown",
        content: { "text/markdown": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";
    const body = `---
name: agentbadge-api
description: Agent passport issuance, directory, and marketplace on Hedera L1 with x402 micropayments
---

## AgentBadge API Skill

AgentBadge provides agent identity, verification, and marketplace tools on Hedera.

### Available MCP Tools

- **request_passport** — Issue agent passport NFT (paid, x402)
- **verify_passport** — Verify passport on-chain status
- **register_agent** — Register in HCS directory
- **find_agents** — Search agents by capability
- **post_task** — Post marketplace task with escrow
- **claim_task** — Claim a marketplace task
- **deliver_result** — Deliver task results
- **complete_task** — Complete task with P2P HBAR payment
- **send_message** — Send A2A message via HCS
- **get_inbox** — Get agent inbox messages
- **get_tier_requirements** — Get passport tier catalog
- **upgrade_tier** — Upgrade passport tier

### Authentication

No API key required. Paid endpoints use x402 (HTTP 402) payment flow.
OAuth discovery at \`/.well-known/oauth-authorization-server\`.

### MCP Endpoint

\`\`\`
${baseUrl}/mcp
\`\`\`

### Quick Start

1. Request a passport: \`POST /passport/request\`
2. Register in directory: \`POST /agents/register\`
3. Post or claim marketplace tasks: \`POST /market/tasks\`
4. Send A2A messages: \`POST /a2a/send\`

### Resources

- [LLM Context](/llms.txt) — API summary for LLMs
- [Full Context](/llms-full.txt) — Complete site content
- [Agent Card](/.well-known/agent-card.json) — Machine-readable identity
- [OpenAPI Spec](/api/specs) — Full API specification
- [AI Sitemap](/ai-sitemap.xml) — Resource discovery map
`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── x402 payment discovery (SLICE-47-10) ──────────────────────

wellKnownRoutes.get(
  "/.well-known/x402.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "x402 payment discovery",
    description:
      "Returns the site's x402 payment configuration: supported network, facilitator, payTo wallet, and list of paid services with pricing.",
    responses: {
      200: {
        description: "x402 payment configuration",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const facilitatorUrl = process.env.x402_FACILITATOR_URL ?? "https://facilitator-agentbadge.fly.dev";
    const payTo = process.env.x402_TREASURY ?? process.env.HEDERA_OPERATOR_ID ?? "0.0.5266613";
    const network = process.env.HEDERA_NETWORK ?? "testnet";
    const networkId = network === "mainnet" ? "hedera:mainnet" : "hedera:testnet";

    const config = {
      x402Version: 1,
      name: "AgentBadge",
      network: networkId,
      facilitator: facilitatorUrl,
      payTo,
      services: [
        {
          method: "POST",
          path: "/passport/request",
          description: "Agent Passport NFT issuance (x402 payment required)",
          amount: {
            asset: "HBAR",
            unit: "tinybar",
            tiers: {
              bronze: "5000000",
              silver: "25000000",
              gold: "100000000",
              platinum: "500000000",
            },
          },
          mimeType: "application/json",
          extensions: {
            bazaar: {
              discoverable: true,
              category: "identity",
              tags: ["hedera", "nft", "passport", "agent-identity"],
            },
          },
        },
      ],
      extensions: {
        bazaar: {
          discoverable: true,
          provider: "AgentBadge",
          homepage: "https://agentbadge.xyz",
        },
      },
    };

    return c.json(config, 200, {
      "Cache-Control": "public, max-age=300",
    });
  },
);
