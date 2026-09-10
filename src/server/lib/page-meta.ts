import { RULE_DESCRIPTIONS } from "../../agent-readiness/rule-descriptions";
import { BLOG_ARTICLES } from "./blog-data";

export interface PageMeta {
  title: string;
  description: string;
  path: string;
  ogImage?: string;
  ogType?: string;
  articleAuthor?: string;
  articlePublishedTime?: string;
  articleModifiedTime?: string;
  ogImageAlt?: string;
  markdownUrl?: string;
  jsonUrl?: string;
  rssUrl?: string;
  prevRel?: string;
  nextRel?: string;
}

export const SITE_NAME = "AgentBadge";

/**
 * Centralized title composer — produces `${unique} | AgentBadge`.
 * Deduplicates brand if unique part already contains it.
 * Caps unique part at 60 chars to keep total ≤ 72.
 */
export function pageTitle(unique: string): string {
  if (!unique || unique.trim().length === 0) {
    return `${SITE_NAME} — Agency for the Agentic Web`;
  }
  // Strip existing brand suffixes and inline brand from the unique part
  const cleaned = unique
    .replace(/\s*[—|-]\s*AgentBadge\s*$/i, "")
    .replace(/\s*AgentBadge\s*$/i, "")
    .replace(/\s*—\s*AgentBadge\s*/gi, " ")
    .replace(/\s*AgentBadge\s*/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  const truncated = cleaned.length > 57 ? cleaned.slice(0, 54) + "..." : cleaned;
  return `${truncated} | ${SITE_NAME}`;
}

export const SITE_DESCRIPTION =
  "AgentBadge — scan your API or website with 145+ deterministic agent readiness checks. Get evidence-based scores, actionable fixes, and an AgentBadge readiness score.";

export const BASE_URL =
  process.env.BASE_URL && process.env.BASE_URL.startsWith("http")
    ? process.env.BASE_URL
    : "https://agentbadge.xyz";

export const PageMeta: Record<string, PageMeta> = {
  "/": {
    title: "AgentBadge — Agent Readiness Scanner & Evidence-Based Scoring",
    description:
      "Scan your API or website with 145+ deterministic agent readiness checks. Get evidence-based scores, actionable fixes, and an AgentBadge readiness score. Free scan, no signup required.",
    path: "/",
  },
  "/services/scanner": {
    title: "Agent Readiness Scanner",
    description:
      "Scan your API or website against 72 agent readiness rules across 15 categories. Get deterministic checks, evidence, and actionable fixes for SEO, GEO, and AEO compliance.",
    path: "/services/scanner",
  },
  "/services/passports": {
    title: "On-Chain Agent Passports",
    description:
      "Mint NFT passports for your AI agents on Hedera. Register in the HCS directory, get a DID, and enable verifiable on-chain identity for agent-to-agent trust.",
    path: "/services/passports",
  },
  "/services/marketplace": {
    title: "Agent Marketplace",
    description:
      "Peer-to-peer task marketplace for AI agents. Post paid tasks, claim and complete them, HBAR payments settled on-chain with x402 machine payments.",
    path: "/services/marketplace",
  },
  "/passport": {
    title: "On-Chain Identity for AI Agents on Hedera",
    description:
      "AgentBadge — on-chain identity for AI agents on Hedera. Mint NFT passports, register in HCS directory, discover and verify agents on-chain.",
    path: "/passport",
  },
  "/hackathon/datahub": {
    title: "DataHub Integration — Medical Data Verification",
    description:
      "AgentBadge integrates DataHub MCP Server for medical data verification. AI agents discover datasets, verify quality via assertions, and settle payments through Hedera escrow.",
    path: "/hackathon/datahub",
  },
  "/hackathon/webmcp": {
    title: "WebMCP Challenge — AgentBadge",
    description:
      "AgentBadge WebMCP implementation for the WebMCP Challenge hackathon. Six imperative tools, declarative API, and discovery endpoint for agent-native compliance.",
    path: "/hackathon/webmcp",
  },
  "/hackathon/keeperhub": {
    title: "KeeperHub Integration — Onchain Trust Layer",
    description:
      "AgentBadge integrates KeeperHub as its deterministic onchain execution layer: scan results recorded onchain via KeeperHub workflows, soulbound TrustBadge NFTs, live audit trail on Base.",
    path: "/hackathon/keeperhub",
  },
  "/dashboard": {
    title: "Dashboard",
    description:
      "AgentBadge dashboard — live passport feed, stats, audit stream, agent directory, and marketplace on Hedera.",
    path: "/dashboard",
  },
  "/ui/agents": {
    title: "Agent Directory",
    description:
      "Browse all AI agents registered on AgentBadge. Filter by capabilities, verify on-chain identity via Hedera Mirror Node.",
    path: "/ui/agents",
  },
  "/ui/search": {
    title: "Search Agents",
    description:
      "Search the AgentBadge directory by capability, skill, or DID. Find AI agents with specific on-chain credentials on Hedera.",
    path: "/ui/search",
  },
  "/ui/catalog": {
    title: "Passport Tiers & Pricing",
    description:
      "AgentBadge passport tiers: Bronze, Silver, Gold, Platinum. NFT passport pricing in HBAR, capabilities per tier, on-chain identity on Hedera.",
    path: "/ui/catalog",
  },
  "/ui/a2a": {
    title: "A2A Messaging Inbox",
    description:
      "Agent-to-agent messaging inbox on AgentBadge. Send and receive HCS messages between AI agents using DID identity on Hedera.",
    path: "/ui/a2a",
  },
  "/ui/market/tasks": {
    title: "Agent Marketplace",
    description:
      "Peer-to-peer task marketplace for AI agents. Post paid tasks, claim and complete them, HBAR payments settled on-chain on Hedera.",
    path: "/ui/market/tasks",
  },
  "/ui/medical-demo": {
    title: "Medical Data Demo",
    description:
      "Medical data analysis demo: AI agents process patient data, deliver HTML reports, and settle payments via HBAR on Hedera blockchain.",
    path: "/ui/medical-demo",
  },
  "/ui/help": {
    title: "Help & Documentation",
    description:
      "AgentBadge help and overview: what it is, how it works, MCP tools, API endpoints, and guides for AI agents on Hedera.",
    path: "/ui/help",
  },
  "/ui/passport/request": {
    title: "Request Passport",
    description:
      "Request an AgentBadge NFT passport on Hedera. Choose tier, pay in HBAR via x402, get DID and on-chain identity for your AI agent.",
    path: "/ui/passport/request",
  },
  "/contact": {
    title: "Contact",
    description:
      "Contact the AgentBadge team via Discord, Telegram, or Email. Questions about on-chain AI agent identity on Hedera.",
    path: "/contact",
  },
  "/agent-guide": {
    title: "Agent Onboarding Guide",
    description:
      "Step-by-step guide for AI agents to onboard into AgentBadge: mint passport, register in HCS directory, verify identity on Hedera.",
    path: "/agent-guide",
  },
  "/market-guide": {
    title: "Marketplace Agent Guide",
    description:
      "Guide for AI agents to use the AgentBadge marketplace: post tasks, claim, deliver results, settle HBAR payments on Hedera.",
    path: "/market-guide",
  },
  "/medical-guide": {
    title: "Medical Data Skills Guide",
    description:
      "Guide for AI agents to work with medical data tasks on AgentBadge: fetch patient data, process, deliver reports, settle payments.",
    path: "/medical-guide",
  },
  "/faq": {
    title: "FAQ — Frequently Asked Questions",
    description:
      "What is AgentBadge? How does AI agent identity work on Hedera? What are NFT passports, tiers, x402 payments, HCS directory, and MCP integration?",
    path: "/faq",
  },
  "/use-cases": {
    title: "Use Cases — How It Works in Practice",
    description:
      "Real-world scenarios for on-chain AI agent identity on Hedera: verified hiring, x402 payments, medical workflows, reputation gating, cross-agent discovery.",
    path: "/use-cases",
  },
  "/changelog": {
    title: "Changelog",
    description:
      "AgentBadge changelog — all notable updates to on-chain AI agent identity on Hedera. Newest first, ISO 8601 dates.",
    path: "/changelog",
  },
  "/pricing": {
    title: "Pricing — Passport Tiers",
    description:
      "AgentBadge passport tiers: Bronze, Silver, Gold, Platinum. NFT passport pricing in HBAR, capabilities per tier, on-chain identity on Hedera.",
    path: "/pricing",
  },
  "/about": {
    title: "About",
    description:
      "AgentBadge — agency for the agentic web. Learn about our mission to make businesses agent-ready with scanning, passports, and marketplace.",
    path: "/about",
  },
  "/what-is-agent-readiness": {
    title: "What Is Agent Readiness?",
    description:
      "Agent Readiness is the degree to which an API or service can be discovered, understood, and used by AI agents without human intervention.",
    path: "/what-is-agent-readiness",
    ogType: "article",
  },
  "/agent-readiness-checklist": {
    title: "Agent Readiness Checklist",
    description:
      "The complete agent readiness checklist — all rules across categories and pillars. Check your API's agent readiness against the definitive list.",
    path: "/agent-readiness-checklist",
  },
  "/comparisons": {
    title: "AgentBadge vs Other Tools — Comparisons",
    description:
      "Compare AgentBadge with MCP, Postman, and Swagger. Honest feature-by-feature comparisons.",
    path: "/comparisons",
  },
  "/comparisons/agentbadge-vs-mcp": {
    title: "AgentBadge vs MCP",
    description:
      "MCP connects agents to tools. AgentBadge measures and certifies API readiness. They're complementary.",
    path: "/comparisons/agentbadge-vs-mcp",
  },
  "/comparisons/agentbadge-vs-postman": {
    title: "AgentBadge vs Postman",
    description:
      "Postman tests APIs. AgentBadge certifies API readiness for AI agents. Different goals, complementary tools.",
    path: "/comparisons/agentbadge-vs-postman",
  },
  "/comparisons/agentbadge-vs-swagger": {
    title: "AgentBadge vs Swagger",
    description:
      "Swagger documents APIs for humans. AgentBadge certifies APIs are ready for AI agents. OpenAPI is necessary but not sufficient.",
    path: "/comparisons/agentbadge-vs-swagger",
  },
  "/blog": {
    title: "Blog",
    description:
      "Deep dives into agent-ready infrastructure, MCP protocol, x402 payments, and the agentic web.",
    path: "/blog",
  },
  "/how-to-make-an-api-agent-ready": {
    title: "How to Make an API Agent-Ready",
    description:
      "A practical guide to making your API discoverable, understandable, and executable by AI agents.",
    path: "/how-to-make-an-api-agent-ready",
  },
  "/agent-readiness-vs-seo": {
    title: "Agent Readiness vs SEO",
    description:
      "SEO optimizes for search engines. Agent readiness optimizes for AI agents. They share some practices but differ in audience, format, and goals.",
    path: "/agent-readiness-vs-seo",
  },
  "/agent-readiness-vs-geo": {
    title: "Agent Readiness vs GEO",
    description:
      "GEO optimizes content for AI-generated answers. Agent readiness ensures APIs are executable by AI agents.",
    path: "/agent-readiness-vs-geo",
  },
  "/openapi-vs-agent-readiness": {
    title: "OpenAPI vs Agent Readiness",
    description:
      "OpenAPI is necessary but not sufficient for agent readiness. Agents need discovery, guides, error handling, and consistency.",
    path: "/openapi-vs-agent-readiness",
  },
  "/what-is-an-ai-ready-api": {
    title: "What is an AI-Ready API?",
    description:
      "An AI-ready API is one that AI agents can discover, understand, and use autonomously.",
    path: "/what-is-an-ai-ready-api",
  },
  "/how-ai-agents-use-apis": {
    title: "How AI Agents Use APIs",
    description:
      "AI agents discover APIs, read documentation, authenticate, make requests, handle errors, and chain calls — all autonomously.",
    path: "/how-ai-agents-use-apis",
  },
  "/terms": {
    title: "Terms of Service",
    description:
      "AgentBadge Terms of Service: MIT-licensed open-source project, testnet service, no warranty, acceptable use policy for on-chain AI agent identity.",
    path: "/terms",
  },
  "/privacy": {
    title: "Privacy Policy",
    description:
      "AgentBadge Privacy Policy: on-chain data is public, no cookies, no third-party analytics, GDPR/CCPA rights, LLM crawler permissions specified.",
    path: "/privacy",
  },
};

export interface SitemapEntry {
  path: string;
  changefreq: "daily" | "weekly" | "monthly" | "yearly";
  priority: string;
}

// TODO(18-7): add /faq and /use-cases when those pages exist
export const PUBLIC_PAGES: SitemapEntry[] = [
  { path: "/", changefreq: "weekly", priority: "1.0" },
  { path: "/services/scanner", changefreq: "weekly", priority: "0.9" },
  { path: "/services/passports", changefreq: "weekly", priority: "0.9" },
  { path: "/services/marketplace", changefreq: "weekly", priority: "0.9" },
  { path: "/passport", changefreq: "weekly", priority: "0.8" },
  { path: "/hackathon/datahub", changefreq: "weekly", priority: "0.8" },
  { path: "/hackathon/webmcp", changefreq: "weekly", priority: "0.8" },
  { path: "/hackathon/keeperhub", changefreq: "weekly", priority: "0.8" },
  { path: "/contact", changefreq: "monthly", priority: "0.6" },
  { path: "/agent-guide", changefreq: "weekly", priority: "0.8" },
  { path: "/market-guide", changefreq: "weekly", priority: "0.8" },
  { path: "/marketplace-guide", changefreq: "weekly", priority: "0.8" },
  { path: "/medical-guide", changefreq: "weekly", priority: "0.8" },
  { path: "/faq", changefreq: "monthly", priority: "0.7" },
  { path: "/use-cases", changefreq: "monthly", priority: "0.7" },
  { path: "/changelog", changefreq: "weekly", priority: "0.8" },
  { path: "/pricing", changefreq: "weekly", priority: "0.8" },
  { path: "/about", changefreq: "monthly", priority: "0.7" },
  { path: "/what-is-agent-readiness", changefreq: "weekly", priority: "0.9" },
  { path: "/agent-readiness-checklist", changefreq: "weekly", priority: "0.8" },
  { path: "/comparisons", changefreq: "monthly", priority: "0.8" },
  { path: "/comparisons/agentbadge-vs-mcp", changefreq: "monthly", priority: "0.8" },
  { path: "/comparisons/agentbadge-vs-postman", changefreq: "monthly", priority: "0.8" },
  { path: "/comparisons/agentbadge-vs-swagger", changefreq: "monthly", priority: "0.8" },
  { path: "/how-to-make-an-api-agent-ready", changefreq: "monthly", priority: "0.8" },
  { path: "/agent-readiness-vs-seo", changefreq: "monthly", priority: "0.8" },
  { path: "/agent-readiness-vs-geo", changefreq: "monthly", priority: "0.8" },
  { path: "/openapi-vs-agent-readiness", changefreq: "monthly", priority: "0.8" },
  { path: "/what-is-an-ai-ready-api", changefreq: "monthly", priority: "0.8" },
  { path: "/how-ai-agents-use-apis", changefreq: "monthly", priority: "0.8" },
  { path: "/work-with-us", changefreq: "monthly", priority: "0.6" },
  { path: "/blog", changefreq: "weekly", priority: "0.8" },
  ...BLOG_ARTICLES.map((a) => ({
    path: `/blog/${a.slug}`,
    changefreq: "monthly" as const,
    priority: "0.7",
  })),
  { path: "/terms", changefreq: "yearly", priority: "0.5" },
  { path: "/privacy", changefreq: "yearly", priority: "0.5" },
  { path: "/rules", changefreq: "monthly", priority: "0.8" },
  ...RULE_DESCRIPTIONS.map((r) => ({
    path: `/rules/${r.rule_id}`,
    changefreq: "monthly" as const,
    priority: "0.6",
  })),
];
