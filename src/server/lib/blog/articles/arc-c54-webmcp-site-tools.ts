import type { BlogArticle } from "../../blog-data";
import { arcC54WebmcpSiteToolsContent } from "./arc-c54-webmcp-site-tools.content";

export const article: BlogArticle = {
  slug: "arc-c54-webmcp-site-tools",
  title:
    "Your Website Has a Menu Now: 16 Page-Scoped Tools for AI Agents, Live on WebMCP",
  description:
    "A website can now hand a browser agent a structured menu of tools instead of HTML to scrape. We shipped 16 page-scoped WebMCP tools on production - one shared registry behind three facades (in-tab WebMCP, /mcp/public JSON-RPC, plain REST), honest async submit/poll into the ops inbox, and a consent-gated public QA corpus. External verification found two real bugs, both fixed.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-19",
  dateModified: "2026-11-19",
  tags: [
    "webmcp",
    "mcp",
    "site-tools",
    "agent-readiness",
    "request-inbox",
    "qa-corpus",
    "epic-256",
  ],
  readingTime: "9 min",
  shortAnswer:
    "WebMCP is a W3C draft - already documented by OpenAI as Site tools and shipping in Chrome 146+ behind an Origin Trial - that lets a page register typed tools into document.modelContext: the page itself hands an agent a menu, so it stops scraping. We put it on production: agentbadge.xyz exposes 16 tools from one shared registry across three facades (WebMCP in-tab, /mcp/public JSON-RPC, plain REST), page-scoped so a scanner-page agent sees scanner tools only. One write action - submit-request - posts into the ops inbox; poll-request returns honest async states; consented answers materialize into a public QA corpus that search-agent-qa can hit instantly. Live Chrome-OT verification found two shipped bugs - a publicly cacheable submitted poll body and a pg/json codec that 500'd on top-level string writes - both fixed and regression-tested.",
  heroImage: "/images/blog/arc-c54-webmcp-site-tools-hero.webp",
  ogImage: "/images/blog/arc-c54-webmcp-site-tools-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Postgres",
    "Prisma",
    "WebMCP",
    "MCP",
    "JSON-RPC",
  ],
  entities: [
    "agent-request",
    "agent-qa-pair",
    "agent-survey",
    "page-toolsets",
    "epic-256",
    "epic-249",
  ],
  concepts: [
    "page-scoped-tools",
    "one-registry-three-facades",
    "honest-async",
    "consent-gated-qa",
    "next-call-contract",
    "idempotent-submit",
    "rest-source-of-truth",
    "external-agent-verification",
  ],
  topics: [
    "webmcp",
    "mcp",
    "site-tools",
    "agent-readiness",
    "api",
  ],
  capabilities: [
    "webmcp-tool-discovery",
    "mcp-public-tools-list",
    "inbox-submit-poll",
    "qa-corpus-search",
    "consent-gated-publish",
    "idempotent-request-intake",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c54-webmcp-site-tools.md",
    },
    {
      type: "read",
      label: "Machine-readable tool inventory (16 tools)",
      url: "https://agentbadge.xyz/.well-known/webmcp.json",
    },
    {
      type: "read",
      label: "Unauthenticated probe: JSON-RPC tools/list",
      url: "https://agentbadge.xyz/mcp/public",
    },
    {
      type: "read",
      label: "Live public QA corpus",
      url: "https://agentbadge.xyz/api/requests/qa?q=agent",
    },
    {
      type: "read",
      label: "Previous article: FinOps control room",
      url: "https://agentbadge.xyz/blog/arc-c53-finops-control-room",
    },
  ],
  qa: [
    {
      question: "What is WebMCP and why does it matter for a website?",
      answer:
        "WebMCP is a W3C community draft that lets a page register JavaScript functions - name, description, JSON schema - into document.modelContext, so any WebMCP-aware agent can list and call them with structured arguments. OpenAI documented it as Site tools for the built-in browser in the ChatGPT desktop app, and Chrome 146+ runs it behind an Origin Trial. For a website it means agents stop scraping HTML and start calling typed tools - no API key, no SDK, no parsing.",
    },
    {
      question: "How do the 16 AgentBadge tools stay organized per page?",
      answer:
        "One shared registry defines all tools; PAGE_TOOLSETS maps each page to the subset it exposes. document.modelContext.getTools() on / returns the full 16; scoped pages like scanner or market return focused shelves. The same registry feeds the WebMCP in-tab surface, the /mcp/public JSON-RPC endpoint, and .well-known/webmcp.json - REST remains the source of truth underneath.",
    },
    {
      question: "How does an agent submit a question and get an ops answer?",
      answer:
        "submit-request posts a question into the ops inbox and returns a request_id - deliberately async. poll-request returns submitted with retry_after and an honest reason until an ops human answers; then it returns completed with response.answer and a next_call pointing at search-agent-qa. Identical arguments in one session idempotently map to the same request_id (duplicate:true); resubmits across sessions hit a structured http_429 that names its own retry_at.",
    },
    {
      question: "How does the public QA corpus handle consent and retraction?",
      answer:
        "publish_to_qa defaults to false - questions and answers stay private unless the asker opted in. When consent is true and an ops answer exists and the request is not spam-flagged, completing the request materializes a qa_* pair into the public corpus that search-agent-qa reads; a uses counter ticks per hit. Ops can retract a pair idempotently at any time and it drops out of search and matching.",
    },
    {
      question: "What did live production verification find?",
      answer:
        "Two shipped bugs, both fixed. First: the shared cache middleware stamped public,max-age=60 on pollable inbox GETs, so a browser could serve a stale submitted body after ops answered - inbox routes moved to Cache-Control:no-store (commit 54cc6d9). Second: a top-level JSON string written to a json column 500'd on read because the driver pre-parses json and the pg/json codec calls JSON.parse again - writes are now coerced to {answer}/{question} objects at the edge (commit 4119016), with regression tests.",
    },
  ],
  claims: [
    {
      id: "c54-webmcp-sixteen-tools-live",
      status: "VERIFIED",
      text: "agentbadge.xyz exposes 16 tools through one shared registry across three facades - WebMCP via document.modelContext (Chrome OT), POST /mcp/public JSON-RPC, and REST - verified live: tools/list returns 16 and .well-known/webmcp.json lists the same inventory.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/.well-known/webmcp.json",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/packages/webmcp/src/registry.ts",
        },
      ],
    },
    {
      id: "c54-page-scoped-toolsets",
      status: "VERIFIED",
      text: "Tool exposure is page-scoped: PAGE_TOOLSETS in the shared registry maps each page to its shelf, so getTools() returns the full 16 on / and focused subsets on scanner/market/verify/agent-guide pages.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/packages/webmcp/src/registry.ts",
        },
      ],
    },
    {
      id: "c54-honest-async-inbox",
      status: "VERIFIED",
      text: "submit-request returns a request_id and poll-request reports honest states (submitted with retry_after, completed with response.answer plus a next_call to search-agent-qa); verified end-to-end on production through the WebMCP tool itself on request rq_3a672b4dc61749b08d4df706b021b895.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/request-inbox/intake.ts",
        },
      ],
    },
    {
      id: "c54-consent-gated-qa-corpus",
      status: "VERIFIED",
      text: "publish_to_qa defaults to false; completing a consented, answered request materializes a qa_* pair into the public corpus searchable via search-agent-qa and GET /api/requests/qa - live corpus verified, retract is idempotent.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/api/requests/qa?q=agent",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/packages/database",
        },
      ],
    },
    {
      id: "c54-two-live-bugs-fixed",
      status: "VERIFIED",
      text: "Production verification found two shipped bugs: pollable inbox endpoints were publicly cacheable (submitted could be served stale after completion - fixed with Cache-Control:no-store on the inbox route family, commit 54cc6d9) and top-level JSON strings written to json columns 500'd on read via a double JSON.parse in pg/json (fixed by coercing response/payload strings to objects at the write edge, commit 4119016, with regression tests).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/routes/agent-requests/agent-requests-ops-api.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC54WebmcpSiteToolsContent,
};
