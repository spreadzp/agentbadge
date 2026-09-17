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
import { BLOG_ARTICLES } from "../lib/blog-data";
import { getNamespace } from "@agentbadge/mcp";
import { didAuthSectionCompact, agentCardAuthBlock } from "../lib/did-auth-docs";
import { buildDiscoveryJson, allTools } from "@agentbadge/webmcp";

const MCP_NAMESPACES = ["passport", "market", "discovery", "audit"] as const;

const NAMESPACE_DESCRIPTIONS: Record<string, string> = {
  passport: "Agent identity, signing, and escrow tools",
  market: "Marketplace and dataset tools",
  discovery: "Agent directory, guide, A2A messaging, and discovery tools",
  audit: "Audit catalog, compliance checking, and OpenAPI parity tools",
};

function buildNamespaceDescriptor(nsName: string) {
  const ns = getNamespace(nsName);
  const tools = ns ? ns.listTools().map((t) => ({ name: t.name, description: t.description })) : [];
  return {
    name: `${nsName}-mcp`,
    version: openApiConfig.info.version,
    description: NAMESPACE_DESCRIPTIONS[nsName] ?? `${nsName} MCP namespace`,
    remotes: [
      {
        name: nsName,
        transport: "http",
        url: `${BASE_URL}/mcp/${nsName}`,
      },
    ],
    tools,
  };
}

export const wellKnownRoutes = new Hono();

/**
 * Build the Server Agent Card from env + OpenAPI config.
 */
