import type { BlogArticle } from "../../blog-data";
import { supplyChainVerifiableShowcaseContent } from "./supply-chain-verifiable-showcase.content";

export const article: BlogArticle = {
  slug: "supply-chain-verifiable-showcase",
  title:
    "Brick #4: Show Me the Evidence - a Verifiable Vitrine for Agent Supply Chains",
  description:
    "A public, embeddable JSON replay endpoint - GET /api/ledger/shipments/:id - that lets anyone verify a shipment's history: canonical timeline, per-hop roles/evidence with *AssertedBy provenance, issuerIsHopParty, aggregate state and a machine-readable limits array. Includes the read-path adversarial audit story: 0 Critical, 5 High, 7 Medium findings, all fixed or documented.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-07",
  dateModified: "2026-11-07",
  tags: [
    "supply-chain",
    "verifiable-transitions",
    "economic-ledger",
    "agent-economy",
    "event-sourcing",
    "read-model",
    "public-api",
    "ai-audit",
    "arc",
  ],
  readingTime: "8 min",
  shortAnswer:
    "A shipment replay view is a public read model - GET /api/ledger/shipments/:id - that replays the append-only event log for one shipment through the canonical-sequence gate and returns status, ordered timeline, per-hop roles/evidence with provenance, aggregate state and a limits array. It proves the Bedrij sub-hypothesis that verifiability of transitions is public: anyone can check the chain, no credentials required.",
  heroImage: "/images/blog/supply-chain-verifiable-showcase-hero.webp",
  ogImage: "/images/blog/supply-chain-verifiable-showcase-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Zod",
    "event-sourcing",
    "ERC-8183",
  ],
  entities: [
    "supply-chain-pack",
    "econ-events-package",
    "shipment-replay-view",
    "canonical-seq-replay",
    "bedrij-principle-article",
    "supply-chain-participant-roles-article",
    "supply-chain-typed-evidence-article",
    "supply-chain-scenario-matrix-article",
  ],
  concepts: [
    "verifiable-vitrine",
    "replay-read-model",
    "canonical-sequence-gating",
    "provenance-annotations",
    "limits-as-contract",
    "honest-failure-modes",
    "self-declared-claims",
  ],
  topics: [
    "supply-chain",
    "agent-economy",
    "economic-ledger",
    "event-sourcing",
    "public-verification",
    "adversarial-review",
  ],
  capabilities: [
    "canonical-seq-gating",
    "event-derived-state",
    "provenance-annotations",
    "advisory-flags",
    "honest-error-codes",
    "bounded-replay",
    "public-read-endpoint",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/supply-chain-verifiable-showcase.md",
    },
    {
      type: "read",
      label: "Shipment read endpoint",
      url: "https://agentbadge.xyz/api/ledger/shipments/dogfood-1794151620383",
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
      label: "Brick #3: Scenario Matrix",
      url: "https://agentbadge.xyz/blog/supply-chain-scenario-matrix",
    },
    {
      type: "read",
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What is a shipment replay view?",
      answer:
        "A public read model - GET /api/ledger/shipments/:id - that walks the append-only supply_chain event log for one shipmentId, applies the canonical-sequence projection, and returns a ShipmentReplayResponse: status, ordered timeline, per-hop roles/evidence/jobId, aggregate (completedPct, currentCustodian, outstandingUsdc) and a limits array declaring what the view does not promise. No authentication required.",
    },
    {
      question: "How does the replay read path stay honest?",
      answer:
        "The same canonical gate that protects the write-side projection guards the view: the plan binds to the work_offer at seq 1 (first writer wins), handoff/pay/verify lift state only from canonical seqFor slots with integer in-plan hopIndex and payload.shipmentId bound to sourceId, and timeline hopIndex lifts only from canonical-slot events. Forged events lift nothing - not even status. The read-path audit added size caps (≤256 hops / ≤4096 events), warn-logged refusals, strict DECIMAL_USDC validation before BigInt, and honest error codes (400 invalid_id, 404 not_found, 503 unavailable).",
    },
    {
      question: "What is the limits array in a ShipmentReplayResponse?",
      answer:
        "A machine-readable honesty contract that travels with every response: linear hops only; manual settlement per hop; evidence is advisory - not verified; caps ≤256 hops / ≤4096 events; status lifted from canonical slots - writer trust at ledger layer. It declares the boundaries the view cannot prove - most importantly that writer authorization is a ledger-layer concern, not something the read path verifies.",
    },
    {
      question: "What did the adversarial audit of the replay endpoint find?",
      answer:
        "REQUEST CHANGES - 0 Critical, 5 High, 7 Medium. The Highs: crafted terms/payload fields reaching BigInt arithmetic (H-1), X-Forwarded-For trust shaping rate-limit buckets (H-2), no replay size caps (H-3), undocumented writer-trust assumption (H-4, accepted-documented), and arbitrary payload.hopIndex annotating the timeline (H-5). All fixed or documented with 16 regression tests in tests/supply-chain/replay-audit.test.ts; Mediums fixed or explicitly accepted.",
    },
    {
      question: "How do roles and evidence provenance work in the replay response?",
      answer:
        "Every hop carries rolesAssertedBy and evidenceAssertedBy naming the address that made the claim - roles and evidence are self-declared metadata, never verified identity. issuerIsHopParty on each evidence ref tells the reader whether the issuer is a hop party (custodian/receiver/client) or an outside source like a sensor device - verifiable from the addresses in the payload itself.",
    },
  ],
  claims: [
    {
      id: "c43-public-replay-endpoint",
      status: "VERIFIED",
      text: "GET /api/ledger/shipments/:id is a public endpoint returning ShipmentReplayResponse (status, timeline, hops with roles/evidence/provenance, aggregate, limits); unknown id → 404 not_found, malformed → 400 invalid_id, disabled/failed ledger → 503 unavailable, completed responses carry Cache-Control max-age=60.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/routes/econ-ledger-shipments-api.ts",
        },
      ],
    },
    {
      id: "c43-canonical-timeline-hopindex",
      status: "VERIFIED",
      text: "replay.ts lifts timeline hopIndex only for handoff/pay/verify events at canonical seqFor slots whose payload.shipmentId binds to the requested shipment - arbitrary payload hopIndex can no longer annotate the timeline (audit H-5); the stream refuses >4096 events / >256 hops with a warn-logged refusal (H-3).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/replay.ts",
        },
      ],
    },
    {
      id: "c43-crafted-terms-guards",
      status: "VERIFIED",
      text: "project.ts/replay.ts guard every terms/payload field before use - malformed hops entries, non-string amountUsdc and wrong-typed plan fields cannot reach BigInt arithmetic; sumUsdc validates DECIMAL_USDC_RE and throws a bounded ShipmentOrderError (audit H-1); plan membership is checked by index-set, and client binds only when terms are absent/silent/matching shipmentId (M-2/M-3).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/project.ts",
        },
      ],
    },
    {
      id: "c43-xff-trust-gate",
      status: "VERIFIED",
      text: "rate-limit.ts honours X-Forwarded-For/X-Real-IP only when TRUST_PROXY_HEADERS=true (Fly-Client-IP unchanged on Fly); MemoryStore implements evictOldest so over-capacity stores evict live entries, not only expired ones (audit H-2).",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/middleware/rate-limit.ts",
        },
      ],
    },
    {
      id: "c43-audit-resolved",
      status: "VERIFIED",
      text: "The adversarial review of the replay endpoint returned REQUEST CHANGES (0 Critical, 5 High, 7 Medium); all findings were fixed or documented in commit 330f17a (fix(215-5)) with 16 regression tests in tests/supply-chain/replay-audit.test.ts - 0 open Critical/High.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/supply-chain/replay-audit.test.ts",
        },
      ],
    },
    {
      id: "c43-limits-declared",
      status: "VERIFIED",
      text: "REPLAY_LIMITS_V1 declares five machine-readable limits in every response: linear hops only, manual settlement per hop, evidence is advisory - not verified, caps ≤256 hops / ≤4096 events, and status lifted from canonical slots - writer trust at ledger layer.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/replay-types.ts",
        },
      ],
    },
  ],
  externalLinks: [],
  content: supplyChainVerifiableShowcaseContent,
};
