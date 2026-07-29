/**
 * Well-known routes — Agent Card + AI Sitemap
 *
 * SLICE-17-1: GET /.well-known/agent-card.json
 * SLICE-17-9: GET /ai-sitemap.xml
 * SLICE-18-3: GET /robots.txt, GET /sitemap.xml
 */

import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import z from "zod";
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
      guides: `${baseUrl}/agent-guide`,
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
      loc: `${baseUrl}/agent-guide`,
      priority: "0.9",
      format: "markdown",
      desc: "Agent onboarding guide: passport, directory, marketplace",
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
    summary: "robots.txt — crawler directives",
    description:
      "Returns robots.txt with allow rules for major crawlers (GPTBot, ClaudeBot, PerplexityBot, Google-Extended) and disallow for admin/internal paths.",
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

User-agent: GPTBot
Allow: /

User-agent: ClaudeBot
Allow: /

User-agent: PerplexityBot
Allow: /

User-agent: Google-Extended
Allow: /

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
