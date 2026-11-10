import type { BlogArticle } from "../../blog-data";
import { paymentInfrastructureFoundationContent } from "./payment-infrastructure-foundation.content";

export const article: BlogArticle = {
  slug: "payment-infrastructure-foundation",
  title:
    "The Money Layer Is Not the Money Rail: Building a Payment Foundation That an Adversarial Audit Couldn't Break",
  description:
    "@agentbadge/payments — a payment domain model that separates Payment/Attempt/Receipt/Event entities from whatever rail moves the money. Guarded state transitions, a 9-check verification verdict as the only door to CONFIRMED, two-level idempotency, decimal-string money — stress-tested by two adversarial AI audits and a live Stripe test-mode dogfood: CONFIRMED → REFUNDED, concurrent refunds → exactly one rail refund. 114/114 tests green.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-10",
  dateModified: "2026-11-10",
  tags: [
    "payments",
    "stripe",
    "domain-model",
    "state-machine",
    "idempotency",
    "adversarial-audit",
    "agent-economy",
    "typescript",
    "epic-220",
  ],
  readingTime: "9 min",
  shortAnswer:
    "We built @agentbadge/payments — a payment domain model that treats Payment, PaymentAttempt, PaymentReceipt and PaymentEvent as durable entities separate from whatever rail actually moves the money. All state changes flow through two transition maps with guarded writes, every CONFIRMED requires a 9-check verification verdict, idempotency runs at two levels (request fingerprint + claim-first side effects), and money is a decimal string end-to-end. Two adversarial AI audits (5 Critical + 6 High + 11 Medium, then 1 Critical + 6 High + 8 Medium) and a live Stripe test-mode run later: CONFIRMED → REFUNDED, concurrent refunds → one rail refund, 114/114 tests green.",
  heroImage: "/images/blog/payment-infrastructure-foundation-hero.webp",
  ogImage: "/images/blog/payment-infrastructure-foundation-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Stripe",
    "Prisma",
    "Vitest",
    "BigInt",
    "Zod",
  ],
  entities: [
    "agentbadge-payments-package",
    "epic-220",
    "payment-service",
    "stripe-payment-provider",
    "fake-provider",
    "expiry-sweeper",
    "economic-ledger-article",
    "arc-c32-payment-forensics-article",
    "keyless-signer-article",
  ],
  concepts: [
    "domain-rail-split",
    "evidence-vs-verdict",
    "guarded-state-transitions",
    "nine-check-verdict",
    "two-level-idempotency",
    "claim-first-side-effects",
    "decimal-string-money",
    "dispute-as-refund-lock",
    "self-healing-completion",
    "honest-scope",
  ],
  topics: [
    "payments",
    "agent-economy",
    "engineering",
    "adversarial-audit",
    "reliability",
  ],
  capabilities: [
    "guarded-state-transitions",
    "nine-check-verdict",
    "request-fingerprint-dedupe",
    "claim-first-refund",
    "decimal-string-money",
    "rail-consulted-expiry",
    "provider-capability-guard",
  ],
  rules: [],
  claims: [
    {
      id: "c45-guarded-transitions",
      status: "VERIFIED",
      text: "Every payment/attempt status change flows through two transition maps with guarded applyStatus(expectedFrom, to) writes; a concurrent loser re-reads and reports persisted state instead of overwriting it.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/packages/payments/src",
        },
      ],
    },
    {
      id: "c45-nine-check-verdict",
      status: "VERIFIED",
      text: "CONFIRMED is reachable only through the 9-check verification pipeline (reference, amount, currency, provider, recipient, network, finality, tx-reuse, status) — a rail cannot self-confirm at create or via callback.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/packages/payments/src",
        },
      ],
    },
    {
      id: "c45-stripe-live-dogfood",
      status: "VERIFIED",
      text: "Live Stripe test-mode run: create → pay → CONFIRMED → REFUNDED with two concurrent refund calls producing exactly one rail refund (railRefundCount:1). The run caught a fiat-rail network-expectation bug (220-10-F1) that prompted a second audit.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS/220-payment-infrastructure-foundation/evidence",
        },
      ],
    },
    {
      id: "c45-double-audit-resolved",
      status: "VERIFIED",
      text: "Two adversarial audit rounds — BLOCK (5 Critical, 6 High, 11 Medium) then REQUEST CHANGES (1 Critical, 6 High, 8 Medium) — all findings fixed and re-verified; 114/114 tests green.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/docs/EPICS/220-payment-infrastructure-foundation/reviews",
        },
      ],
    },
  ],
  externalLinks: [
    {
      platform: "linkedin",
      url: "https://www.linkedin.com/pulse/money-layer-rail-building-payment-foundation-audit-couldnt-spread-tuaue",
    },
  ],
  content: paymentInfrastructureFoundationContent,
};
