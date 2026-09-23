import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-freemium-402",
  title: "Freemium for AI Agents: Free vs Paid Tiers via HTTP 402 in an MCP Server",
  description: "How do you sell freemium to an agent with no card and no checkout form? HTTP 402 + x402: a programmable paywall where the agent pays on-chain in seconds.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-23",
  tags: ["x402","http-402","freemium","mcp","ai-agents","micropayments"],
  readingTime: "5 min",
  shortAnswer: "Freemium for AI agents works via HTTP 402: one free request per minute, then a 402 response carrying an x402 payment challenge — the agent pays on-chain and gets a 30-day ServicePass, no account or checkout needed.",
  content: `<p>&lt;!– ARTICLE METADATA ================ Title: Freemium for AI
Agents: Free vs Paid Tiers via HTTP 402 in an MCP Server Slug:
bstock-freemium-402 Language: en Block: bStock campaign Platforms:
AgentBadge Blog (canonical), Binance Square (RU version) Status: DRAFT —
needs 402-flow screenshots</p>`,
};
