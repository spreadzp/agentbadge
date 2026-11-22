import type { BlogArticle } from "../../blog-data";
import { arcC59KnowledgeEngineContent } from "./arc-c59-knowledge-engine.content";

export const article: BlogArticle = {
  slug: "arc-c59-knowledge-engine",
  title:
    "We Gave Our Agent a Knowledge Base That Would Rather Say \"I Don't Know\" Than Guess",
  description:
    "EPIC-229 Knowledge Engine, live on agentbadge.xyz: versioned knowledge items behind a human-only approval workflow (DRAFT→PENDING→VERIFIED→PUBLISHED→WITHDRAWN), Postgres FTS with parameterized plainto_tsquery, and a deterministic ask composer that ANSWERs with sources - or REFUSES and files the miss as a tracked knowledge gap. No LLM in the answer path, no vector DB, published-only reads verified by a probe-bot lifecycle scenario plus an external adversarial code audit (19 findings remediated).",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-21",
  dateModified: "2026-11-22",
  tags: [
    "knowledge-engine",
    "full-text-search",
    "approval-workflow",
    "agent-readiness",
    "audit",
    "arc",
    "epic-229",
  ],
  readingTime: "8 min",
  shortAnswer:
    "An agent that answers from memory invents sources. EPIC-229 ships a knowledge engine where every answerable fact is a versioned, human-approved item: operators move items through DRAFT→PENDING→VERIFIED→PUBLISHED under a strict operator allowlist plus separation-of-duties (verifier≠submitter, publisher≠verifier), public search runs Postgres FTS over published versions only, and the ask endpoint is a deterministic coverage scorer - ANSWERED with sources+confidence, or REFUSED insufficient_verified_knowledge, which writes a deduplicated knowledge gap. Verified through four audit rounds - wire-level probes plus two external Arc Studio code audits that found and fixed 38 findings - and a probe-bot lifecycle scenario that now owns the regression forever.",
  heroImage: "/images/blog/arc-c59-knowledge-engine-hero.webp",
  ogImage: "/images/blog/arc-c59-knowledge-engine-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "PostgreSQL FTS",
    "Prisma",
    "Zod",
    "Tailwind",
  ],
  entities: [
    "knowledge-item",
    "knowledge-version",
    "knowledge-gap",
    "knowledge-capability",
    "published-version-pointer",
    "epic-229",
  ],
  concepts: [
    "verified-knowledge",
    "approval-workflow",
    "append-only-versioning",
    "human-only-publish",
    "published-only-projection",
    "deterministic-answer-composer",
    "honest-refusal",
    "knowledge-gap-tracking",
    "full-text-search",
    "audit-event-trail",
  ],
  topics: [
    "agent-knowledge",
    "search",
    "content-approval",
    "trust",
    "arc",
  ],
  capabilities: [
    "published-only-knowledge-search",
    "deterministic-ask-with-refusal",
    "knowledge-gap-recording",
    "versioned-approval-workflow",
    "typed-relations-and-evidence",
    "capability-registry-drift-check",
    "operator-ssr-console",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c59-knowledge-engine.md",
    },
    {
      type: "view-demo",
      label: "Agent knowledge search (live)",
      url: "https://agentbadge.xyz/api/v1/agent/knowledge/search?q=x402",
    },
    {
      type: "read",
      label: "Previous article: counterparty trust",
      url: "https://agentbadge.xyz/blog/arc-c58-counterparty-trust",
    },
    {
      type: "read",
      label: "Next: agent interaction inbox",
      url: "https://agentbadge.xyz/blog/arc-c60-interaction-core",
    },
  ],
  qa: [
    {
      question: "How does an agent get a verified answer from AgentBadge?",
      answer:
        "Two public, read-only routes. GET /api/v1/agent/knowledge/search?q= runs Postgres full-text search over PUBLISHED knowledge versions and returns items with ts_headline snippets, rank, and the engine used. POST /api/v1/agent/knowledge/ask runs a deterministic composer: it searches, scores term coverage, and either returns ANSWERED with assembled text, source items, related items and a numeric confidence - or REFUSED with insufficient_verified_knowledge, which records a knowledge gap. Both surfaces are no-store and share a 10 req/min anonymous rate limit.",
    },
    {
      question: "Why is there no LLM or vector database in the answer path?",
      answer:
        "By design. The moment a model writes the answer, the answer is only as trustworthy as the model. The composer instead scores coverage deterministically and refuses below threshold; a refusal becomes a deduplicated knowledge-gap record, so every unanswered question turns into tracked work instead of a hallucination. Search is lexical (Postgres FTS), not semantic - a vocabulary miss yields a refusal and a gap signal rather than a fuzzy match presented as verified.",
    },
    {
      question: "Who can publish knowledge, and how is it enforced?",
      answer:
        "Only operator actor refs may move an item into VERIFIED or PUBLISHED: refs must match a strict [a-z0-9._@-] allowlist (agent-shaped forms like did:, agt_, agent, bot, svc, key: are refused outright), and the workflow enforces separation of duties - verifier≠submitter, publisher≠verifier, recovered from the persisted audit events. A version needs at least one evidence reference before it can enter VERIFIED. Every admin mutation requires an x-operator-id header for attribution plus an idempotency-key bound to the request body. Items are immutable-versioned - edits create new version rows and the publishedVersionId pointer only moves through the CAS-guarded workflow, so history is never rewritten.",
    },
    {
      question: "What did the verification loop actually find?",
      answer:
        "Three waves. Wire-level local audit round 1 found x-operator-id unenforced and NUL bytes in write bodies causing 500s; round 2 went GREEN 50/50. The production audit then found NUL bytes on READ paths producing unauthenticated 500s (fixed 6fc16185, deployed 22d5c3ef). A probe-bot pass re-verified prod deterministically: 142 knowledge cases, 0 failures. An external Arc Studio code audit then found 19 findings - 0 critical, 5 high (operator-identity unicode bypasses, idempotency keys ignoring the request body, version-submission TOCTOU, mutable published evidence, unbounded anonymous gap writes) - remediated into a 14-test regression file. A confirmation audit found 19 more - 0 critical, 3 high including a real regression in our own dedupe fix - now replaced by single-use form tokens, approval gates inside the row lock, an evidence freeze at submit-time, and a locked recursive SUPERSEDES cycle check.",
    },
  ],
  claims: [
    {
      id: "c59-knowledge-surface-live",
      status: "VERIFIED",
      text: "agentbadge.xyz serves a public, read-only knowledge surface for agents: GET /api/v1/agent/knowledge/search returns published items with FTS snippets and reports engine:\"FTS\" on the live Postgres GIN index; POST /api/v1/agent/knowledge/ask returns deterministic ANSWERED/REFUSED verdicts. Verified on production deploy 22d5c3ef.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/api/v1/agent/knowledge/search?q=x402",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/agent-knowledge-api.ts",
        },
      ],
    },
    {
      id: "c59-human-only-publish",
      status: "VERIFIED",
      text: "Knowledge items move DRAFT→PENDING→VERIFIED→PUBLISHED→WITHDRAWN through CAS-guarded transitions with audit events; operator refs pass a strict [a-z0-9._@-] allowlist with agent-shaped forms refused, separation of duties is enforced from persisted events (verifier≠submitter, publisher≠verifier), VERIFIED requires evidence, mutations require x-operator-id + body-bound idempotency-key, and only PUBLISHED versions are visible on the public surface.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/knowledge/workflow.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/admin-operator-guard.ts",
        },
      ],
    },
    {
      id: "c59-refusal-records-gap",
      status: "VERIFIED",
      text: "The deterministic ask composer refuses below its coverage threshold with insufficient_verified_knowledge and records a normalized, deduplicated knowledge gap - unanswered agent questions become tracked work, not hallucinations. EPIC-228's inbox also files gaps via the recordInteractionGap seam.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/knowledge/composer.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/knowledge/gaps.ts",
        },
      ],
    },
    {
      id: "c59-audit-to-probe-regression",
      status: "VERIFIED",
      text: "Verification arc: local audit r1 PARTIAL (operator-id unenforced, NUL write 500s) → r2 GREEN 50/50 → prod audit found NUL read-path 500s (fixed 6fc16185, deployed 22d5c3ef) → probe-bot prod pass 142 knowledge cases / 0 failures incl. ?q=%00→400 and no-store on all surfaces → external Arc Studio code audit R1 found 19 findings (0C/5H/14M: operator-identity bypasses, idempotency body-binding, version TOCTOU, mutable published evidence, unbounded gap writes) — all remediated with a 14-test regression file; a knowledge-lifecycle scenario now walks create→publish→withdraw→terminal-409 deterministically.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/229-knowledge-engine/evidence/prod-verify-229.md",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/probe-bot/scenarios/knowledge-lifecycle.ts",
        },
      ],
    },
  ],
  content: arcC59KnowledgeEngineContent,
};
