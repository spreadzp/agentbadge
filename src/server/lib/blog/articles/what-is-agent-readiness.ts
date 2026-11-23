import type { BlogArticle } from "../../blog-data";
import { whatIsAgentReadinessContentA } from "./what-is-agent-readiness.content-a";
import { whatIsAgentReadinessContentB } from "./what-is-agent-readiness.content-b";

export const article: BlogArticle =
{
  slug: "what-is-agent-readiness",
  title: "What Is Agent Readiness?",
  description:
    "Agent Readiness is the ability of your API to be discovered, understood, and used by an AI agent — without a human intervening. SEO for the agentic web.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-08-14",
  dateModified: "2026-08-14",
  canonical: "/what-is-agent-readiness",
  agentGuideSlug: "what-is-agent-readiness",
  heroImage: "/images/blog/what-is-agent-readiness-hero.webp",
  ogImage: "/images/blog/what-is-agent-readiness-og.jpeg",
  shortAnswer: "Agent Readiness is the ability of your API to be discovered, understood, and used by an AI agent without human intervention. It extends SEO principles to machine-readable interfaces — OpenAPI, MCP, llms.txt, and structured discovery layers that let agents navigate your service autonomously.",
  tags: ["agent-readiness", "seo", "aeo", "agentic-web", "api"],
  rules: ["AB-004"],
  claims: [
    {
      id: "claim-1",
      text: "AgentBadge runs a live agent-readiness scanner that measures these dimensions on this site — results published at /agent-readiness.",
      status: "VERIFIED",
      evidence: [
        { type: "demo", url: "https://agentbadge.xyz/agent-readiness.json" },
      ],
    },
  ],
  readingTime: "15 min",
  content: whatIsAgentReadinessContentA + whatIsAgentReadinessContentB,
  externalLinks: [
    {
      platform: "devto",
      url: "https://dev.to/spread2009/what-is-agent-readiness-1b59",
    },
    {
      platform: "medium",
      url: "https://paulspread-99907.medium.com/what-is-agent-readiness-agentbadge-blog-agentbadge-6661bd18750a",
    },
    {
      platform: "linkedin",
      url: "https://www.linkedin.com/posts/paul-spread-bb337b63_ai-api-aiagents-share-7494045030396039169-QbUp/",
    },
    {
      platform: "hackernews",
      url: "https://news.ycombinator.com/item?id=49361630",
    },
    {
      platform: "twitter",
      url: "https://x.com/paul_spread/status/2088268170003907062",
    },
    {
      platform: "velog",
      url: "https://velog.io/@buidl_25/What-Is-Agent-Readiness-エージェント対応度とは",
    },
    {
      platform: "hsoub",
      url: "https://io.hsoub.com/artificial_intelligence/185154-ما-هي-جاهزية-الوكلاء-agent-readiness",
    },
  ],
  relatedLinks: [
    { label: "FAQ", href: "/faq", description: "Common questions about agent readiness" },
    { label: "Agent Guide", href: "/what-is-agent-readiness", description: "Step-by-step guide to becoming agent-ready" },
    { label: "Run a Scan", href: "/services/scanner", description: "Check your API's agent readiness score" },
  ],
};
