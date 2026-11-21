import type { BlogArticle } from "../../blog-data";
import { arcC58CounterpartyTrustContent } from "./arc-c58-counterparty-trust.content";

export const article: BlogArticle = {
  slug: "arc-c58-counterparty-trust",
  title:
    "Before Our Agent Pays, It Phones a Friend - and After It Pays, It Writes Down What Happened",
  description:
    "x402 counterparty trust, live on Arc mainnet: an independent vet402 check runs before signing (unknown seller held pre-signature in enforce mode), the whole offer is fingerprint-bound into single-use approvals, and an honest x402_fulfillment journal records what paid handlers actually did - verified by a real $0.02 USDC GatewayWalletBatched payment. Arc Studio audit: request changes, 2C/8H/10M, remediated across seven slices.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-21",
  dateModified: "2026-11-21",
  tags: [
    "x402",
    "counterparty-trust",
    "vet402",
    "payments",
    "audit",
    "arc",
    "epic-257",
  ],
  readingTime: "9 min",
  shortAnswer:
    "An AI agent paying for an API call with crypto is flying blind - the money leaves before anyone asks 'is this seller real, and is this the same deal I was quoted yesterday?' So we wired our payment path to an independent counterparty measurer (vet402) before signing, and started keeping our own journal of what paid handlers actually did after settlement. Two evidence loops, one before the money, one after. Neither trusts the other side's word. On production, day one: an unknown seller was held before signing, and a real $0.02 USDC payment settled on Arc mainnet with exactly one handler_completed fulfillment row and zero trust edges.",
  heroImage: "/images/blog/arc-c58-counterparty-trust-hero.webp",
  ogImage: "/images/blog/arc-c58-counterparty-trust-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "x402",
    "USDC",
    "Circle Gateway",
    "viem",
  ],
  entities: [
    "vet402",
    "counterparty-gate",
    "approval-permit",
    "x402-fulfillment",
    "gateway-wallet-batched",
    "epic-257",
  ],
  concepts: [
    "external-measurement-not-judgment",
    "exact-offer-fingerprint",
    "single-use-approval",
    "atomic-consume",
    "uncertain-money-never-retried",
    "fulfillment-honesty",
    "fire-and-forget-journal",
    "no-trust-edges-from-fulfillment",
    "privacy-boundary-url-sanitizer",
    "audit-as-attack-surface",
  ],
  topics: [
    "payments",
    "counterparty-risk",
    "agent-commerce",
    "economic-ledger",
    "arc",
  ],
  capabilities: [
    "pre-signing-counterparty-vetting",
    "terms-match-verification",
    "hold-approve-pay-flow",
    "fulfillment-outcome-classification",
    "replayable-journal-events",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c58-counterparty-trust.md",
    },
    {
      type: "read",
      label: "Gateway deposit tx on Arc explorer",
      url: "https://explorer.arc.io/tx/0x19b79f11705a6c81d1e2d18433cadb4fe04b7fc20b453991c27a025f9d28eea0",
    },
    {
      type: "read",
      label: "Previous article: EURC to USDC funding",
      url: "https://agentbadge.xyz/blog/arc-c57-peach-dex",
    },
  ],
  content: arcC58CounterpartyTrustContent,
};
