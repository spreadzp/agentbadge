import type { BlogArticle } from "../../blog-data";
import { arcC61FeedbackReviewContent } from "./arc-c61-feedback-review.content";

export const article: BlogArticle = {
  slug: "arc-c61-feedback-review",
  title:
    'Agents Can Finally Say "This Is Broken" - And Every Verdict Comes Back Stamped "Advisory, Human"',
  description:
    "EPIC-230 Feedback & Review Infrastructure, live on agentbadge.xyz: typed agent feedback with per-actor deduplication, rubric-based human review requests, an operator review center where only the assignee can decide, append-only decisions reachable only through one atomic write, and public projections stamped binding:ADVISORY_HUMAN - a human's opinion, honestly labeled, never an engine verdict.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-22",
  dateModified: "2026-11-22",
  tags: [
    "agent-feedback",
    "human-review",
    "advisory",
    "idempotency",
    "append-only",
    "arc",
    "epic-230",
  ],
  readingTime: "8 min",
  shortAnswer:
    "External agents needed two channels our inbox couldn't give them - a typed lane for 'this is broken' that dedupes instead of stacking rows, and a way to request a structured human review against a criteria rubric. EPIC-230 ships feedback and review endpoints, an operator review center, and a poll-only delivery model where the public projection is stamped binding:ADVISORY_HUMAN. The agent writes; the human decides; the label says who answered for it.",
  heroImage: "/images/blog/arc-c61-feedback-review-hero.webp",
  ogImage: "/images/blog/arc-c61-feedback-review-og.jpeg",
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
    "feedback",
    "feedback-event",
    "review-case",
    "review-evidence",
    "review-decision",
    "review-event",
    "idempotency-key",
    "knowledge-draft",
    "epic-230",
  ],
  concepts: [
    "human-in-the-loop",
    "advisory-review",
    "per-actor-deduplication",
    "idempotent-submit",
    "append-only-event-log",
    "criteria-rubric",
    "assignee-ownership",
    "compare-and-swap-conversion",
    "whitelist-projection",
    "poll-only-delivery",
  ],
  topics: [
    "agent-feedback",
    "human-review",
    "review-pipeline",
    "trust",
    "arc",
  ],
  capabilities: [
    "anonymous-agent-submit",
    "api-key-actor-identity",
    "typed-feedback-intake",
    "rubric-criteria-review",
    "operator-review-queue",
    "knowledge-draft-conversion",
    "public-agent-projection",
    "append-only-decisions",
    "per-actor-rate-limiting",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/arc-c61-feedback-review.md",
    },
    {
      type: "read",
      label: "Previous article: agent interaction inbox",
      url: "https://agentbadge.xyz/blog/arc-c60-interaction-core",
    },
    {
      type: "read",
      label: "Verified knowledge for agents",
      url: "https://agentbadge.xyz/blog/arc-c59-knowledge-engine",
    },
  ],
  qa: [
    {
      question: "How does an external agent report a bug to AgentBadge?",
      answer:
        "POST /api/v1/agent/feedback with a required idempotency-key header and a strict JSON body {text, kind?, target?, severity?}. The response is 202 with {feedbackId, status, statusUrl}; the agent polls statusUrl for triage state. Reports are normalized and deduplicated per actor - a second report of the same issue lands as an event on the existing row, not a new row. Severity is an agent hint the operator may rewrite at triage.",
    },
    {
      question: "How does an agent request a human review of its work?",
      answer:
        "POST /api/v1/agent/reviews with {reviewType, workRef, agentCriteria?, evidence?} where reviewType is API_SURFACE, DOCS, CODE_SNIPPET, INTEGRATION, or OTHER - each mapping to a platform criteria template. The case moves PENDING_TRIAGE → IN_REVIEW (operator claim sets the assignee) → DECIDED via a single atomic write. The agent can attach evidence while PENDING_TRIAGE via POST /reviews/:id/evidence and polls statusUrl for the public projection.",
    },
    {
      question: "What does binding:ADVISORY_HUMAN mean in a review projection?",
      answer:
        "It marks the review outcome as a human operator's opinion, not a machine verdict. The projection carries binding:ADVISORY_HUMAN and decidedBy:OPERATOR in the payload itself - the review is not an EaaS engine verdict, not an onchain attestation, and not a reputation score. The agent decides what to do with the opinion. The projection is a whitelist: criterion notes, assignee identity, and idempotency internals are not exposed.",
    },
    {
      question: "What did the verification arc find for the feedback/review epic?",
      answer:
        "Arc Studio adversarial review returned REQUEST CHANGES with 0 Critical, 3 High, 14 Medium - a double-convert race, an orphan-draft-after-CAS-loss path, and a DECIDED state reachable through the generic transition table - all remediated with CAS marking, withdraw compensation, and a store-level edge refusal. The deploy itself caught two infra traps: ams region image-pull degradation (release machines stuck 50+ minutes) and bunx prisma OOM on 256MB release machines with the exit code masked to 0 by a tail pipe. A probe-bot prod run confirmed submit 202, rate-limit 429 on both POST routes, idempotent replay with no duplicate row, and clean public projections.",
    },
  ],
  claims: [
    {
      id: "c61-feedback-surface-live",
      status: "VERIFIED",
      text: "agentbadge.xyz serves a public agent feedback surface: POST /api/v1/agent/feedback accepts strict-schema reports {text, kind?, target?, severity?} with a required idempotency-key and returns {feedbackId, status, statusUrl}; GET /api/v1/agent/feedback/:id exposes the projection. Verified on production deploy 6a110850 with prod rows fb_6d107fdc and bot-probe submissions.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/feedback-review/agent-feedback-api.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/feedback/service.ts",
        },
      ],
    },
    {
      id: "c61-review-pipeline-atomic-decide",
      status: "VERIFIED",
      text: "Review cases move PENDING_TRIAGE → IN_REVIEW → DECIDED where DECIDED is reachable only through decideReview - one atomic write appending the sequence-numbered decision, flipping the case, and stamping deliveredAt; the generic transition table refuses the edge on both memory and Postgres stores (parity test). Only the assignee can decide, every rubric criterion requires an explicit result, and NA on a required criterion blocks approve.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/reviews/decide.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/reviews/decide-guards.ts",
        },
      ],
    },
    {
      id: "c61-advisory-projection-whitelist",
      status: "VERIFIED",
      text: "Public review projections carry binding:ADVISORY_HUMAN and decidedBy:OPERATOR, with criterion notes, assignee, fingerprints, and idempotency internals stripped - delivery is poll-only via statusUrl. Confirmed by the probe-bot projection-denylist scenario on prod (200, no denylisted fields).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/feedback-review/agent-reviews-api.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/scripts/probe-bot/registry.yaml",
        },
      ],
    },
    {
      id: "c61-dedupe-idempotency-verified",
      status: "VERIFIED",
      text: "Feedback deduplication is normalized + actor-scoped (repeat reports merge as events, not new rows), and idempotent replay binds key to actor and canonical payload - verified on prod: replay returned 200 with no duplicate row, prod PG holds 3 RECEIVED feedback, 2 PENDING_TRIAGE review cases, 6 feedback.received events.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/feedback/normalize.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/230-feedback-review/evidence/devin-prod-verify.md",
        },
      ],
    },
    {
      id: "c61-audit-remediation-verified",
      status: "VERIFIED",
      text: "Arc Studio R1 returned REQUEST CHANGES (0C/3H/14M); remediation added CAS conversion marking, orphan-draft withdraw compensation, store-level DECIDED refusal, actor-scoped dedupe, and delta-based pending gauges - 325/325 db tests green, db package 0.6.31 published. Probe-bot prod verification: 202 submit, 400→429 negatives, replay 200 no duplicate, 36x404 method fuzz.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/docs/EPICS/230-feedback-review/reviews/arc-REMEDIATION-R1.md",
        },
      ],
    },
  ],
  content: arcC61FeedbackReviewContent,
};
