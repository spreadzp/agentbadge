import type { BlogArticle } from "../../blog-data";
import { arcC57PeachDexContent } from "./arc-c57-peach-dex.content";

export const article: BlogArticle = {
  slug: "arc-c57-peach-dex",
  title:
    "We Let an Agent Swap EURC for USDC Into Its Own Budget Vault - Then Spent Seven Review Rounds Proving It Cannot Pay Twice",
  description:
    "EURC->USDC->BudgetVault through the Peach Arc Aggregator, live on testnet: an atomic tx journal written before broadcast, same-hash adoption on resume with zero resends, block-body proofs for 'never sent', and a pre-sign checklist that pins the signed calldata word-by-word. Seven review rounds (6 Arc Studio + an on-chain re-check) plus an independent Nemotron pass - and the sharpest bugs were in the vendor's API: an unadvertised router, a millisecond timestamp, a missing deviation field.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-20",
  dateModified: "2026-11-20",
  tags: [
    "dex",
    "eurc",
    "usdc",
    "crash-safety",
    "idempotency",
    "audit",
    "arc",
    "epic-254",
  ],
  readingTime: "8 min",
  shortAnswer:
    "An AI agent holding a USDC budget should be fundable in whatever the customer has. We proved 5 EURC converts to USDC through the Peach Arc Aggregator and lands in a real BudgetVault - with a journal that persists intent, hash, and raw signed bytes atomically before broadcast, so a killed process resumes to the same txHash and can never resend. Six audit rounds converged at 0 Critical/0 High, the vendor-side re-check found one High and three Mediums (all fixed and re-drilled live), and the most interesting findings were on the vendor's side: an execution router the status endpoint never advertises, a quote timestamp in milliseconds, and a deviation_ratio that never arrives. Decision: CONDITIONAL GO.",
  heroImage: "/images/blog/arc-c57-peach-dex-hero.webp",
  ogImage: "/images/blog/arc-c57-peach-dex-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "viem",
    "ERC-20",
    "Peach Arc Aggregator SDK",
  ],
  entities: [
    "budget-vault",
    "peach-aggregator",
    "swap-intent",
    "fsm-journal",
    "eip-1559-tx",
    "quote",
    "epic-254",
  ],
  concepts: [
    "crash-safety",
    "idempotency",
    "never-sent-block-body-proof",
    "atomic-journal",
    "nonce-pinning",
    "fail-closed-pre-sign",
    "calldata-layout-pinning",
    "vendor-as-untrusted-input",
    "remediation-is-attack-surface",
    "honest-residuals",
  ],
  topics: [
    "dex-integration",
    "agent-funding",
    "eurc-usdc",
    "payments",
    "crash-recovery",
    "arc",
  ],
  capabilities: [
    "eurc-to-usdc-conversion",
    "quote-sweep",
    "crash-safe-resume",
    "same-hash-adoption",
    "abandon-with-probes",
    "provenance-verification",
    "pre-sign-checklist",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c57-peach-dex.md",
    },
    {
      type: "read",
      label: "Evidence pack (branch)",
      url: "https://github.com/spreadzp/agent-budget-vault/tree/spike/epic-254-peach/spike-evidence",
    },
    {
      type: "read",
      label: "Swap tx on Arc explorer",
      url: "https://testnet.arcscan.app/tx/0x4e2669ae26291a4d6bfc37f8f3e7fdaec5440eec7f858180f1398ec5f2339006",
    },
    {
      type: "read",
      label: "Previous article: A2A settlement",
      url: "https://agentbadge.xyz/blog/arc-c55-a2a-settlement",
    },
  ],
  content: arcC57PeachDexContent,
};
