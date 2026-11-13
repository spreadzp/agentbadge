import type { BlogArticle } from "../../blog-data";
import { arcC46CheckoutTwoContent } from "./arc-c46-checkout-two.content";

export const article: BlogArticle = {
  slug: "arc-c46-checkout-two",
  title:
    "Checkout 2.0, Audited Before It Sold Anything: Commerce Catalog, Dual Rails, and the 20-Finding Fix",
  description:
    "Checkout rebuilt on the EPIC-220 payments core: a commerce catalog that owns product metadata schemas, one Payment → Attempt → instructions → status → receipt API serving Stripe card and USDC (Arc default), a fulfillment registry with durable claim/done markers — and an adversarial audit that blocked release with 3 Critical / 9 High / 8 Medium findings, all fixed and regression-tested before the first real sale.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-12",
  dateModified: "2026-11-12",
  tags: [
    "checkout",
    "payments",
    "commerce-catalog",
    "stripe",
    "usdc",
    "arc",
    "adversarial-audit",
    "fulfillment",
    "idempotency",
    "epic-221",
  ],
  readingTime: "9 min",
  shortAnswer:
    "We rebuilt checkout as a catalog-driven flow on the EPIC-220 payments core: POST /api/v1/payments → attempt (Stripe redirect or USDC instructions, Arc default) → status → receipt, with a fulfillment registry joining 'paid' to 'delivered'. An adversarial audit blocked it — 3 Critical, 9 High, 8 Medium — and all twenty findings got root-cause fixes plus 17 regression tests: durable event-store claim/done markers, webhook session-to-attempt binding, idempotency fingerprint conflicts, schema-first metadata validation, a feature-gated USDC rail, and unique per-payment micro-unit amounts. Live dogfood on eip155:1874: 77/77 payment-checkout tests green.",
  heroImage: "/images/blog/arc-c46-checkout-two-hero.webp",
  ogImage: "/images/blog/arc-c46-checkout-two-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Stripe",
    "USDC",
    "Arc",
    "Zod",
    "Vitest",
  ],
  entities: [
    "commerce-catalog",
    "epic-221",
    "payments-checkout",
    "stripe-payment-provider",
    "direct-usdc-stub-provider",
    "fulfillment-registry",
    "payment-infrastructure-foundation-article",
    "arc-c32-payment-forensics-article",
  ],
  concepts: [
    "catalog-driven-checkout",
    "domain-rail-split",
    "dual-rail-payments",
    "durable-fulfillment-dedupe",
    "session-attempt-binding",
    "idempotency-fingerprint",
    "schema-first-metadata",
    "feature-gated-rails",
    "unique-amount-dedupe",
    "adversarial-audit",
    "soft-migration",
  ],
  topics: [
    "payments",
    "checkout",
    "engineering",
    "adversarial-audit",
    "reliability",
    "arc",
  ],
  capabilities: [
    "payment-attempt-instructions-flow",
    "fulfillment-claim-done-markers",
    "webhook-session-binding",
    "idempotency-fingerprint-dedupe",
    "catalog-metadata-validation",
    "unique-usdc-amount-suffix",
    "attempt-reuse",
    "legacy-deprecation-headers",
  ],
  rules: [],
  claims: [
    {
      id: "c46-catalog-checkout-live",
      status: "VERIFIED",
      text: "Checkout is catalog-driven end to end: product → payment → attempt (STRIPE redirect or DIRECT_USDC instructions) → status polling → receipt. Passport tiers sell Card (Stripe) or USDC — Arc default, Base and Solana selectable — while HBAR mint stays a separate legacy action.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/src/server/lib/commerce-catalog",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/checkout-pages.ts",
        },
      ],
    },
    {
      id: "c46-audit-block-resolved",
      status: "VERIFIED",
      text: "Arc Studio adversarial audit returned BLOCK — 3 Critical, 9 High, 8 Medium. All findings fixed at root cause with regression coverage: fulfillment completion only after handler success, durable claim/done event-store markers with 10-minute stale-claim retry, webhook session-to-attempt binding, idempotency fingerprint conflict (409), schema-first metadata validation, feature-gated USDC rail, unique per-payment micro-unit amounts.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/221-pricing-checkout-2/reviews/checkout-REVIEW.md",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/221-pricing-checkout-2/reviews/REVIEW-FINDINGS.md",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/checkout-audit-221-7.test.ts",
        },
      ],
    },
    {
      id: "c46-live-usdc-arc",
      status: "VERIFIED",
      text: "Live dogfood: POST /api/v1/payments (PASSPORT_BRONZE, strict catalog metadata) → DIRECT_USDC attempt on eip155:1874 returned instructions with a unique amount (9.990044 USDC — deterministic payment-specific suffix), Arc USDC token contract, treasury recipient, reference bound to the payment ID, and one-hour TTL. Status endpoint polls PROCESSING with attempt state.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/src/server/lib/payments-api",
        },
      ],
    },
    {
      id: "c46-soft-migration",
      status: "VERIFIED",
      text: "Legacy /payment and /checkout endpoints keep working behind Deprecation/Sunset/Link headers; docs/payments-v1-migration.md maps legacy payloads to v1 field by field. 77/77 payment-checkout tests green across seven focused suites.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/payments-v1-migration.md",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/contract-guards.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC46CheckoutTwoContent,
};
