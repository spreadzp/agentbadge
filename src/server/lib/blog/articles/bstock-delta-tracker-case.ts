import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-delta-tracker-case",
  title: "Tracking the Delta: How an AI Agent Watches Tokenized Stocks Drift From Their Underlyings",
  description: "Tokenized stocks trade 24/7 while their underlyings sleep. We built a real-time delta tracker and exposed it to AI agents over MCP — with a 402 paywall on Arc.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-23",
  tags: ["bstocks","tokenized-stocks","mcp","x402","ai-agents"],
  readingTime: "6 min",
  shortAnswer: "A delta tracker computes the price divergence between a tokenized stock and its underlying in real time and serves it to AI agents over MCP — free tier 1 req/min, then HTTP 402 with an x402 payment on Arc Testnet.",
  content: `<p>&lt;!– ARTICLE METADATA ================ Title: Tracking the Delta:
How an AI Agent Watches Tokenized Stocks Drift From Their Underlyings
Slug: bstock-delta-tracker-case Language: en Block: bStock campaign
Platforms: AgentBadge Blog (canonical), Binance Square (RU version)
Status: DRAFT — needs screenshots (demo.sh: 402 → payment →
real-time)</p>
<h1 id="image-asset-map-todo-nanobanana">IMAGE ASSET MAP (TODO —
NanoBanana)</h1>
<p>1s.png → hero: two-line chart (bStock vs underlying) with delta band
2s.png → get_delta JSON response screenshot 3s.png → 402 +
PAYMENT-REQUIRED screenshot 4s.png → Telegram alert screenshot</p>`,
};
