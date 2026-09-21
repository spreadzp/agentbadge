import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { BASE_URL, PUBLIC_PAGES } from "../../lib/page-meta";
import { BUILD_DATE } from "../../lib/build-info";
import { BLOG_ARTICLES } from "../../lib/blog-data";
import { MCP_NAMESPACES } from "./agent-card";

export const sitemapRoutes = new Hono();

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

sitemapRoutes.get(
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

sitemapRoutes.get(
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

sitemapRoutes.get(
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

sitemapRoutes.get(
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
sitemapRoutes.on("HEAD", "/sitemap.xml", () => {
  const xml = buildSitemap();
  return new Response(null, {
    headers: {
      "Content-Type": "application/xml; charset=utf-8",
      "Cache-Control": "public, max-age=3600",
      "Content-Length": new TextEncoder().encode(xml).byteLength.toString(),
    },
  });
});
