/**
 * bStock delta tracker agent guide — GET /bstock-guide
 *
 * Markdown instructions for AI agents: free tier usage, when to pay,
 * the 402 → x402 → ServicePass flow, rate limits, and call examples.
 * Pattern: market-guide.ts (content negotiation + HowTo JSON-LD).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { howToLd, breadcrumbListLd, defaultCoreSchemas } from "../lib/json-ld";
import { GuideLayout } from "../../views/guide-layout";

export const bstockGuideRoutes = new Hono();

function generateBstockGuide(): string {
  const baseUrl = process.env.BASE_URL ?? "http://localhost:4021";

  return `# bStock Delta Tracker — Agent Guide

Welcome, AI agent. This guide explains how to read tokenized-stock delta
data from the bStock tracker: Binance bStock prices vs underlying equity
prices (Finnhub/Alpaca), computed as a delta percentage per symbol.

## Overview

The tracker exposes a dedicated MCP namespace:

- **Endpoint:** \`${baseUrl}/mcp/bstock\`
- **Auth:** \`Authorization: Bearer <token>\` (agent tokens are issued
  out-of-band; without one you get \`401\`)
- **Tools (read-only):** \`get_delta\`, \`list_deltas\`, \`get_quote\`,
  \`get_events\`, \`get_digest\`

---

## Free tier

Every authenticated agent gets **1 req/min** for free — enough for
periodic delta checks and digests.

\`\`\`bash
curl -X POST ${baseUrl}/mcp/bstock/tools/get_delta \\
  -H "Authorization: Bearer \$MCP_AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"symbol": "AAPLB"}'
\`\`\`

JSON-RPC style works too:

\`\`\`bash
curl -X POST ${baseUrl}/mcp/bstock \\
  -H "Authorization: Bearer \$MCP_AGENT_TOKEN" \\
  -H "Content-Type: application/json" \\
  -d '{"jsonrpc":"2.0","id":1,"method":"tools/call",
       "params":{"name":"list_deltas","arguments":{}}}'
\`\`\`

---

## When to pay

If you need more than **1 req/min** — or real-time streaming — the free
bucket returns **HTTP 402** with a \`PAYMENT-REQUIRED\` header containing
base64-encoded x402 payment requirements.

Pay **$5 USDC** (Base Sepolia, EIP-3009) to mint a **ServicePass** for
\`bstock-delta-realtime\`, valid **30 days**:

1. Receive \`402\` + \`PAYMENT-REQUIRED\` header
2. Sign the payment (EIP-3009) and retry with a \`PAYMENT-SIGNATURE\` header
3. Server verifies + settles via the x402 facilitator, mints your pass
4. Include \`X-Wallet: <your-wallet>\` on subsequent calls — the pass is
   checked on-chain and you get real-time access

Renewal: repeat the buy — the pass extends (\`ServicePassExtended\`).

---

## Rate limits

| Tier | Limit | Over-limit response |
|---|---|---|
| Free | 1 req/min per token | 402 + PAYMENT-REQUIRED |
| Paid | 60 req/min per token | 429 |
| SSE | max 20 concurrent connections | 503 |

---

## Tools

- \`get_delta {symbol}\` — delta% for one bStock symbol (e.g. \`AAPLB\`)
- \`list_deltas {}\` — all tracked symbols, sorted by |delta| desc
- \`get_quote {symbol}\` — latest bStock + underlying quote pair
- \`get_events {limit?}\` — recent delta alert events
- \`get_digest {}\` — rolling-window digest for periodic checks
`;
}

bstockGuideRoutes.get(
  "/bstock-guide",
  describeRoute({
    description: "Markdown bStock delta tracker guide",
    content: { "text/markdown": {} },
  }),
  (c) => {
    const markdown = generateBstockGuide();
    const accept = c.req.header("Accept") ?? "";
    const wantsMarkdown =
      accept.includes("text/markdown") || accept.includes("text/plain");
    if (wantsMarkdown) {
      return new Response(markdown, {
        headers: { "Content-Type": "text/markdown; charset=utf-8" },
      });
    }

    const schemas = [
      ...defaultCoreSchemas(),
      howToLd({
        name: "Use the bStock Delta Tracker",
        description:
          "Read tokenized-stock delta data for free, then upgrade to real-time via x402 ServicePass.",
        path: "/bstock-guide",
        totalTime: "PT5M",
        steps: [
          {
            name: "Authenticate",
            text: "Call /mcp/bstock with Authorization: Bearer <token>.",
          },
          {
            name: "Free tier",
            text: "1 req/min — get_delta, list_deltas, get_quote.",
          },
          {
            name: "Pay via x402",
            text: "Over the free limit you get 402 + PAYMENT-REQUIRED; pay $5 USDC with PAYMENT-SIGNATURE.",
          },
          {
            name: "Real-time access",
            text: "ServicePass (30d) unlocks 60 req/min and SSE streaming.",
          },
        ],
      }),
      breadcrumbListLd([
        { name: "Home", path: "/" },
        { name: "bStock Guide", path: "/bstock-guide" },
      ]),
    ];

    const html = GuideLayout(
      "bStock Delta Tracker Guide",
      markdown,
      schemas,
      "/bstock-guide",
      new Date().toISOString().split("T")[0],
      [
        {
          term: "bStock",
          definition:
            "A Binance tokenized equity asset (e.g. AAPLB) tracking an underlying stock.",
        },
        {
          term: "Delta",
          definition:
            "Percentage gap between the bStock price and the underlying equity price times its multiplier.",
        },
        {
          term: "ServicePass",
          definition:
            "An on-chain access pass (MarketplacePassNFT) granting 30 days of real-time bStock data.",
        },
        {
          term: "x402",
          definition:
            "HTTP-native payment protocol: 402 + PAYMENT-REQUIRED → PAYMENT-SIGNATURE → settled access.",
        },
      ],
    );
    return c.html(html);
  },
);
