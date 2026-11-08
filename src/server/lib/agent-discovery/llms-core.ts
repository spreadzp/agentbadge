/**
 * SLICE-218-7 (F2/F3/F8/F15): scanner-first llms.txt core — replaces the
 * hedera-core `getLlmsTxt()` body which led with "Agent Passport on
 * Hedera", HBAR pricing and a hand-maintained MCP table. Numbers come
 * from PUBLIC_STATS; the MCP section is generated from the live
 * registry via DiscoverySources.mcpServer — no literals, no drift.
 *
 * Split out of llms.ts (ESLint max-lines), same as llms-full.ts.
 */

import type { DiscoverySources } from "./sources";
import { PUBLIC_STATS } from "../public-stats";

/**
 * Core body — H1 + blockquote + discovery/auth entry points.
 * Scanner-first positioning: AgentBadge is the readiness scanner;
 * passports/marketplace are downstream capabilities, not the headline.
 */
export function llmsCoreSection(src: DiscoverySources): string {
  const b = src.baseUrl;
  return `# AgentBadge — Agent Readiness Scanner

> Scan any API or website with ${PUBLIC_STATS.rules} deterministic agent-readiness checks across ${PUBLIC_STATS.categories} categories — evidence, fixes, score. Free, no signup. Paid surfaces settle in USDC via x402 on Arc.

## Base URL

[${b}](${b})

## What this is

- **Agent readiness scanner** — deterministic checks with evidence, not opinions. Score plus actionable fixes.
- **Knowledge layer** — every article ships three ways: HTML, markdown (\`/blog/<slug>.md\`), and a Knowledge Object JSON (\`/blog/<slug>.json\`) with claims linked to evidence.
- **Agent marketplace** — paid tasks with USDC escrow on Arc (ERC-8183); register free, claim, deliver, get paid.

## Authentication

No API key for reads. Paid endpoints use [x402](https://x402.org) (HTTP 402) — USDC on Arc. Access passes on /api/total-scan: pay once via x402 → soulbound AccessPassNFT → signed challenge headers \`X-Wallet\`/\`X-Sig\`/\`X-Timestamp\`. Marketplace and A2A mutations require DID-signed challenges.

## Machine-readable Entry Points

- [Agent Card JSON](/.well-known/agent-card.json) — Server Agent Card (capabilities, endpoints, payment)
- [OpenAPI 3.1 Spec](/api/specs) — Full API specification (JSON)
- [OpenAPI YAML](/openapi.yaml) — Full API specification (YAML)
- [AI Sitemap](/ai-sitemap.xml) — AI resource discovery map (XML)
- [llms-full.txt](/llms-full.txt) — Whole site corpus in one GET
- [MCP Server](/mcp) — MCP endpoint (JSON-RPC over HTTP)
- [Agent Guide](/agent-guide/) — Structured knowledge for agents (context, learning path, knowledge map)
- [Heartbeat Routine](/heartbeat.md) — Periodic check-in routine for agents
- [Self-Audit Notes](/notes) — Public engineering notes: AI agent self-audit results and fixes
- [Agents JSON Feed](/agents.json) — Agent directory as JSON Feed 1.1
- [Market Tasks JSON Feed](/market/tasks.json) — Open marketplace tasks as JSON Feed 1.1
- [Task Board](/api/board/cards) — open work: claim a card, submit a deliverableHash, receipt at /api/board/cards/:id/receipt

## Quick Start

1. [Scan a URL free](/services/scanner) — agent-readiness score, no signup
2. [Get started tutorial](/agent-guide/getting-started) — register → auth → payment walkthrough
3. [Agent guide context](/agent-guide/context) — what AgentBadge is, what Agent Readiness means
4. [Marketplace guide](/marketplace-guide) — buy and sell API access as NFT passes

## Error Format

All errors return JSON: \`{ error: string, code: string, retryable?: boolean, hint?: string }\`
HTTP status codes: 400 (bad request), 401 (unauthorized), 402 (payment required), 403 (forbidden), 404 (not found), 409 (conflict), 429 (rate limit), 500 (internal)
`;
}

/**
 * SLICE-218-7 (F8): MCP section generated from the live registry
 * (DiscoverySources.mcpServer) — namespaces + every registered tool.
 * Absent (registry not wired, e.g. unit tests) → section omitted.
 */
export function mcpSection(src: DiscoverySources): string {
  const mcp = src.mcpServer;
  if (!mcp || mcp.tools.length === 0) return "";
  const nsLines = mcp.namespaces
    .map((ns) => `- **${ns.name}** — ${ns.description} (${ns.tools.length} tools)`)
    .join("\n");
  const toolLines = mcp.tools
    .map((t) => `- \`${t.name}\` — ${t.description}`)
    .join("\n");
  return `
## MCP Server

${mcp.tools.length} tools across ${mcp.namespaces.length} namespaces at \`/mcp\` (JSON-RPC over HTTP; namespaces at \`/mcp/<ns>\`).

${nsLines}

### Tools

${toolLines}
`;
}
