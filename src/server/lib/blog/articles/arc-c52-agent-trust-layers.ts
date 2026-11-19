import type { BlogArticle } from "../../blog-data";
import { arcC52AgentTrustLayersContent } from "./arc-c52-agent-trust-layers.content";

export const article: BlogArticle = {
  slug: "arc-c52-agent-trust-layers",
  title:
    "Trust Is Three Questions, Not One Score: Identity, Entitlements and Reputation for AI Agents",
  description:
    "Agents don't need a trust score - they need three verifiable answers. Who are you? A wallet-keyed actor whose type is derived from proofs, not self-declared. What did you buy? An entitlement a sweeper grants only from CONFIRMED payments, deny-by-default. What did you do? An append-only feed of facts, each pointing at the record it came from. Then an external AI agent (cloud Devin, ephemeral wallets) attacked the live API and found five real bugs - all fixed in v425+v426 and re-verified on production.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-17",
  dateModified: "2026-11-17",
  tags: [
    "agent-identity",
    "agent-reputation",
    "entitlements",
    "eip-191",
    "api",
    "payments",
    "audit-trail",
    "epic-225",
  ],
  readingTime: "9 min",
  shortAnswer:
    "Agents don't need a trust score - they need three verifiable answers. Who are you? - an actor whose type is derived from proofs, not self-declared. What did you buy? - an entitlement a sweeper grants only from CONFIRMED payments, deny-by-default. What did you do? - an append-only feed of facts, each pointing at the record it came from. We shipped all three under /api/v1/, advertised them in the machine descriptor - and then let an external AI agent (cloud Devin, ephemeral wallets) attack the live API. It found five real bugs our internal tests and a paid audit had missed. All five are fixed and re-verified on production.",
  heroImage: "/images/blog/arc-c52-agent-trust-layers-hero.webp",
  ogImage: "/images/blog/arc-c52-agent-trust-layers-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Postgres",
    "EIP-191",
    "Zod",
  ],
  entities: [
    "identity-api",
    "actor",
    "entitlement",
    "reputation-fact",
    "entitlement-sweeper",
    "agentbadge-machine-descriptor",
    "epic-225",
    "epic-224",
  ],
  concepts: [
    "three-layer-trust",
    "proof-derived-actor-type",
    "grant-vs-enforcement",
    "verified-purchase-only-grants",
    "deny-by-default-catalog",
    "append-only-facts",
    "source-ref-verifiability",
    "honest-empty-reads",
    "lazy-actor-upsert",
    "external-agent-verification",
  ],
  topics: [
    "agent-identity",
    "agent-reputation",
    "agent-economy",
    "api",
    "payments",
  ],
  capabilities: [
    "wallet-keyed-actor-reads",
    "owner-signed-enrich",
    "entitlement-grants-from-confirmed-payments",
    "payment-reversal-revocation",
    "append-only-reputation-facts",
    "source-verified-fact-emission",
    "machine-descriptor-identity-discovery",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c52-agent-trust-layers.md",
    },
    {
      type: "read",
      label: "Machine descriptor - identity section",
      url: "https://agentbadge.xyz/.well-known/agentbadge-machine.json",
    },
    {
      type: "read",
      label: "Previous article: agent commerce API",
      url: "https://agentbadge.xyz/blog/arc-c51-agent-commerce",
    },
  ],
  qa: [
    {
      question: "What are the three trust layers AgentBadge ships for agents?",
      answer:
        "Three independent reads under /api/v1/: GET /actors/:wallet - a wallet-keyed actor whose type (REGISTERED_*/EXTERNAL_*/ORGANIZATION) is derived from registration and passport proofs, recalculated on every write; GET /entitlements/:wallet - grants activated by a sweeper only from CONFIRMED payments that pass the product catalog gate (code, minAmount, currency, payer==owner), deny-by-default; GET /reputation/:wallet - an append-only feed of six fact types, each carrying a sourceRef to the record it came from. No opaque score.",
    },
    {
      question: "How does a payment become an entitlement grant?",
      answer:
        "A poll-based sweeper reads CONFIRMED payments and grants an Entitlement only when five checks pass: productCode is in the catalog, amount covers the declared price, currency matches, payment.customerId equals the grant owner, and the product is not already active. Grants are idempotent; the same tick revokes entitlements whose payment stopped being CONFIRMED. Catalog: 4 priced SKUs (PASSPORT_BRONZE/SILVER/GOLD/PLATINUM $9.99-$499.99) plus reserved unpriced codes that can never be bought - deny-by-default.",
    },
    {
      question: "Why is there no reputation score?",
      answer:
        "By spec: a score is unverifiable, one-dimensional and self-graded. ReputationFact stores append-only facts - TASK_COMPLETED, SUBMISSION_ACCEPTED, EVIDENCE_SUPPLIED, PAYMENT_VERIFIED, DISPUTE, ATTESTATION - each emitted post-commit by the commerce API and verified against its source via a verifySource port. A DISPUTE is a separate fact, not a negative score; readers judge the receipts themselves.",
    },
    {
      question: "What did the external agent's production verification find?",
      answer:
        "Cloud Devin ran signed e2e checks on production with ephemeral wallets and found 5 bugs internal tests and the external adversarial review had missed - all in the wiring: ensureActor was never called from commerce writes (actor 404 after signed write), fact emitters had no callers, the machine descriptor lacked the identity section, scalar requirements returned 500 instead of 400, and the sweeper crashed on pg/int8 number-vs-bigint. All fixed in v425+v426 and re-verified live.",
    },
  ],
  claims: [
    {
      id: "c52-three-layer-trust-live",
      status: "VERIFIED",
      text: "The three-layer trust surface is live on production: 5 endpoints under /api/v1/ - GET /actors/:wallet (typed 404 for unknown wallets), GET /entitlements/:wallet and GET /reputation/:wallet (honest-empty arrays), POST /actors/:wallet/enrich (owner-signed) and POST /actors/:wallet/revoke (admin).",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/api/v1/reputation/0x039a1c69e6c94cfbb4e0f4a3f1c0f59e0d59e5",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/identity/identity.ts",
        },
      ],
    },
    {
      id: "c52-verified-purchase-grants",
      status: "VERIFIED",
      text: "Entitlement grants activate only from CONFIRMED payments passing the catalog gate: productCode in ENTITLEMENT_PRODUCTS, amount >= declared price, currency match, payment.customerId == owner, not already active. Reserved unpriced codes are deny-by-default; payment reversal revokes the grant in the same tick.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/services/identity-sweeper.ts",
        },
      ],
    },
    {
      id: "c52-facts-emit-real-deal",
      status: "VERIFIED",
      text: "A real production deal emitted verifiable facts: provider 0x039a1c69 holds SUBMISSION_ACCEPTED:1 + TASK_COMPLETED:1, each with sourceRef agreement:ag_72eb4921f9f1444db9af9830 - emitted by the post-commit hook on review ACCEPTED.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/api/v1/reputation/0x039a1c69e6c94cfbb4e0f4a3f1c0f59e0d59e5",
        },
      ],
    },
    {
      id: "c52-external-audit-5-bugs",
      status: "VERIFIED",
      text: "Devin's production run found 5 wiring bugs missed by internal tests and the external adversarial review: ensureActor not wired to commerce writes (234-16), fact emitters with no callers (234-17), missing identity section in the machine descriptor (234-18), scalar requirements returning 500 (234-23), sweeper crash on pg/int8 (234-24). All fixed in v425+v426, re-verified on prod.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/commit/12d9640",
        },
      ],
    },
  ],
  externalLinks: [],
  content: arcC52AgentTrustLayersContent,
};
