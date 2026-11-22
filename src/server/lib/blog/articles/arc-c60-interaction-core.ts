import type { BlogArticle } from "../../blog-data";
import { arcC60InteractionCoreContent } from "./arc-c60-interaction-core.content";

export const article: BlogArticle = {
  slug: "arc-c60-interaction-core",
  title:
    "Agents Can Finally Talk To Us - And We Built the Inbox That Proves What Was Said",
  description:
    "EPIC-228 Agent Interaction Core, live on agentbadge.xyz: a durable inbox where external agents - anonymous, API-key, or DID-signed - submit idempotent requests that a human operator classifies, answers, or rejects. Bound sessions, terminal-state 409s, per-actor-before-global rate limits, and one append-only event log with PUBLIC (agent) and INTERNAL (attributed) projections.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-22",
  dateModified: "2026-11-22",
  tags: [
    "agent-interaction",
    "human-in-the-loop",
    "idempotency",
    "sessions",
    "audit",
    "arc",
    "epic-228",
  ],
  readingTime: "8 min",
  shortAnswer:
    "Conversations with agents used to evaporate in chat channels. EPIC-228 ships an interaction core: POST /api/v1/agent/interaction + idempotency-key returns {requestId, statusUrl, sessionId}, requests move PENDING_REVIEW→IN_REVIEW→ANSWERED|REJECTED with 409 on terminal replay, idempotent replays bind actor AND canonical payload (409 actor_mismatch / 422 payload_mismatch), sessions are actor-bound isess_* ids, and every mutation lands in one transaction with an append-only event - PUBLIC projection for the agent, INTERNAL with full attribution for operators. Verified through two Arc Studio rounds plus a probe-bot confirmation that caught a %00-in-path 500 that only existed on Postgres.",
  heroImage: "/images/blog/arc-c60-interaction-core-hero.webp",
  ogImage: "/images/blog/arc-c60-interaction-core-og.jpeg",
  status: "LIVE",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "PostgreSQL",
    "Prisma",
    "Zod",
    "HTMX",
  ],
  entities: [
    "agent-interaction-request",
    "interaction-event",
    "interaction-session",
    "idempotency-key",
    "operator-classification",
    "epic-228",
  ],
  concepts: [
    "human-in-the-loop",
    "idempotent-submit",
    "append-only-event-log",
    "public-internal-projections",
    "session-actor-binding",
    "three-identity-tiers",
    "terminal-state-guard",
    "per-actor-rate-limiting",
  ],
  topics: [
    "agent-interaction",
    "human-review",
    "support-inbox",
    "trust",
    "arc",
  ],
  capabilities: [
    "anonymous-agent-submit",
    "api-key-actor-identity",
    "did-signed-requests",
    "operator-review-queue",
    "closed-vocabulary-classification",
    "public-agent-projection",
    "append-only-internal-events",
    "legacy-inbox-deprecation",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c60-interaction-core.md",
    },
    {
      type: "read",
      label: "Previous article: verified knowledge engine",
      url: "https://agentbadge.xyz/blog/arc-c59-knowledge-engine",
    },
    {
      type: "read",
      label: "Counterparty trust on x402",
      url: "https://agentbadge.xyz/blog/arc-c58-counterparty-trust",
    },
  ],
  qa: [
    {
      question: "How does an external agent contact AgentBadge?",
      answer:
        "POST /api/v1/agent/interaction with a required idempotency-key header and a JSON body ({type, text, context?}). The response is 202 with {requestId, status, statusUrl, sessionId}; the agent polls statusUrl or GET /api/v1/agent/requests/:id for the public projection until the row reaches ANSWERED or REJECTED. Anonymous, API-key, and DID-signed identities are all accepted on the same endpoint, with different rate budgets.",
    },
    {
      question: "What does idempotency mean for agent submissions?",
      answer:
        "Replaying an idempotency-key returns the original row - but only when both the actor and the canonicalized payload match. The same key under a different actor returns 409 actor_mismatch; the same key with a different body returns 422 payload_mismatch. Retries are therefore free and safe, while ambiguous reuse is refused honestly instead of silently creating duplicates.",
    },
    {
      question: "Who answers agent requests, and how is it audited?",
      answer:
        "Human operators, via a FIFO console at /admin/interactions. Classification uses a closed vocabulary (intent, signal type, topics, demand signals, knowledge-gap flag), respond and reject are one-transaction mutations that append an event, expired rows return 410 to operator and agent alike, and terminal rows refuse re-mutation with 409. The append-only log has two projections: PUBLIC events for the agent, INTERNAL events with full operator attribution for the audit trail.",
    },
    {
      question: "What did the verification loop actually find?",
      answer:
        "Arc Studio review rounds produced zero Critical, six High and roughly nineteen Medium findings - rate-limit ordering, idempotency binding, DID pre-throttling, keyset cursor pagination, session fixation, projection leaks - all remediated. The probe-bot confirmation round then found a %00-in-path 500 that only existed against Postgres (the memory store returned 404), a reflected raw path in structured 404 responses, and hollow scenario contracts in the bot itself that had been passing on deduplicated rows.",
    },
  ],
  claims: [
    {
      id: "c60-interaction-surface-live",
      status: "VERIFIED",
      text: "agentbadge.xyz serves a public agent interaction surface: POST /api/v1/agent/interaction accepts anonymous, API-key, and DID-signed requests with a required idempotency-key and returns {requestId, statusUrl, sessionId}; GET /api/v1/agent/requests/:id and :id/status expose the public projection. Verified on production deploy a9cd2eea.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/agent-interaction/agent-interaction-api.ts",
        },
      ],
    },
    {
      id: "c60-idempotency-actor-payload-bound",
      status: "VERIFIED",
      text: "Idempotent replay binds the key to both actor and canonical payload: same key+actor+payload returns the original row, a different actor gets 409 actor_mismatch, a changed payload gets 422 payload_mismatch, and terminal rows refuse re-mutation with 409.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/interaction-store.ts",
        },
      ],
    },
    {
      id: "c60-operator-console-events",
      status: "VERIFIED",
      text: "A human operator console at /admin/interactions classifies requests against a closed vocabulary and responds or rejects in single transactions that append events; the same append-only log projects PUBLIC events to the agent and INTERNAL events with full operator attribution to admins.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/agent-interaction/agent-interaction-admin-ui.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/request-inbox/interaction-store-db.ts",
        },
      ],
    },
    {
      id: "c60-audit-probe-verification",
      status: "VERIFIED",
      text: "Verification arc: Arc Studio R1+R2 produced 0 Critical / 6 High / ~19 Medium, all remediated (commits 1a9d2461, 6d1148ac); the probe-bot prod run caught a %00-in-path 500 on Postgres fixed by a request-id regex gate (commit a9cd2eea, deployed) plus scenario-contract bugs in the bot itself. Lifecycle scenario now verifies submit→classify→respond→ANSWERED end-to-end.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/probe-bot/scenarios/interaction-lifecycle.ts",
        },
      ],
    },
  ],
  content: arcC60InteractionCoreContent,
};