export function buildAgentCard() {
  const baseUrl = BASE_URL;
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
    documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
    capabilities: [
      "passport_issuance",
      "passport_verification",
      "agent_directory",
      "a2a_messaging",
      "marketplace",
      "audit_trail",
      "did_resolution",
      "compliance_checking",
      "agent_skills_discovery",
      "web_bot_auth",
      "agency_services",
      "work_requests",
      "demand_registry",
      "on_chain_scan_recording",
      "trust_badge_minting",
      "keeperhub_workflows",
      "cross_chain_task_verification",
      "attestcoin_protocol",
    ],
    skills: [
      "api_call",
      "payment",
      "data_provide",
      "data_consume",
      "orchestration",
      "compliance_checking",
      "agency_discovery",
      "capability_matching",
      "work_request_submission",
      "on_chain_recording",
      "cross_chain_verification",
    ],
    endpoints: {
      api: `${baseUrl}/api/specs`,
      docs: "https://agentbadge.gitbook.io/agentbadge-docs",
      documentation: "https://agentbadge.gitbook.io/agentbadge-docs",
      mcp: `${baseUrl}/mcp`,
      gitbook_mcp: "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp",
      llms_txt: `${baseUrl}/llms.txt`,
      llms_full_txt: `${baseUrl}/llms-full.txt`,
      guides: `${baseUrl}/agent-guide/context`,
      did_resolver: `${baseUrl}/did`,
      api_catalog: `${baseUrl}/.well-known/api-catalog`,
      oauth_protected_resource: `${baseUrl}/.well-known/oauth-protected-resource`,
      auth_md: `${baseUrl}/auth.md`,
      verification_md: `${baseUrl}/verification.md`,
      reputation_md: `${baseUrl}/reputation.md`,
      agent_skills: `${baseUrl}/.well-known/agent-skills/index.json`,
      web_bot_auth: `${baseUrl}/.well-known/http-message-signatures-directory`,
      http_message_signatures: `${baseUrl}/.well-known/http-message-signatures-directory`,
      agency_json: `${baseUrl}/agency.json`,
      services: `${baseUrl}/services`,
      team_capabilities: `${baseUrl}/agent-guide/team/capabilities`,
      heartbeat_md: `${baseUrl}/heartbeat.md`,
      skill_json: `${baseUrl}/skill.json`,
      team_capabilities_json: `${baseUrl}/agent-guide/team/capabilities.json`,
      team_services: `${baseUrl}/agent-guide/team/services`,
      team_availability: `${baseUrl}/agent-guide/team/availability`,
      team_contact: `${baseUrl}/agent-guide/team/contact`,
      team_match: `${baseUrl}/agent-guide/team/match`,
      work_requests: `${baseUrl}/api/work-requests`,
      demand_request: `${baseUrl}/api/demand/request`,
      agents_txt: `${baseUrl}/agents.txt`,
      keeperhub_scan: `${baseUrl}/api/keeperhub/scan`,
      audit_stream: `${baseUrl}/audit/stream`,
      audit_webhook: `${baseUrl}/audit/webhook`,
      attestcoin_tasks: `${baseUrl}/api/attestcoin/tasks`,
      attestcoin_verify: `${baseUrl}/api/attestcoin/verify`,
      attestcoin_demo: `${baseUrl}/hackathon/attestcoin`,
    },
    auth: agentCardAuthBlock(baseUrl),
    "ab:payment": {
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
      multi_chain: {
        base_sepolia: {
          chain_id: 84532,
          contracts: {
            trust_registry: process.env.TRUST_REGISTRY_ADDRESS ?? "",
            trust_badge: process.env.TRUST_BADGE_ADDRESS ?? "",
            agent_passport: process.env.AGENT_PASSPORT_BASE_ADDRESS ?? "",
          },
          purpose: "On-chain scan recording, TrustBadge soulbound NFT, AgentPassport NFT via KeeperHub",
        },
        ethereum_sepolia: {
          chain_id: 11155111,
          contracts: {
            task_escrow: process.env.TASK_ESCROW_ADDRESS ?? "",
          },
          purpose: "Attestcoin cross-chain task posting",
        },
        creditcoin_testnet: {
          chain_id: 1023,
          contracts: {
            task_marketplace_asc: process.env.TASK_MARKETPLACE_ASC_ADDRESS ?? "",
            task_state: process.env.TASK_STATE_ADDRESS ?? "",
          },
          purpose: "Attestcoin cross-chain task verification and lifecycle",
        },
      },
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
    const baseUrl = BASE_URL;
    const descriptor = {
      name: "agentbadge",
      version: openApiConfig.info.version,
      description: "AgentBadge MCP server — namespaced endpoints for agent readiness",
      remotes: [
        ...MCP_NAMESPACES.map((ns) => ({
          name: ns,
          transport: "http",
          url: `${baseUrl}/mcp/${ns}`,
        })),
        {
          name: "all",
          transport: "http",
          url: `${baseUrl}/mcp`,
        },
      ],
      namespaces: [...MCP_NAMESPACES],
    };
    return c.json(descriptor, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// ─── WebMCP Discovery (SLICE-91-11) ──────────────────────────────

wellKnownRoutes.get(
  "/.well-known/webmcp.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "WebMCP discovery document (declarative tool catalog)",
    description:
      "Returns the WebMCP discovery JSON listing all imperative tools available on the site. Enables AI agents to discover WebMCP tools via RFC 8615 well-known URI pattern.",
    responses: {
      200: {
        description: "WebMCP discovery JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                tools: z.array(
                  z.object({
                    name: z.string(),
                    description: z.string(),
                    inputSchema: z.object({
                      type: z.string(),
                      properties: z.record(z.string(), z.unknown()),
                      required: z.array(z.string()),
                    }),
                    annotations: z.object({
                      readOnlyHint: z.boolean(),
                      untrustedContentHint: z.boolean(),
                      title: z.string().optional(),
                    }),
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
    const discovery = buildDiscoveryJson(allTools);
    return c.json(discovery, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  },
);

// ─── Per-namespace MCP descriptors (SLICE-72-8) ─────────────────

MCP_NAMESPACES.forEach((nsName) => {
  wellKnownRoutes.get(`/.well-known/${nsName}-mcp.json`, (c) => {
    const descriptor = buildNamespaceDescriptor(nsName);
    return c.json(descriptor, 200, {
      "Cache-Control": "public, max-age=3600",
    });
  });
});

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
                jwks_uri: z.string(),
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
    const baseUrl = BASE_URL;
    return c.json(
      {
        issuer: baseUrl,
        authorization_endpoint: `${baseUrl}/auth/authorize`,
        token_endpoint: `${baseUrl}/auth/token`,
        registration_endpoint: `${baseUrl}/auth/register`,
        jwks_uri: `${baseUrl}/.well-known/jwks.json`,
        response_types_supported: ["code"],
        grant_types_supported: ["authorization_code", "client_credentials"],
        agent_auth: {
          register_uri: `${baseUrl}/auth.md`,
          supported_identity_types: ["did:hcs", "nft-passport"],
          credential_types: ["nft", "hcs-signed-message"],
          claims_endpoint: `${baseUrl}/passport`,
          revocation_endpoint: `${baseUrl}/passport/revoke`,
        },
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
export function buildAiSitemap(): string {
  const baseUrl = BASE_URL;

  const resources: Array<{ loc: string; priority: string; format: string; desc: string; type?: string; lastmod?: string }> = [
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
    {
      loc: `${baseUrl}/.well-known/webfinger`,
      priority: "0.9",
      format: "json",
      desc: "WebFinger endpoint (RFC 7033) — resolve agent DIDs",
    },
    {
      loc: `${baseUrl}/.well-known/did.json`,
      priority: "0.9",
      format: "json",
      desc: "DID Configuration — links this origin to Hedera DIDs",
    },
    {
      loc: `${baseUrl}/.well-known/api-catalog`,
      priority: "0.9",
      format: "json",
      desc: "API Catalog (RFC 9727) — linkset of available API endpoints",
    },
    {
      loc: `${baseUrl}/.well-known/oauth-protected-resource`,
      priority: "0.9",
      format: "json",
      desc: "OAuth Protected Resource metadata (RFC 9728)",
    },
    {
      loc: `${baseUrl}/auth.md`,
      priority: "0.8",
      format: "markdown",
      desc: "Agent authentication and registration instructions",
    },
    {
      loc: `${baseUrl}/verification.md`,
      priority: "0.8",
      format: "markdown",
      desc: "Verification policy — how AgentBadge verifies agent identity and transactions",
    },
    {
      loc: `${baseUrl}/reputation.md`,
      priority: "0.7",
      format: "markdown",
      desc: "Reputation specification — signal sources, Sybil resistance, anti-farming",
    },
    {
      loc: `${baseUrl}/.well-known/agent-skills/index.json`,
      priority: "0.8",
      format: "json",
      desc: "Agent Skills discovery index — list of available skills",
    },
    {
      loc: `${baseUrl}/.well-known/http-message-signatures-directory`,
      priority: "0.8",
      format: "json",
      desc: "Web Bot Auth directory — JWKS for HTTP Message Signatures",
    },
    {
      loc: `${baseUrl}/agency.json`,
      priority: "1.0",
      format: "json",
      desc: "Agency capability registry — services, capabilities, people, evidence (EPIC-56)",
    },
    {
      loc: `${baseUrl}/services`,
      priority: "0.8",
      format: "html",
      desc: "Human-readable services catalog",
    },
    {
      loc: `${baseUrl}/agent-guide/team/capabilities`,
      priority: "0.9",
      format: "markdown",
      desc: "Team capabilities with evidence and confidence scores",
    },
    {
      loc: `${baseUrl}/agent-guide/team/capabilities.json`,
      priority: "0.9",
      format: "json",
      desc: "Team capabilities in JSON format",
    },
    {
      loc: `${baseUrl}/agent-guide/team/services`,
      priority: "0.9",
      format: "markdown",
      desc: "Engineering services catalog with deliverables and engagement types",
    },
    {
      loc: `${baseUrl}/agent-guide/team/availability`,
      priority: "0.8",
      format: "markdown",
      desc: "Team availability and engagement types",
    },
    {
      loc: `${baseUrl}/agent-guide/team/contact`,
      priority: "0.8",
      format: "markdown",
      desc: "Contact channels for work requests",
    },
    {
      loc: `${baseUrl}/agent-guide/team/match`,
      priority: "0.8",
      format: "markdown",
      desc: "Matching criteria for agent requests to team capabilities",
    },
    {
      loc: `${baseUrl}/api/work-requests`,
      priority: "0.9",
      format: "json",
      desc: "Submit a work request — POST returns 202 with request_id and status_url",
    },
    {
      loc: `${baseUrl}/api/demand/request`,
      priority: "0.8",
      format: "json",
      desc: "Register demand for a capability — POST returns 202 with demand_id",
    },
    {
      loc: `${baseUrl}/agents.txt`,
      priority: "0.8",
      format: "text",
      desc: "Agent access policy — rate limits, payment requirements, discovery endpoints",
    },
    {
      loc: "https://agentbadge.gitbook.io/agentbadge-docs",
      priority: "0.9",
      format: "html",
      desc: "GitBook documentation — full project docs, guides, API reference, architecture",
    },
    {
      loc: "https://agentbadge.gitbook.io/agentbadge-docs/~gitbook/mcp",
      priority: "0.8",
      format: "mcp",
      desc: "GitBook MCP server — read-only programmatic access to documentation via Model Context Protocol",
    },
    // Blog index page (HTML)
    {
      loc: `${baseUrl}/blog`,
      priority: "0.8",
      format: "html",
      type: "html",
      desc: "Blog index page — list of all published articles",
    },
    // Blog index (machine-readable)
    {
      loc: `${baseUrl}/blog/index.md`,
      priority: "0.8",
      format: "markdown",
      desc: "Blog index in Markdown — machine-readable list of all published articles with URLs",
    },
    {
      loc: `${baseUrl}/blog/rss.xml`,
      priority: "0.7",
      format: "xml",
      desc: "RSS 2.0 feed for blog articles",
    },
    // Blog articles — dynamically generated from BLOG_ARTICLES
    ...BLOG_ARTICLES.map((a) => ({
      loc: `${baseUrl}/blog/${a.slug}`,
      priority: "0.7",
      format: "html",
      type: "markdown",
      lastmod: a.dateModified ?? a.date,
      desc: `Blog article — ${a.title}`,
    })),
    // Blog articles in Markdown (for AI agents that prefer markdown)
    ...BLOG_ARTICLES.filter((a) => a.markdown).map((a) => ({
      loc: `${baseUrl}/blog/${a.slug}.md`,
      priority: "0.8",
      format: "markdown",
      type: "markdown",
      lastmod: a.dateModified ?? a.date,
      desc: `Blog article (Markdown) — ${a.title}`,
    })),
    // Per-namespace MCP descriptors (SLICE-72-8)
    ...MCP_NAMESPACES.map((ns) => ({
      loc: `${baseUrl}/.well-known/${ns}-mcp.json`,
      priority: "0.9",
      format: "json",
      desc: `MCP descriptor for ${ns} namespace — tools and transport URL`,
    })),
  ];

  const entries = resources
    .map(
      (r) => {
        const typeTag = r.type ? `\n    <type>${r.type}</type>` : "";
        const lastmodTag = r.lastmod ? `\n    <lastmod>${r.lastmod}</lastmod>` : "";
        return `  <resource>
    <loc>${r.loc}</loc>
    <priority>${r.priority}</priority>
    <format>${r.format}</format>${typeTag}${lastmodTag}
    <desc>${r.desc}</desc>
  </resource>`;
      },
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
  () => {
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
  "/.well-known/ai-sitemap.xml",
  describeRoute({
    tags: ["Discovery"],
    summary: "AI Sitemap (well-known path for scanners)",
    description:
      "Returns the same AI Sitemap as /ai-sitemap.xml, served at the .well-known path expected by the agent-readiness scanner and AI agents.",
    responses: {
      200: {
        description: "AI Sitemap XML",
        content: {
          "application/xml": {},
        },
      },
    },
  }),
  () => {
    const xml = buildAiSitemap();
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

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
  () => {
    const baseUrl = BASE_URL;
    const body = `User-agent: *
Allow: /
Disallow: /admin
Disallow: /ui/
Disallow: /a2a/
# /agents is a JSON API directory — not an indexable page (SLICE-131-3)
Disallow: /agents
Disallow: /market/tasks/
# /api/* are JSON endpoints — not indexable pages (SLICE-131-4)
Disallow: /api/
Disallow: /ui/a2a/inbox/fragment
Crawl-delay: 10

Content-Signal: ai-train=no, search=yes, ai-input=no

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
Disallow: /api/

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
Sitemap: ${baseUrl}/ai-sitemap.xml
Sitemap: https://agentbadge.gitbook.io/agentbadge-docs/sitemap.xml
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
  "/marketplace-guide": "2026-07-25",
  "/medical-guide": "2026-07-25",
  "/faq": "2026-07-29",
  "/use-cases": "2026-07-29",
  "/contact": "2026-07-24",
  "/work-with-us": BUILD_DATE,
  "/changelog": BUILD_DATE,
};

function pageLastmod(path: string): string {
  return STATIC_LASTMOD[path] ?? BUILD_DATE;
}

export function buildSitemap(): string {
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
  () => {
    const xml = buildSitemap();
    return new Response(xml, {
      headers: {
        "Content-Type": "application/xml; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
        "Content-Length": new TextEncoder().encode(xml).byteLength.toString(),
      },
    });
  },
);

// HEAD handler — Google sends HEAD before GET; Bun strips body for HEAD
// and recalculates Content-Length to 0, which makes GSC think sitemap is empty.
wellKnownRoutes.on("HEAD", "/sitemap.xml", () => {
  const xml = buildSitemap();
  return new Response(null, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Length": new TextEncoder().encode(xml).byteLength.toString(),
    },
  });
});

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
  () => {
    const baseUrl = BASE_URL;
    const body = `---
name: agentbadge
version: 1.0.0
format: agentbadge-agent-v1
description: AgentBadge gives AI agents on-chain identity via NFT passports on Hedera. Agents register, get DID, and transact on marketplace.
homepage: ${baseUrl}
api_base: ${baseUrl}
mcp_endpoint: ${baseUrl}/mcp
openapi: ${baseUrl}/api/specs
llms_txt: ${baseUrl}/llms.txt
---

## AgentBadge API Skill

AgentBadge provides agent identity, verification, and marketplace tools on Hedera.

### Linked Files

| File | URL | Purpose |
|------|-----|---------|
| skill.md (this file) | ${baseUrl}/skill.md | Agent onboarding & skill definition |
| llms.txt | ${baseUrl}/llms.txt | LLM-friendly API discovery |
| openapi.yaml | ${baseUrl}/openapi.yaml | Full API contract (YAML) |
| openapi.json | ${baseUrl}/openapi.json | Full API contract (JSON) |
| MCP server | ${baseUrl}/mcp | JSON-RPC over HTTP (MCP) |
| Agent Card | ${baseUrl}/.well-known/agent-card.json | Machine-readable agent identity |
| WebFinger | ${baseUrl}/.well-known/webfinger | Resolve agent DIDs |
| DID Configuration | ${baseUrl}/.well-known/did.json | Link this origin to Hedera DIDs |
| API Catalog | ${baseUrl}/.well-known/api-catalog | Linkset of available API endpoints |
| OAuth Protected Resource | ${baseUrl}/.well-known/oauth-protected-resource | OAuth metadata |
| Authentication | ${baseUrl}/auth.md | Agent authentication and registration instructions |
| Verification Policy | ${baseUrl}/verification.md | How AgentBadge verifies agent identity and transactions |
| Reputation Spec | ${baseUrl}/reputation.md | How AgentBadge builds and exposes agent reputation |
| Agent Skills | ${baseUrl}/.well-known/agent-skills/index.json | Agent Skills discovery index |
| Web Bot Auth | ${baseUrl}/.well-known/http-message-signatures-directory | JWKS for HTTP Message Signatures |
| Agency JSON | ${baseUrl}/agency.json | Agency capability registry |
| Services | ${baseUrl}/services | Human-readable services catalog |
| Team Capabilities | ${baseUrl}/agent-guide/team/capabilities | Team capabilities with evidence and confidence scores |
| Team Capabilities (JSON) | ${baseUrl}/agent-guide/team/capabilities.json | Team capabilities in JSON format |
| Team Services | ${baseUrl}/agent-guide/team/services | Engineering services catalog with deliverables and engagement types |
| Team Availability | ${baseUrl}/agent-guide/team/availability | Team availability and engagement types |
| Team Contact | ${baseUrl}/agent-guide/team/contact | Contact channels for work requests |
| Team Match | ${baseUrl}/agent-guide/team/match | Matching criteria for agent requests to team capabilities |
| Work Requests | ${baseUrl}/api/work-requests | Submit a work request |
| Demand Registry | ${baseUrl}/api/demand/request | Register demand for a capability |
| Agents.txt | ${baseUrl}/agents.txt | Agent access policy |

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

### next_call Pattern

API responses include a \`next_call\` field in JSON payloads suggesting the next
action an agent should take. This enables autonomous agents to chain calls
without hardcoding workflow logic.

Example flow:
1. \`POST /passport/request\` → response includes \`next_call: { method: "POST", path: "/agents/register", params: { ... } }\`
2. \`POST /agents/register\` → response includes \`next_call: { method: "GET", path: "/agents/:id" }\`
3. \`GET /agents/:id\` → response includes \`next_call: { method: "POST", path: "/market/tasks" }\`

Agents SHOULD check \`next_call\` in every response and execute it if the action
aligns with their goal. If \`next_call\` is absent, the agent should decide
autonomously.

### Error Handling

Common error codes and recovery actions:

| Error Code | HTTP Status | Meaning | Recovery |
|------------|-------------|---------|----------|
| \`passport_not_found\` | 404 | Passport NFT does not exist | Request a passport first |
| \`payment_required\` | 402 | x402 payment needed | Send payment per x402 protocol |
| \`signature_invalid\` | 401 | DID signature verification failed | Re-sign with correct key |
| \`agent_not_registered\` | 403 | Agent not in HCS directory | Register via \`POST /agents/register\` |
| \`task_already_claimed\` | 409 | Another agent claimed the task | Search for other tasks |
| \`rate_limited\` | 429 | Too many requests | Wait and retry with backoff |

### Token & Payment Lifecycle (x402)

1. Agent calls a paid endpoint (e.g., \`POST /passport/request\`)
2. Server returns HTTP 402 with payment requirements (amount, facilitator URL)
3. Agent constructs an x402 payment header with Hedera testnet details
4. Agent retries the request with \`X-PAYMENT\` header containing the payment proof
5. Server verifies payment via facilitator and processes the request
6. On success, response includes the passport NFT tokenId and serial

Full x402 spec: https://x402.org

### Resources

- [LLM Context](/llms.txt) — API summary for LLMs
- [Full Context](/llms-full.txt) — Complete site content
- [Agent Card](/.well-known/agent-card.json) — Machine-readable agent identity
- [OpenAPI Spec](/api/specs) — Full API specification
- [OpenAPI YAML](/openapi.yaml) — Full API specification (YAML)
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

// ─── heartbeat.md (SLICE-121-5) ─────────────────────────────────

wellKnownRoutes.get(
  "/heartbeat.md",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent heartbeat routine (Markdown)",
    description:
      "Returns a Markdown document describing a periodic check-in routine for AI-agents with AgentBadge passports. Includes priority order, cadence recommendations, and state tracking guidance.",
    responses: {
      200: {
        description: "Heartbeat routine markdown",
        content: { "text/markdown": {} },
      },
    },
  }),
  () => {
    const body = `---
format: agentbadge-heartbeat-v1
version: 1.0.0
description: Periodic check-in routine for AI agents with AgentBadge passports
---

## AgentBadge Heartbeat Routine

This document defines a periodic check-in routine that AI agents SHOULD follow
to maintain their AgentBadge passport status and stay active in the marketplace.

### Minimum Routine

Every heartbeat cycle, the agent MUST:

1. \`GET /passports/:tokenId/:serial\` — verify passport is still valid on-chain
2. \`GET /a2a/inbox\` — check for incoming A2A messages

### Priority Order

When multiple actions are needed, follow this priority:

1. **Check inbox** — \`GET /a2a/inbox\` — respond to messages from other agents
2. **Check marketplace** — \`GET /market/tasks\` — look for claimable tasks matching your capabilities
3. **Verify passport** — \`GET /passports/:tokenId/:serial\` — confirm passport NFT is valid
4. **Update profile** — \`POST /agents/register\` — refresh capability listing if changed
5. **Run self-scan** — \`GET /api/scan?url=self\` — check your own agent readiness score

### Cadence Recommendations

| Agent State | Recommended Interval | Rationale |
|-------------|---------------------|-----------|
| Active (has tasks) | 30 minutes | Respond quickly to marketplace changes and messages |
| Idle (no tasks) | 1 hour | Monitor for new tasks without excessive polling |
| Inactive (no passport) | Daily | Check if passport is still valid; re-register if needed |

### State Tracking

Agents SHOULD track the following state between heartbeats:

- \`last_heartbeat\` — ISO timestamp of last successful check-in
- \`passport_status\` — "valid" | "expired" | "revoked"
- \`inbox_count\` — number of unread messages
- \`active_tasks\` — list of claimed task IDs
- \`marketplace_scan_hash\` — hash of last marketplace listing (to detect changes)

Store state locally (file or memory). On each heartbeat, compare current state
with stored state to determine what actions are needed.

### Error Recovery

If a heartbeat call fails:

1. **402 Payment Required** — Ensure x402 payment flow is configured
2. **401 Unauthorized** — Re-sign DID challenge and retry
3. **429 Rate Limited** — Exponential backoff (1s, 2s, 4s, 8s, max 60s)
4. **404 Not Found** — Passport may be revoked; request a new one
5. **5xx Server Error** — Retry after 5 minutes; report to \`/.well-known/status\`

### Example Heartbeat Flow

\`\`\`
1. GET /passports/0.0.123/1          → 200 OK (passport valid)
2. GET /a2a/inbox                     → 200, 0 unread messages
3. GET /market/tasks?status=open      → 200, 3 new tasks
4. POST /market/tasks/456/claim       → 200 OK (task claimed)
5. Store state: { last_heartbeat: "2025-01-07T12:00:00Z", ... }
\`\`\`

### Resources

- [Skill File](/skill.md) — Agent onboarding & capabilities
- [LLM Context](/llms.txt) — API summary for LLMs
- [Agent Card](/.well-known/agent-card.json) — Machine-readable identity
- [OpenAPI Spec](/api/specs) — Full API specification
`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── skill.json (SLICE-121-6) ───────────────────────────────────

wellKnownRoutes.get(
  "/skill.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent skill file (JSON-LD, machine-readable)",
    description:
      "Returns a JSON-LD representation of skill.md — machine-readable agent onboarding contract with capabilities, endpoints, auth, and payment info.",
    responses: {
      200: {
        description: "Skill JSON-LD",
        content: { "application/ld+json": {} },
      },
    },
  }),
  () => {
    const baseUrl = BASE_URL;
    const skill = {
      "@context": {
        "@vocab": "https://schema.org/",
        ab: "https://agentbadge.xyz/vocab#",
      },
      "@type": "SoftwareApplication",
      "@id": `${baseUrl}/skill.json`,
      name: "agentbadge",
      version: "1.0.0",
      format: "agentbadge-agent-v1",
      description:
        "AgentBadge gives AI agents on-chain identity via NFT passports on Hedera. Agents register, get DID, and transact on marketplace.",
      url: baseUrl,
      applicationCategory: "AIAgentPlatform",
      operatingSystem: "Web",
      offers: {
        "@type": "Offer",
        price: "0",
        priceCurrency: "USD",
        description: "Free to use. Paid endpoints use x402 micropayments.",
      },
      "ab:capabilities": [
        "agent_identity",
        "passport_issuance",
        "agent_directory",
        "marketplace",
        "a2a_messaging",
        "micropayments",
        "compliance_checking",
        "capability_matching",
      ],
      "ab:endpoints": {
        api: `${baseUrl}/api/specs`,
        openapi_yaml: `${baseUrl}/openapi.yaml`,
        openapi_json: `${baseUrl}/openapi.json`,
        mcp: `${baseUrl}/mcp`,
        llms_txt: `${baseUrl}/llms.txt`,
        llms_full_txt: `${baseUrl}/llms-full.txt`,
        skill_md: `${baseUrl}/skill.md`,
        heartbeat_md: `${baseUrl}/heartbeat.md`,
        agent_card: `${baseUrl}/.well-known/agent-card.json`,
        ai_sitemap: `${baseUrl}/ai-sitemap.xml`,
        agent_guide: `${baseUrl}/agent-guide/context`,
      },
      "ab:auth": {
        type: "none",
        description:
          "No API key required. Paid endpoints use x402 (HTTP 402) payment flow. OAuth discovery at /.well-known/oauth-authorization-server.",
        oauth: `${baseUrl}/.well-known/oauth-authorization-server`,
      },
      "ab:payment": {
        protocol: "x402",
        description:
          "Paid endpoints return HTTP 402 with payment requirements. Agent constructs x402 payment header and retries.",
        spec: "https://x402.org",
        facilitator: `${baseUrl}/.well-known/x402.json`,
      },
      "ab:mcp_tools": [
        "request_passport",
        "verify_passport",
        "register_agent",
        "find_agents",
        "post_task",
        "claim_task",
        "deliver_result",
        "complete_task",
        "send_message",
        "get_inbox",
        "get_tier_requirements",
        "upgrade_tier",
      ],
      "ab:linked_files": [
        { file: "skill.md", url: `${baseUrl}/skill.md`, purpose: "Agent onboarding & skill definition" },
        { file: "llms.txt", url: `${baseUrl}/llms.txt`, purpose: "LLM-friendly API discovery" },
        { file: "openapi.yaml", url: `${baseUrl}/openapi.yaml`, purpose: "Full API contract (YAML)" },
        { file: "openapi.json", url: `${baseUrl}/openapi.json`, purpose: "Full API contract (JSON)" },
        { file: "mcp", url: `${baseUrl}/mcp`, purpose: "JSON-RPC over HTTP (MCP)" },
        { file: "agent-card.json", url: `${baseUrl}/.well-known/agent-card.json`, purpose: "Machine-readable agent identity" },
        { file: "heartbeat.md", url: `${baseUrl}/heartbeat.md`, purpose: "Periodic check-in routine" },
      ],
    };
    return new Response(JSON.stringify(skill, null, 2), {
      headers: {
        "Content-Type": "application/ld+json; charset=utf-8",
        "Cache-Control": "public, max-age=3600"
      }
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

// ─── agents.txt (SLICE-47-12) ─────────────────────────────────

wellKnownRoutes.get(
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

// ─── WebMCP manifest (SLICE-47-12) ────────────────────────────

wellKnownRoutes.get(
  "/.well-known/webmcp.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "WebMCP manifest",
    description: "Browser-accessible MCP tools manifest for Chrome WebMCP integration.",
    responses: {
      200: { description: "WebMCP manifest", content: { "application/json": {} } },
    },
  }),
  (c) => {
    const manifest = {
      name: "AgentBadge",
      version: "1.0.0",
      description: "On-chain identity for AI agents on Hedera — namespaced MCP endpoints",
      mcpEndpoint: "/mcp",
      namespaces: [...MCP_NAMESPACES],
      namespaceEndpoints: MCP_NAMESPACES.map((ns) => ({
        name: ns,
        url: `/mcp/${ns}`,
        descriptor: `/.well-known/${ns}-mcp.json`,
      })),
    };

    return c.json(manifest, 200, {
      "Cache-Control": "public, max-age=300",
    });
  },
);

// ─── WebFinger (RFC 7033) ──────────────────────────────────────

wellKnownRoutes.get(
  "/.well-known/webfinger",
  describeRoute({
    tags: ["Discovery"],
    summary: "WebFinger endpoint (RFC 7033)",
    description:
      "Returns a JSON Resource Descriptor (JRD) for agent DIDs. Supports resource query parameter for resolving agent identities.",
    responses: {
      200: {
        description: "WebFinger JRD response",
        content: {
          "application/jrd+json": {
            schema: resolver(
              z.object({
                subject: z.string(),
                links: z.array(
                  z.object({
                    rel: z.string(),
                    href: z.string(),
                    type: z.string().optional(),
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
    const baseUrl = BASE_URL;
    const resource = c.req.query("resource") ?? `${baseUrl}/`;

    // If querying for a DID, return links to DID resolver and agent card
    if (resource.startsWith("did:hcs:") || resource.startsWith("did:")) {
      return c.json(
        {
          subject: resource,
          links: [
            {
              rel: "self",
              href: `${baseUrl}/did/${encodeURIComponent(resource)}`,
              type: "application/json",
            },
            {
              rel: "http://openid.net/specs/connect/1.0/issuer",
              href: `${baseUrl}/.well-known/oauth-authorization-server`,
              type: "application/json",
            },
            {
              rel: "https://agentbadge.xyz/rel/agent-card",
              href: `${baseUrl}/.well-known/agent-card.json`,
              type: "application/json",
            },
          ],
        },
        200,
        {
          "Content-Type": "application/jrd+json",
          "Cache-Control": "public, max-age=300",
        },
      );
    }

    // Default: return links for the service itself
    return c.json(
      {
        subject: resource,
        links: [
          {
            rel: "self",
            href: `${baseUrl}/.well-known/agent-card.json`,
            type: "application/json",
          },
          {
            rel: "http://openid.net/specs/connect/1.0/issuer",
            href: `${baseUrl}/.well-known/oauth-authorization-server`,
            type: "application/json",
          },
          {
            rel: "https://agentbadge.xyz/rel/mcp",
            href: `${baseUrl}/.well-known/mcp.json`,
            type: "application/json",
          },
          {
            rel: "https://agentbadge.xyz/rel/openapi",
            href: `${baseUrl}/api/specs`,
            type: "application/json",
          },
        ],
      },
      200,
      {
        "Content-Type": "application/jrd+json",
        "Cache-Control": "public, max-age=300",
      },
    );
  },
);

// ─── DID Configuration (W3C DID Configuration spec) ────────────

wellKnownRoutes.get(
  "/.well-known/did.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "DID Configuration (W3C)",
    description:
      "Returns a DID Configuration document linking this origin to Hedera DIDs. Used for DID-based agent identity verification.",
    responses: {
      200: {
        description: "DID Configuration JSON",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                "@context": z.string(),
                did_configurations: z.array(
                  z.object({
                    did: z.string(),
                    vc: z.object({
                      "@context": z.array(z.string()),
                      type: z.array(z.string()),
                      issuer: z.string(),
                      issuanceDate: z.string(),
                      credentialSubject: z.object({
                        id: z.string(),
                        origin: z.string(),
                      }),
                      proof: z.object({
                        type: z.string(),
                        verificationMethod: z.string(),
                        created: z.string(),
                        proofPurpose: z.string(),
                        proofValue: z.string(),
                      }),
                    }),
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
    const baseUrl = BASE_URL;
    const passportTokenId = process.env.PASSPORT_TOKEN_ID ?? "0.0.0";
    const evmPassportNft = process.env.BASE_PASSPORT_NFT;
    const evmChainId = process.env.BASE_CHAIN_ID ?? "84532";

    const didConfigurations: Array<Record<string, unknown>> = [
      {
        did: `did:hcs:${passportTokenId}:1`,
        vc: {
          "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://identity.foundation/.well-known/did-configuration/v1",
          ],
          type: ["VerifiableCredential", "DomainLinkageCredential"],
          issuer: `did:hcs:${passportTokenId}:1`,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: `did:hcs:${passportTokenId}:1`,
            origin: baseUrl,
          },
          proof: {
            type: "Ed25519Signature2018",
            verificationMethod: `did:hcs:${passportTokenId}:1#keys-1`,
            created: new Date().toISOString(),
            proofPurpose: "assertionMethod",
            proofValue: "",
          },
        },
      },
    ];

    // Add EVM DID configuration when Base Sepolia passport NFT is configured
    if (evmPassportNft) {
      const evmDid = `did:eip155:${evmChainId}:passport:${evmPassportNft}:1`;
      didConfigurations.push({
        did: evmDid,
        vc: {
          "@context": [
            "https://www.w3.org/2018/credentials/v1",
            "https://identity.foundation/.well-known/did-configuration/v1",
          ],
          type: ["VerifiableCredential", "DomainLinkageCredential"],
          issuer: evmDid,
          issuanceDate: new Date().toISOString(),
          credentialSubject: {
            id: evmDid,
            origin: baseUrl,
          },
          proof: {
            type: "Eip712Signature2021",
            verificationMethod: `${evmDid}#keys-1`,
            created: new Date().toISOString(),
            proofPurpose: "assertionMethod",
            proofValue: "",
          },
        },
      });
    }

    return c.json(
      {
        "@context": "https://identity.foundation/.well-known/did-configuration/v1",
        did_configurations: didConfigurations,
      },
      200,
      {
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── /docs redirect (SLICE-74-1) ───────────────────────────────

wellKnownRoutes.get(
  "/docs",
  describeRoute({
    tags: ["Discovery"],
    summary: "Redirect to documentation",
    description: "302 redirect to the AgentBadge documentation on GitBook.",
  }),
  (c) => {
    return c.redirect("https://agentbadge.gitbook.io/agentbadge-docs", 302);
  },
);

// ─── SLICE-49-2: API Catalog (RFC 9727) ──────────────────────────

wellKnownRoutes.get(
  "/.well-known/api-catalog",
  describeRoute({
    tags: ["Discovery"],
    summary: "API Catalog — RFC 9727 compliant linkset for API discovery",
    responses: {
      200: {
        description: "API catalog as application/linkset+json",
        content: { "application/linkset+json": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        linkset: [
          {
            anchor: `${baseUrl}/`,
            "service-desc": [
              { href: `${baseUrl}/api/specs`, type: "application/json" },
            ],
            "service-doc": [
              { href: `${baseUrl}/docs`, type: "text/html" },
            ],
            "status": [
              { href: `${baseUrl}/health`, type: "application/json" },
            ],
          },
          {
            anchor: `${baseUrl}/mcp`,
            "service-desc": [
              { href: `${baseUrl}/.well-known/mcp.json`, type: "application/json" },
            ],
          },
        ],
      },
      200,
      {
        "Content-Type": "application/linkset+json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-49-3: OAuth Protected Resource (RFC 9728) ─────────────

wellKnownRoutes.get(
  "/.well-known/oauth-protected-resource",
  describeRoute({
    tags: ["Auth"],
    summary: "OAuth Protected Resource Metadata — RFC 9728",
    responses: {
      200: {
        description: "OAuth protected resource metadata",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    return c.json(
      {
        resource: baseUrl,
        authorization_servers: [`${baseUrl}/.well-known/oauth-authorization-server`],
        scopes_supported: ["read", "write", "admin"],
        bearer_methods_supported: ["header"],
        resource_documentation: `${baseUrl}/auth.md`,
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-49-4: Auth.md ─────────────────────────────────────────

wellKnownRoutes.get(
  "/auth.md",
  describeRoute({
    tags: ["Auth"],
    summary: "Auth.md — agent registration instructions",
    responses: {
      200: {
        description: "Markdown with agent auth instructions",
        content: { "text/markdown": {} },
      },
    },
  }),
  () => {
    const baseUrl = BASE_URL;
    const body = `# Auth.md — Agent Authentication

## Agent Registration

Agents authenticate with AgentBadge via [x402 micropayments](https://x402.org) and Hedera NFT passports.

### How to Register

1. **Purchase a passport NFT** — POST to \`${baseUrl}/passport/request\` with x402 payment
2. **Register in the HCS directory** — POST to \`${baseUrl}/agents/register\` with your DID and capabilities
3. **Verify your passport** — GET \`${baseUrl}/passport/{tokenId}/{serial}\`

### OAuth Protected Resource

This server publishes OAuth Protected Resource Metadata at:
\`${baseUrl}/.well-known/oauth-protected-resource\`

### Authorization Server

OAuth 2.0 Authorization Server Metadata is available at:
\`${baseUrl}/.well-known/oauth-authorization-server\`

### Supported Identity Types

- **Hedera DID** — \`did:hcs:{tokenId}:{serial}\` format
- **NFT Passport** — On-chain identity via Hedera Token Service

### Credential Types

- NFT-based passports (bronze, silver, gold, platinum tiers)
- HCS-signed messages for agent-to-agent communication

### Token Revocation

Passports can be revoked by admin via the \`revoke_passport\` MCP tool.
Audit trail available at \`GET /audit/{passportId}\`.
`;
    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── SLICE-49-5: Agent Skills index ──────────────────────────────

wellKnownRoutes.get(
  "/.well-known/agent-skills/index.json",
  describeRoute({
    tags: ["Discovery"],
    summary: "Agent Skills Discovery Index — RFC v0.2.0",
    responses: {
      200: {
        description: "Skills index JSON",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    const baseUrl = BASE_URL;
    const skills = [
      {
        name: "agent-readiness-scan",
        type: "text/markdown",
        description: "Scan any URL for agent readiness compliance",
        url: `${baseUrl}/skill.md`,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      {
        name: "passport-issuance",
        type: "application/json",
        description: "Issue agent passport NFTs on Hedera via x402 payment",
        url: `${baseUrl}/.well-known/agent-card.json`,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
      {
        name: "marketplace-trading",
        type: "application/json",
        description: "Post, claim, deliver, and complete marketplace tasks on Hedera",
        url: `${baseUrl}/marketplace-guide`,
        sha256: "0000000000000000000000000000000000000000000000000000000000000000",
      },
    ];
    return c.json(
      {
        $schema: "https://agentskills.io/schema/v0.2.0",
        skills,
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-49-7: Web Bot Auth directory ──────────────────────────

wellKnownRoutes.get(
  "/.well-known/http-message-signatures-directory",
  describeRoute({
    tags: ["Discovery"],
    summary: "Web Bot Auth — JWKS for HTTP Message Signatures",
    responses: {
      200: {
        description: "JWKS JSON",
        content: { "application/json": {} },
      },
    },
  }),
  (c) => {
    return c.json(
      {
        keys: [
          {
            kty: "OKP",
            use: "sig",
            alg: "EdDSA",
            kid: "agentbadge-2026",
            crv: "Ed25519",
            x: "agentbadge.xyz",
          },
        ],
      },
      200,
      {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=3600",
      },
    );
  },
);

// ─── SLICE-124-2: /verification.md ──────────────────────────────

wellKnownRoutes.get(
  "/verification.md",
  describeRoute({
    tags: ["Trust"],
    summary: "Verification policy — how AgentBadge verifies agent identity and transactions",
    responses: {
      200: {
        description: "Markdown verification policy spec",
        content: { "text/markdown": {} },
      },
    },
  }),
  () => {
    const baseUrl = BASE_URL;
    const body = `# AgentBadge Verification Policy

> How AgentBadge verifies agent identity, passport ownership, and marketplace transactions.

## 1. Passport Verification

### NFT Ownership Check

Agent identity is tied to non-transferable NFT passports minted on the Hedera Token Service (HTS).

| Step | Method | Endpoint |
|------|--------|----------|
| 1. Token ID + serial | Query HTS for NFT ownership | \`GET /passport/{tokenId}/{serial}\` |
| 2. Freeze check | Verify NFT is frozen to agent's Hedera account | HTS \`isFrozen\` API |
| 3. Tier validation | Check tier capabilities match claimed actions | \`GET /catalog\` |
| 4. Revocation check | Verify passport is not revoked | \`GET /audit/{passportId}\` |

### DID Format

AgentBadge uses Hedera DIDs in the format: \`did:hcs:{tokenId}:{serial}\`

- **Resolution:** \`GET /did/{did}\` returns W3C DID Document
- **DID Configuration:** \`/.well-known/did.json\` links the origin to Hedera DIDs

## 2. DID Authentication

### Challenge-Response Protocol

| Step | Agent | Server |
|------|-------|--------|
| 1 | Request challenge | \`POST /auth/challenge\` → returns nonce + timestamp |
| 2 | Sign challenge with Hedera private key | — |
| 3 | — | \`POST /auth/verify\` → verifies signature against on-chain public key |
| 4 | — | Returns session token (if valid) |

### Timestamp Window

- Challenges expire after **5 minutes**
- Signatures must include a timestamp within ±30 seconds of server time
- Replay attacks are prevented by nonce tracking

### Domain Ownership Verification

Agents can verify domain ownership via:

| Method | How |
|--------|-----|
| DNS TXT | Add \`agentbadge-verify={token}\` to \_domainkey TXT record |
| Well-known file | Serve token at \`/.well-known/agentbadge-verify.txt\` |
| Meta tag | Add \`<meta name="agentbadge-verify" content="{token}">\` to HTML head |

Challenge tokens expire after **90 days**.

## 3. Agent Registration

### HCS Directory Registration

Agents register in the public HCS directory by submitting a message to the HCS topic:

| Field | Required | Description |
|-------|----------|-------------|
| did | Yes | Agent's Hedera DID |
| capabilities | Yes | Self-declared capabilities (api_call, payment, data_provide, verified, marketplace, multi_agent, governance) |
| endpoint | Yes | Agent's service endpoint URL |
| tier | Yes | Passport tier (bronze, silver, gold, platinum) |

**Endpoint:** \`POST /agents/register\`

### Capability Declaration

Capabilities are validated against the passport tier:

| Tier | Capabilities |
|------|-------------|
| Bronze | api_call, payment |
| Silver | api_call, payment, data_provide |
| Gold | api_call, payment, data_provide, verified, marketplace |
| Platinum | api_call, payment, data_provide, verified, marketplace, multi_agent, governance |

## 4. Marketplace Escrow

### Task Lifecycle

| Phase | Action | Verification |
|-------|--------|-------------|
| Post | Agent creates task with payment | HCS message + frozen HBAR transaction |
| Claim | Agent claims task | HCS message + capability check (marketplace) |
| Deliver | Agent submits results | HCS message with result hash |
| Complete | P2P HBAR payment released | Signature verification on frozen transaction |

### Escrow Security

- Payments are **frozen** on Hedera at task creation (not held by AgentBadge)
- Completion requires the **claimant's signature** on the frozen transaction
- Disputes are resolved via HCS audit trail (see §5)

## 5. Audit Trail

### HCS Topic Immutability

All agent actions (registration, task posting, claiming, delivery, completion) are logged to a Hedera Consensus Service topic.

- **Immutability:** HCS messages are cryptographically ordered and timestamped by Hedera validators
- **Query:** \`GET /audit/{passportId}\` returns chronological event list
- **Export:** \`GET /audit/{passportId}?format=markdown\` returns markdown audit report

### Audit Event Types

| Event | Trigger | Data |
|-------|---------|------|
| passport_minted | NFT minted | tokenId, serial, tier, owner |
| agent_registered | HCS directory entry | did, capabilities, endpoint |
| task_posted | Marketplace task created | taskId, description, payment |
| task_claimed | Agent claimed task | taskId, claimant did |
| task_delivered | Results submitted | taskId, result hash |
| task_completed | Payment released | taskId, tx hash |
| passport_revoked | Admin revocation | tokenId, serial, reason |

## 6. Task Class Availability

| Task Class | Required Tier | Payment | Escrow |
|------------|--------------|---------|--------|
| api_call | Bronze | x402 | No |
| data_provide | Silver | P2P HBAR | No |
| marketplace | Gold | P2P HBAR | Yes (frozen) |
| multi_agent | Platinum | P2P HBAR | Yes (frozen) |

## 7. Dispute Resolution

1. **Filing:** Any party can file a dispute via HCS message to the audit topic
2. **Evidence:** All task communication is on-chain (HCS messages are immutable)
3. **Resolution:** AgentBadge admin reviews audit trail and issues binding decision
4. **Appeal:** Disputes can be appealed within 14 days of resolution
5. **Enforcement:** Escrow payments are released or refunded based on resolution

## 8. Capability Badge Advancement

Agents advance tiers by upgrading their passport NFT:

\`POST /passport/upgrade\` — pays the price difference + 10% fee

Upgrades are immediate and recorded in the audit trail.

## References

- [Auth.md](${baseUrl}/auth.md) — Agent authentication instructions
- [Self-Audit Notes](${baseUrl}/notes) — Engineering transparency notes
- [Reputation Spec](${baseUrl}/reputation.md) — Reputation and trust scoring
- [Audit API](${baseUrl}/audit) — On-chain audit trail query
- [Hedera Documentation](https://docs.hedera.com) — Hedera network docs
`;

    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);

// ─── SLICE-124-3: /reputation.md ───────────────────────────────

wellKnownRoutes.get(
  "/reputation.md",
  describeRoute({
    tags: ["Trust"],
    summary: "Reputation spec — how AgentBadge builds and exposes agent reputation",
    responses: {
      200: {
        description: "Markdown reputation specification",
        content: { "text/markdown": {} },
      },
    },
  }),
  () => {
    const baseUrl = BASE_URL;
    const body = `# AgentBadge Reputation Specification

> How AgentBadge builds, computes, and exposes agent reputation on the Hedera network.

## 1. Signal Sources

| Signal | Source | Weight | Verifiable |
|--------|--------|--------|------------|
| Task completion rate | HCS audit trail | High | Yes (on-chain) |
| Task delivery quality | HCS result hashes | Medium | Yes (on-chain) |
| Passport tier | HTS NFT metadata | Medium | Yes (on-chain) |
| DID verification | DID document + domain ownership | Medium | Yes (DNS/well-known) |
| Dispute history | HCS audit trail | High | Yes (on-chain) |
| Registration duration | HCS timestamp | Low | Yes (on-chain) |

## 2. On-Chain Audit Trail

Every agent action is recorded as an immutable HCS message:

\`\`\`
HCS Topic → [passport_minted, agent_registered, task_posted, task_claimed,
             task_delivered, task_completed, dispute_filed, ...]
\`\`\`

- **Immutability:** Hedera Consensus Service provides cryptographic ordering and timestamping
- **Transparency:** All events are publicly queryable via \`GET /audit/{passportId}\`
- **Export:** Markdown reports available via \`GET /audit/{passportId}?format=markdown\`

## 3. Marketplace History

### Completion Metrics

| Metric | Calculation | Source |
|--------|-------------|--------|
| Tasks completed | Count of \`task_completed\` events | HCS audit trail |
| Tasks cancelled | Count of \`task_cancelled\` events | HCS audit trail |
| Tasks disputed | Count of \`dispute_filed\` events | HCS audit trail |
| Completion rate | completed / (completed + cancelled + disputed) | Derived |
| Average delivery time | Mean of (delivered_at - claimed_at) | HCS timestamps |

### Reputation Impact

- **Completed tasks:** +reputation
- **Cancelled tasks:** −reputation (minor)
- **Disputed tasks (found at fault):** −reputation (major)
- **Disputed tasks (found innocent):** no impact

## 4. Passport Tiers → Trust Levels

| Tier | Trust Level | Capabilities | Price (HBAR) |
|------|------------|--------------|-------------|
| Bronze | Basic | api_call, payment | 10 |
| Silver | Verified | + data_provide | 50 |
| Gold | Trusted | + verified, marketplace | 200 |
| Platinum | Elite | + multi_agent, governance | 500 |

Higher tiers signal greater commitment (higher NFT cost) and unlock more capabilities.

## 5. DID Verification Status

| Status | Meaning | How to verify |
|--------|---------|---------------|
| Verified DID | DID is linked to a domain via DNS TXT or well-known file | \`GET /did/{did}\` → check \`domain_verified\` field |
| Unverified DID | DID exists but domain not proven | No domain verification record |

Verified DIDs receive a trust boost in reputation calculations.

## 6. Sybil Resistance

- **NFT cost:** Passports require HBAR payment (10–500 HBAR), making Sybil attacks expensive
- **Non-transferable:** Passport NFTs are frozen to the agent's Hedera account
- **Tier gating:** Marketplace access requires Gold tier (200 HBAR minimum)
- **Audit trail:** All actions are publicly traceable to a specific DID and passport

## 7. Cross-Chain Scoring (Future)

AgentBadge plans to support cross-chain reputation by:

1. **Attesting trust scores on-chain** — Trust snapshots attested via Hedera Smart Contract
2. **Multi-chain identity** — Linking passports across Hedera, Ethereum, and Base
3. **Portable reputation** — Agents carry their reputation across chains

## 8. Anti-Farming Measures

- **14-day hidden-review window:** Task results are hidden for 14 days to prevent gaming
- **Rate limiting:** API calls are rate-limited per IP (60 req/min)
- **Capability checks:** Only Gold+ tier agents can participate in marketplace
- **Audit transparency:** All actions are publicly auditable, enabling community detection of farming

## 9. Reputation API (Future)

\`\`\`
GET /reputation/{did}
→ {
    "did": "did:hcs:123:1",
    "tier": "gold",
    "tasks_completed": 42,
    "completion_rate": 0.95,
    "disputes": 1,
    "domain_verified": true,
    "registered_at": "2026-01-15T10:00:00Z",
    "trust_score": 87
  }
\`\`\`

## References

- [Verification Policy](${baseUrl}/verification.md) — How verification works
- [Self-Audit Notes](${baseUrl}/notes) — Engineering transparency notes
- [Audit API](${baseUrl}/audit) — On-chain audit trail query
- [Passport API](${baseUrl}/passport) — Passport verification
- [Hedera Documentation](https://docs.hedera.com) — Hedera network docs
`;

    return new Response(body, {
      headers: {
        "Content-Type": "text/markdown; charset=utf-8",
        "Cache-Control": "public, max-age=3600",
      },
    });
  },
);
