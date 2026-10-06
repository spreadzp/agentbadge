/**
 * EPIC-178 (SLICE-178-3): trust manifests — agent-evaluation.json +
 * owner-questions.json. Pure builders; every input arrives via
 * `DiscoverySources`. Registered in manifests.ts.
 *
 * agent-evaluation.json — verification ladder for external agents:
 *   how to check our claims in N seconds, cheapest checks first.
 *   Every `ref` is a real URL or executable command (never prose).
 * owner-questions.json — operator/fleet FAQ for evaluator agents.
 *
 * Reference: craigmbrown.com/.well-known/agent-evaluation.json (BlindOracle).
 */

import type { DiscoverySources } from "./sources";

const json = (v: unknown): string => JSON.stringify(v, null, 2) + "\n";

/**
 * Arc mainnet deployment facts — source of truth:
 * contracts/deployments/arc-mainnet.json (kept as constants here because
 * the server bundle does not ship the contracts/ directory).
 */
const ARC_EXPLORER = "https://explorer.arc.io";
const ARC_CONTRACTS = {
  agentEventLog: "0x1bb6A87D18cbd4285b4d383F88f10a1Ed01B4700",
  agentPassportNft: "0xd226824e66e6aac7104579840506e268886a8169",
  accessPassNft: "0x68ca4d1a9ff24f86328f2fb3a30d81e503d367f5",
  marketplacePassNft: "0xf8756ce4400c76f1c31b72216c391e1c46cc2c03",
} as const;

const explorerAddr = (addr: string) => `${ARC_EXPLORER}/address/${addr}`;

// ─── agent-evaluation.json (verification ladder) ─────────────────────────────

export function buildAgentEvaluation(src: DiscoverySources): string {
  const b = src.baseUrl;
  const host = new URL(b).host;
  return json({
    version: "1.0",
    subject: host,
    ladder: [
      {
        depth: "5s",
        checks: [
          {
            claim: "mainnet deployment — AgentEventLog contract on Arc",
            action: "open",
            ref: explorerAddr(ARC_CONTRACTS.agentEventLog),
          },
          {
            claim: "agent card published (A2A v1.0)",
            action: "GET",
            ref: `${b}/.well-known/agent-card.json`,
          },
        ],
      },
      {
        depth: "60s",
        checks: [
          {
            claim: "manifest validity — agent card + ERC-8004 registration",
            action: "GET",
            ref: `${b}/.well-known/erc8004-agent.json`,
          },
          {
            claim: "OpenAPI spec live",
            action: "GET",
            ref: `${b}/api/specs`,
          },
          {
            claim: "honest-refusal contract published",
            action: "GET",
            ref: `${b}/api/meta/refusal-contract`,
          },
          {
            claim: "liveness",
            action: "GET",
            ref: `${b}/health`,
          },
        ],
      },
      {
        depth: "5min",
        checks: [
          {
            claim: "paid surface catalog resolves (x402 SKUs)",
            action: "GET",
            ref: `${b}/api/scan-packs`,
          },
          {
            claim: "verdict integrity anchored on-chain",
            action: "run",
            ref: "npx @agentbadge/verify-verdict <verdictId>",
          },
        ],
      },
      {
        depth: "full",
        checks: [
          {
            claim: "end-to-end paid call",
            action: "run",
            ref: `${b}/llms.txt`,
          },
        ],
      },
    ],
    capabilities: [
      {
        name: "agent-readiness scanning",
        evidence: `${b}/api/scan-packs`,
        verify: `${b}/api/scan-packs`,
      },
      {
        name: "agent passport NFT (ERC-8004)",
        evidence: `${b}/.well-known/erc8004-agent.json`,
        verify: explorerAddr(ARC_CONTRACTS.agentPassportNft),
      },
      {
        name: "on-chain event logging (Arc mainnet)",
        evidence: `${b}/.well-known/agentbadge.json`,
        verify: explorerAddr(ARC_CONTRACTS.agentEventLog),
      },
      {
        name: "MCP server (namespaced tools)",
        evidence: `${b}/.well-known/mcp/server-card.json`,
        verify: `${b}/.well-known/mcp/server-card.json`,
      },
      {
        name: "honest refusals — refused calls never charged",
        evidence: `${b}/api/meta/refusal-contract`,
        verify: `${b}/api/meta/refusal-contract`,
      },
      {
        name: "paid services (x402 USDC on Arc)",
        evidence: `${b}/api/meta/fees`,
        verify: `${b}/api/meta/fees`,
      },
    ],
    selfEvaluation: [
      "Operator class: venue-operator — multi-tenant marketplace + agency surfaces (see owner-questions.json).",
      "Fleet size hint: venue — managed agents across tenant services.",
      "Refusal policy: every refusal line is charge:never — /api/meta/refusal-contract.",
    ],
    sources: [
      `${b}/.well-known/agentbadge.json`,
      `${b}/.well-known/agent-card.json`,
      `${b}/api/specs`,
      "https://agentbadge.gitbook.io/agentbadge-docs",
    ],
  });
}

// ─── owner-questions.json (operator/fleet FAQ) ───────────────────────────────

export function buildOwnerQuestions(_src: DiscoverySources): string {
  return json({
    version: "1.0",
    subject: "AgentBadge",
    questions: [
      {
        id: "how-many-agents",
        text: "How many agents does the operator run?",
        why: "Fleet size signals capacity and blast radius — a single-agent operator and a venue fleet carry different trust weight.",
      },
      {
        id: "solo-team-or-venue",
        text: "Is this a solo operator, a team, or a venue-operated fleet?",
        why: "Determines the accountability model — solo wallets self-attest, venues attest per-tenant.",
      },
      {
        id: "who-pays",
        text: "Who pays when an agent over-spends or misbehaves?",
        why: "Liability routing — buyers need to know whether spend is owner-bounded or agent-bounded.",
      },
      {
        id: "owner-verification",
        text: "How is the operator's identity verified?",
        why: "Sybil resistance — an unverifiable operator can respawn agents to farm reputation.",
      },
      {
        id: "venue-tenancy",
        text: "For venue operators: are tenant agents isolated per-tenant?",
        why: "Blast radius — a compromised tenant must not affect other tenants' agents or spend.",
      },
      {
        id: "kill-switch",
        text: "Can the owner suspend an agent's spend instantly?",
        why: "Incident response — spend_suspended flag denies calls and auto-denies pending approvals.",
      },
      {
        id: "spend-limits",
        text: "What spend caps does the owner enforce?",
        why: "Per-tx ceilings, hourly velocity limits, and approval thresholds bound financial exposure.",
      },
    ],
    fleetSizeHints: {
      solo: [
        "single operator wallet",
        "one agent passport",
        "personal API keys",
      ],
      team: [
        "multiple agents sharing one org wallet",
        "named team members",
        "shared treasury",
      ],
      venue: [
        "tenant-scoped agent fleets",
        "per-tenant isolation",
        "operator manages third-party agents",
      ],
    },
  });
}
