import type { BlogArticle } from "../../blog-data";
import { supplyChainScenarioMatrixContent } from "./supply-chain-scenario-matrix.content";

export const article: BlogArticle = {
  slug: "supply-chain-scenario-matrix",
  title:
    "Brick #3: Seven Ways to Break a Chain — a Scenario Matrix for Verifiable Supply Chains",
  description:
    "Seven violation scenarios — undeclared telemetry, fake sensor, missing evidence, GPS anomaly, receiver dispute, double settle — run the shipment lifecycle on an in-memory stack and pin the regression contract before testnet. Includes the adversarial AI audit story: 0 Critical, 6 High, 7 Medium findings, all fixed or documented.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-07",
  dateModified: "2026-11-07",
  tags: [
    "supply-chain",
    "testing",
    "regression",
    "economic-ledger",
    "agent-economy",
    "verifiable-transitions",
    "ai-audit",
    "arc",
    "event-sourcing",
  ],
  readingTime: "8 min",
  shortAnswer:
    "A scenario matrix is a fixed set of end-to-end test scenarios — happy path plus named violations — that run a shipment through offer → handoff → settle → verify on an in-memory ledger, then assert replayed state and advisory flags. Ours covers seven scenarios S1–S7, survives an adversarial AI audit (0 Critical, 6 High, all fixed), and proves the primitive's state machine stays honest under violations — while flags stay advisory, never blocking, in v1.",
  heroImage: "/images/blog/supply-chain-scenario-matrix-hero.webp",
  ogImage: "/images/blog/supply-chain-scenario-matrix-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Vitest",
    "Zod",
    "ERC-8183",
    "event-sourcing",
  ],
  entities: [
    "supply-chain-pack",
    "econ-events-package",
    "shipment-state-replay",
    "scenario-matrix",
    "chain-fixture",
    "supply-chain-typed-evidence-article",
    "supply-chain-participant-roles-article",
    "bedrij-principle-article",
  ],
  concepts: [
    "scenario-matrix",
    "regression-contract",
    "canonical-sequence-gating",
    "advisory-not-enforcement",
    "exactly-once-settlement",
    "non-vacuous-tests",
    "forged-event-replay",
    "pre-settle-dispute",
  ],
  topics: [
    "supply-chain",
    "agent-economy",
    "economic-ledger",
    "testing",
    "adversarial-review",
    "event-sourcing",
  ],
  capabilities: [
    "canonical-seq-gating",
    "evaluator-gated-verify",
    "pre-settle-dispute",
    "atomic-shipment-create",
    "advisory-flags",
    "exactly-once-settle",
    "in-memory-hop-executor",
    "event-derived-state",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/supply-chain-scenario-matrix.md",
    },
    {
      type: "read",
      label: "Shipment read endpoint",
      url: "https://agentbadge.xyz/api/ledger/shipments/demo",
    },
    {
      type: "read",
      label: "Anchor: The Bedrij Principle",
      url: "https://agentbadge.xyz/blog/bedrij-principle",
    },
    {
      type: "read",
      label: "Brick #1: Typed Participants",
      url: "https://agentbadge.xyz/blog/supply-chain-participant-roles",
    },
    {
      type: "read",
      label: "Brick #2: Typed Evidence",
      url: "https://agentbadge.xyz/blog/supply-chain-typed-evidence",
    },
    {
      type: "read",
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What is a supply-chain scenario matrix?",
      answer:
        "A fixed set of end-to-end test scenarios — a happy path plus named violations — that drive a shipment through offer → handoff → settle → verify on an in-memory ledger and executor, then assert the replayed state and advisory flags. Each scenario answers one question: if this goes wrong, does the state machine stay honest?",
    },
    {
      question: "What do the seven scenarios S1–S7 cover?",
      answer:
        "S1 happy path (3 hops verified, zero flags); S2 temperature from a non-party, non-device source → tempViolation; S3 telemetry issuer ≠ declared roles.device → fakeSensor (incl. the type:'org' evasion); S4 a handoff with no evidence → missingEvidence; S5 gps ref from a foreign issuer → gpsAnomaly; S6 receiver dispute → disputed flag, settle refused; S7 concurrent settle → exactly-once (one executor call, one pay event).",
    },
    {
      question: "Do the advisory flags block settlement in v1?",
      answer:
        "No — flags are advisory, never blocking. A tempViolation does not hold the payment; it records that a violation was asserted. Disputes are the exception: a disputed hop refuses settle while the flag stands. Automatic enforcement is a dispute-engine problem for a later brick.",
    },
    {
      question: "What did the adversarial AI audit find in the scenario matrix?",
      answer:
        "REQUEST CHANGES with 0 Critical, 6 High, 7 Medium findings. The Highs included: forged events lifting state in replay (H-1), outcome 'inconclusive' promoting a hop to verified (H-2), verifyHop without evaluator check or lock (H-3), concurrent createShipment minting orphan funded jobs (H-4), silent settle/append divergence (H-5), and vacuous scenario assertions (H-6). All six fixed with regression tests; three Mediums documented-accepted.",
    },
    {
      question: "How does the canonical-sequence gate work in the replay projection?",
      answer:
        "The projection runs two passes: the plan binds to the work_offer at seq 1 (first writer wins), then handoff/pay/verify events lift state only when they land in the canonical seqFor(hop, kind) slot, carry an integer in-plan hopIndex, and bind payload.shipmentId to the event's sourceId. A forged event lifts nothing — not even status.",
    },
  ],
  claims: [
    {
      id: "c42-scenario-matrix-coverage",
      status: "VERIFIED",
      text: "tests/supply-chain/scenario-matrix.test.ts contains 18 tests covering seven scenarios S1–S7 plus audit-hardening cases (forged events, concurrent create, dispute/settle races, lock contention, settle-ok/append-fail divergence); the supply-chain suite reports 72/72 passing.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/tests/supply-chain/scenario-matrix.test.ts",
        },
      ],
    },
    {
      id: "c42-canonical-seq-projection",
      status: "VERIFIED",
      text: "src/server/lib/econ-ledger/supply-chain/project.ts binds the plan to the seq-1 work_offer (first-wins) and lifts handoff/pay/verify only from canonical seqFor(hop, kind) slots with integer in-plan hopIndex and payload.shipmentId bound to sourceId; only outcome 'pass' promotes to verified.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/econ-ledger/supply-chain/project.ts",
        },
      ],
    },
    {
      id: "c42-evaluator-dispute-guards",
      status: "VERIFIED",
      text: "verifyHop runs inside withHopLock, refuses disputed hops, and gates actor === evaluator (hops[i+1].receiver ?? client); disputeHop is pre-settle only (status < paid) and fails closed when hop.receiver is unset.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/econ-ledger/supply-chain/verify.ts",
        },
      ],
    },
    {
      id: "c42-atomic-create",
      status: "VERIFIED",
      text: "createShipment wraps the existence check, executor job creation, and work-offer append in withHopLock(shipmentId) so concurrent creates cannot mint orphan funded job sets.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/econ-ledger/supply-chain/shipment.ts",
        },
      ],
    },
    {
      id: "c42-audit-resolved",
      status: "VERIFIED",
      text: "An adversarial AI audit of the 214-1..3 deltas returned REQUEST CHANGES (0 Critical, 6 High, 7 Medium); all Highs were fixed in commit de2cf81 with per-finding regression tests, and Mediums M-5/M-6/M-7 were documented-accepted in decisions.md (D-214-5).",
      evidence: [],
    },
    {
      id: "c42-flags-advisory",
      status: "VERIFIED",
      text: "Advisory flags (tempViolation, fakeSensor, missingEvidence, gpsAnomaly, disputed) are derived in replay and never block a write or settle; only the disputed flag gates settleHop while it stands.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/hackathon/server/src/server/lib/econ-ledger/supply-chain/advisory.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: supplyChainScenarioMatrixContent,
};
