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
  "AgentBadge — agency for the agentic web. We help businesses become agent-ready with readiness scanning, on-chain identity passports, and a task marketplace with machine payments.";

export const BASE_URL =
  process.env.BASE_URL && process.env.BASE_URL.startsWith("http")
    ? process.env.BASE_URL
    : "https://agentbadge.xyz";

export const PageMeta: Record<string, PageMeta> = {
  "/": {
    title: "Agency for the Agentic Web",
    description:
      "AgentBadge is an agency that helps businesses become agent-ready. Readiness scanning, on-chain identity passports, and a task marketplace with machine payments.",
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
  "/datahub": {
    title: "DataHub Integration — Medical Data Verification",
    description:
      "AgentBadge integrates DataHub MCP Server for medical data verification. AI agents discover datasets, verify quality via assertions, and settle payments through Hedera escrow.",
    path: "/datahub",
  },
  "/hackathon/webmcp": {
    title: "WebMCP Challenge — AgentBadge",
    description:
      "AgentBadge WebMCP implementation for the WebMCP Challenge hackathon. Six imperative tools, declarative API, and discovery endpoint for agent-native compliance.",
    path: "/hackathon/webmcp",
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
  "/blog": {
    title: "Blog",
    description:
      "Deep dives into agent-ready infrastructure, MCP protocol, x402 payments, and the agentic web.",
    path: "/blog",
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
  { path: "/datahub", changefreq: "weekly", priority: "0.8" },
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
