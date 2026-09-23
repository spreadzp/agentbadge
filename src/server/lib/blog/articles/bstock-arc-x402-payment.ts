import type { BlogArticle } from "../../blog-data";

export const article: BlogArticle = {
  slug: "bstock-arc-x402-payment",
  title: "x402 Payments on Arc Testnet: How an Agent Pays in USDC With No Facilitator",
  description: "On Arc, gas is paid in USDC — so an agent can broadcast its own EIP-3009 transferWithAuthorization and settle x402 payments with no facilitator.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-09-23",
  dateModified: "2026-09-23",
  tags: ["x402","arc","usdc","eip-3009","payments","ai-agents"],
  readingTime: "5 min",
  shortAnswer: "Arc self-settle lets an agent pay x402 invoices with no facilitator: it signs an EIP-3009 transferWithAuthorization, broadcasts it on Arc (gas in USDC), and sends the txHash — the server verifies the on-chain receipt.",
  content: `<p>&lt;!– ARTICLE METADATA ================ Title: x402 Payments on Arc
Testnet: How an Agent Pays in USDC With No Facilitator Slug:
bstock-arc-x402-payment Language: en Block: bStock campaign Platforms:
AgentBadge Blog (canonical), Binance Square (RU version) Status: DRAFT —
needs screenshots (broadcast txHash, explorer)</p>`,
};
