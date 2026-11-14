import type { BlogArticle } from "../../blog-data";
import { arcC50X402GatewayContent } from "./arc-c50-x402-gateway.content";

export const article: BlogArticle = {
  slug: "arc-c50-x402-gateway",
  title:
    "We Gave Our API a Cash Register. Then We Asked an AI to Rob It — x402 Gateway on Arc",
  description:
    "Agents calling APIs have no checkout page or API key signup — they have a wallet. We built an x402 payment gateway on Arc: request → 402 challenge → signed USDC payment → resource, in one round trip. Two pilot routes live behind a flag ($0.10 passport, $0.02 FX feed), legacy rails untouched. Then an adversarial AI audit found the hole our 34 green tests missed: payment settled on-chain, accounting crashed, payer got a 500 with no receipt and a spent nonce. 1 Critical + 6 High + 9 Medium — all fixed with regression tests.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-14",
  dateModified: "2026-11-14",
  tags: [
    "payments",
    "x402",
    "usdc",
    "arc",
    "agent-economy",
    "http-402",
    "api-monetization",
    "adversarial-audit",
    "epic-223",
  ],
  readingTime: "7 min",
  shortAnswer:
    "Agents that call APIs have no checkout page, no credit card, and no API key signup — so we built an x402 payment gateway that charges per request in USDC on Arc. The flow is HTTP's forgotten 402 status finally doing its job: request → 402 challenge → signed payment → resource. Two pilot routes went live behind a flag: $0.10 for a passport issuance, $0.02 for a premium FX feed — while the legacy routes stay untouched. Then we pointed an adversarial AI audit at the money path, and it found the hole that would have taken real funds: payment settled on-chain, accounting crashed, payer got a 500 with no resource and no receipt — and the spent nonce made a retry impossible. One Critical, six High, nine Medium findings, all fixed with regression tests.",
  heroImage: "/images/blog/arc-c50-x402-gateway-hero.webp",
  ogImage: "/images/blog/arc-c50-x402-gateway-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "USDC",
    "Arc",
    "x402",
    "EIP-3009",
  ],
  entities: [
    "agentbadge-payments-package",
    "x402-payment-service-facade",
    "x402-gateway-middleware",
    "x402-settle-seam",
    "paid-resource-registry",
    "usage-record-ledger",
    "epic-223",
  ],
  concepts: [
    "http-402-payment-required",
    "server-derived-requirements",
    "tx-anchored-dedupe",
    "pre-settlement-precheck",
    "post-settle-always-serves",
    "opt-in-per-route-gate",
    "claim-not-event",
    "additive-migration",
  ],
  topics: [
    "payments",
    "agent-economy",
    "x402",
    "arc",
    "usdc",
    "api-monetization",
    "adversarial-audit",
  ],
  capabilities: [
    "x402-402-payment-challenges",
    "per-route-paid-resource-registry",
    "delegated-verify-settle-seam",
    "usage-record-append-ledger",
    "payer-wallet-agentid-binding",
    "payment-response-receipts",
    "path-scoped-prechecks",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c50-x402-gateway.md",
    },
    {
      type: "read",
      label: "Previous article: Direct USDC verification engine",
      url: "https://agentbadge.xyz/blog/arc-c48-direct-usdc-engine",
    },
    {
      type: "read",
      label: "Previous article: Checkout v2",
      url: "https://agentbadge.xyz/blog/arc-c46-checkout-two",
    },
    {
      type: "read",
      label: "Pricing",
      url: "https://agentbadge.xyz/pricing",
    },
  ],
  qa: [
    {
      question: "How does an x402 payment gateway charge per API request?",
      answer:
        "The server gates each {method, path} pair via a PaidResource registry. A request without a PAYMENT-SIGNATURE header gets a spec-compliant 402 + PAYMENT-REQUIRED carrying server-derived accepts[] (price, network, recipient — never client-controlled). The client signs an EIP-3009 authorization and retries; the middleware delegates verify+settle to the existing x402 seam, appends a UsageRecord, attaches a PAYMENT-RESPONSE receipt, then serves the resource.",
    },
    {
      question: "What did the adversarial audit find in the x402 gateway?",
      answer:
        "1 Critical + 6 High + 9 Medium. The Critical: post-settlement accounting ran unguarded, so a failure after on-chain settle returned 500 — payer charged, nonce spent, no resource, no receipt, retry impossible. Fixed by wrapping post-settle work so a paid request always serves and emits PAYMENT-RESPONSE, with failures logged for reconciliation. Highs included HEAD-request gating bypass (Hono serves HEAD via GET), client-controlled dedupe keys (now anchored on settle tx), settle-before-handler charging for dead engines (preCheck now refuses before the challenge), registry-vs-settled network misattribution, and a whole-sub-app route mount leak.",
    },
    {
      question: "Which routes are behind the x402 gateway pilot?",
      answer:
        "Two, flag-gated by X402_GATEWAY_ENABLED on Arc testnet, Arc USDC only: POST /api/v1/passport/request at $0.10 (same handler as the legacy passport rail) and GET /api/v1/fx/delta/premium at $0.02 (same snapshot as the Celo-gated legacy route, plus a payment{} receipt field in the body). Registration is a registry entry — { id, method, path, priceUsd, network } — not a new code path.",
    },
    {
      question: "What are the limits of the v1 x402 gateway?",
      answer:
        "Two pilot routes on Arc testnet only; the legacy passport rail and Celo FX gate are untouched by design. End-to-end is proven with the settlement seam stubbed at the boundary — no live testnet tx counts yet. Payments are bearer-style (a valid signature pays, not bound to one resource on the wire). One adversarial audit, fixed and re-verified — not a formal verification.",
    },
  ],
  claims: [
    {
      id: "c50-gateway-architecture",
      status: "VERIFIED",
      text: "The x402 gateway lives in src/server/lib/x402-gateway/: PaidResource registry + catalog-first PriceResolver (domain, @agentbadge/payments), X402PaymentService facade (requirements → seam delegation → UsageRecord → payer-binding agentId), and a Hono middleware that issues official @x402/core/http 402 challenges or settles and serves. Settlement stays in the pre-existing x402-settle-seam — delegated, never reimplemented.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/x402-gateway/middleware.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/x402-gateway/service.ts",
        },
      ],
    },
    {
      id: "c50-audit-1c-6h-9m-all-fixed",
      status: "VERIFIED",
      text: "Arc Studio adversarial review of the gateway returned REQUEST CHANGES (1 Critical + 6 High + 9 Medium). All Critical/High fixed in server commit 5d2643e: post-settle guard (C-1), HEAD→GET normalization (H-1), tx-anchored dedupe (H-2), path-scoped preCheck before challenge and settle (H-3), replay warn via listByPayment (H-4), network-scoped accepts + settle.sourceChain attribution (H-5), single-handler passport mount (H-6). Triage table in docs/EPICS/223-x402-payment-gateway/reviews/x402-gateway-REVIEW.md.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/x402-gateway/middleware.test.ts",
        },
      ],
    },
    {
      id: "c50-e2e-402-pay-200",
      status: "VERIFIED",
      text: "8 end-to-end tests exercise the real gateway service and middleware with the settle seam stubbed at the boundary: full 402→pay→200 cycle, PAYMENT-RESPONSE receipt, UsageRecord persistence, bound and unbound agentId, dedupe, bazaar extensions, and unregistered-route pass-through. 30 unit tests cover the same layer. Suite: tests/e2e/x402-gateway.test.ts + tests/x402-gateway/.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/e2e/x402-gateway.test.ts",
        },
      ],
    },
    {
      id: "c50-legacy-rails-untouched",
      status: "VERIFIED",
      text: "The v1 gateway is additive: pilot routes live on new /api/v1 paths behind X402_GATEWAY_ENABLED; the legacy passport issuance rail and the Celo-gated FX premium route are unchanged, and unregistered paths pass the middleware untouched.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/wiring/x402-gateway.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC50X402GatewayContent,
};
