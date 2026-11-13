import type { BlogArticle } from "../../blog-data";
import { arcC48DirectUsdcEngineContent } from "./arc-c48-direct-usdc-engine.content";

export const article: BlogArticle = {
  slug: "arc-c48-direct-usdc-engine",
  title:
    "Stripe Tells You the Money Arrived. On-Chain, Nobody Does — Building a USDC Verification Engine",
  description:
    "When a buyer pays in USDC, no webhook tells you the money arrived — so we built the engine that asks the blockchain itself. A viem adapter scans Arc for Transfer events, matches them against our own attempt expectations (reference + exact amount + treasury), confirms through the same evidence seam Stripe uses, and files a PaymentException when anything doesn't add up. Hourly reconciliation diffs three sources of truth into seven named mismatch kinds. Then we ran an adversarial audit: 2 Critical + 9 High, all re-verified and fixed with regression tests.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-13",
  dateModified: "2026-11-13",
  tags: [
    "payments",
    "usdc",
    "arc",
    "on-chain-verification",
    "payment-engine",
    "reconciliation",
    "viem",
    "payment-exceptions",
    "adversarial-audit",
    "epic-222",
  ],
  readingTime: "8 min",
  shortAnswer:
    "When a buyer pays by card, Stripe's webhook says paid. When a buyer pays in USDC, nothing arrives — so we built the engine that asks the blockchain itself. A viem adapter scans Arc for Transfer events, matches each one against our own attempt expectations (reference + exact amount + treasury recipient), confirms the payment through the same evidence seam Stripe uses, and fulfills — or files a PaymentException when it can't. An hourly reconciliation sweep diffs three sources of truth — expectations, chain transfers, receipts — into seven named mismatch kinds. Then we ran an adversarial audit on all of it: 2 Critical + 9 High, every finding re-verified against the source, all fixed with regression tests.",
  heroImage: "/images/blog/arc-c48-direct-usdc-engine-hero.webp",
  ogImage: "/images/blog/arc-c48-direct-usdc-engine-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "viem",
    "USDC",
    "Arc",
    "Prisma",
  ],
  entities: [
    "agentbadge-payments-chain-module",
    "arc-usdc-monitor-sweeper",
    "payment-exception-queue",
    "usdc-reconciliation-sweeper",
    "epic-222",
    "direct-usdc-rail",
  ],
  concepts: [
    "verify-against-expectations",
    "unique-micro-amount-dedupe",
    "evidence-seam-rail-agnostic",
    "three-source-reconciliation",
    "deterministic-exception-ids",
    "claim-not-event",
    "env-gated-self-serve",
    "fulfillment-outcome-proven-effect",
  ],
  topics: [
    "payments",
    "arc",
    "usdc",
    "on-chain-verification",
    "audit",
  ],
  capabilities: [
    "direct-usdc-payment-attempts",
    "usdc-transfer-monitoring",
    "payment-exception-queue",
    "three-source-usdc-reconciliation",
    "manual-refund-ops",
    "fulfillment-outcome-tracking",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c48-direct-usdc-engine.md",
    },
    {
      type: "read",
      label: "Checkout pricing page",
      url: "https://agentbadge.xyz/pricing",
    },
    {
      type: "read",
      label: "Previous article: Payment infrastructure foundation",
      url: "https://agentbadge.xyz/blog/payment-infrastructure-foundation",
    },
    {
      type: "read",
      label: "Previous article: Checkout v2",
      url: "https://agentbadge.xyz/blog/arc-c46-checkout-two",
    },
  ],
  qa: [
    {
      question: "How do you verify a USDC payment on-chain?",
      answer:
        "Verify against stored expectations, not against a buyer-supplied tx hash. When a DIRECT_USDC attempt opens, the instructions carry a payment-derived reference, the treasury recipient, the USDC token contract, and an exact amount with a deterministic micro-unit suffix (9.990044, not 9.99). A monitor sweeper scans Arc Transfer events and matches each against those expectations by bound txHash or exact amount+recipient+reference; fuzzy matching is limited to the same amount bucket.",
    },
    {
      question: "What did the adversarial audit of the USDC engine find?",
      answer:
        "2 Critical + 9 High, every finding independently re-verified before any fix. The worst: fulfillment marked done after any handler return (paid-but-never-delivered, C-1), and the chain scan trusted any decoded Transfer including wrong-emitter and wrong-recipient logs (C-2). All fixed with regression tests — FulfillmentOutcome discriminated union, viem event+args getLogs filter with post-decode emitter/recipient asserts, plus chainId assert, per-attempt tick isolation, reclaim CAS fencing, and a self-serve gate that hard-fails without the monitor enabled.",
    },
    {
      question: "How does hourly USDC reconciliation work?",
      answer:
        "An env-gated sweep diffs three sources of truth — attempt expectations, chain Transfer events, and stored receipts — into seven named mismatch kinds: CHAIN_TX_WITHOUT_ATTEMPT, CONFIRMED_WITHOUT_RECEIPT, RECEIPT_WITHOUT_CHAIN_TX, AMOUNT_DRIFT, RECIPIENT_DRIFT, CONFIRMED_WITHOUT_FULFILLMENT, plus EXACT_TX_ON_UNCONFIRMED_ATTEMPT and EXTRA_TX_ON_CONSUMED_ATTEMPT. Deterministic exception IDs dedupe re-runs, and the scan cursor only advances after a fully successful pass.",
    },
    {
      question: "Which endpoints expose the direct USDC rail?",
      answer:
        "POST /api/v1/payments/:id/attempts with {provider: DIRECT_USDC, network: eip155:1874} returns instructions {amount, recipient, tokenContract, reference, expiresAt}; GET /api/v1/payments/:id shows status + attempts with /receipt once confirmed; GET /api/v1/payments/exceptions is the admin ops queue; POST /api/v1/payments/:id/refund is manual refund. The rail is opt-in: PAYMENTS_USDC_SELF_SERVE hard-fails without USDC_MONITOR_ENABLED + ARC_RPC_URL + an arc-labeled network.",
    },
    {
      question: "What are the limits of the current engine?",
      answer:
        "Arc only — Base and Solana are deferred and self-serve filters non-Arc networks out. In-process sweeper with no external infra. One adversarial audit (2C+9H fixed) rather than a formal proof. Manual refunds: an admin posts the refund txHash, the service opens a REFUND_REQUEST exception, markRefunded moves CONFIRMED or DISPUTED to REFUNDED, non-idempotent.",
    },
  ],
  claims: [
    {
      id: "c48-engine-architecture",
      status: "VERIFIED",
      text: "The USDC verification engine lives in @agentbadge/payments/src/chain/ (network-config registry for eip155:1874 + eip155:5042002, arc-adapter with injectable viem client and chunked getLogs scan, match.ts with bound-hash + exact-expectation matching and same-bucket fuzzy) plus server wiring: env-gated usdc-payment-monitor sweeper, exception queue at GET /api/v1/payments/exceptions, hourly usdc-reconciliation sweep, and admin refund at POST /api/v1/payments/:id/refund.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/services/usdc-payment-monitor.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/payments-api/usdc-monitor.ts",
        },
      ],
    },
    {
      id: "c48-audit-2c-9h-all-fixed",
      status: "VERIFIED",
      text: "External adversarial review of the engine found 2 Critical + 9 High; every finding was independently re-verified against the source before fixing. All fixed: FulfillmentOutcome proven-effect done semantics, viem event+args getLogs with post-decode asserts, lazy cached verifyChainId, per-attempt tick isolation, same-bucket fuzzy matching, reclaim CAS marker, and a self-serve hard-fail without monitor+rpc+arc network. 183 payments-package + 73 server tests green.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/payments-api/usdc-reconciliation.ts",
        },
      ],
    },
    {
      id: "c48-unique-amount-dedupe",
      status: "VERIFIED",
      text: "DIRECT_USDC instructions carry a deterministic micro-unit suffix derived from the payment ID — $9.99 becomes 9.990044 — so ten buyers produce ten distinct amounts at one treasury recipient and on-chain matching is a lookup. Verified live on eip155:1874 during the checkout dogfood (screenshot in article).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/payments-api/checkout-attempts.ts",
        },
      ],
    },
    {
      id: "c48-self-serve-honesty-gate",
      status: "VERIFIED",
      text: "PAYMENTS_USDC_SELF_SERVE does not emit instructions unless USDC_MONITOR_ENABLED=true + ARC_RPC_URL is set + an arc-labeled network is configured; when enabled, usdcNetworks filters to label==arc only — a server that cannot watch the chain cannot sell pay-us-in-USDC.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/config/env/payments.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC48DirectUsdcEngineContent,
};
