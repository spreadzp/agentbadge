import type { BlogArticle } from "../../blog-data";
import { supplyChainTypedEvidenceContent } from "./supply-chain-typed-evidence.content";

export const article: BlogArticle = {
  slug: "supply-chain-typed-evidence",
  title:
    "Brick #2: A Link Is Not a Fact — Typed Evidence in a Verifiable Supply Chain",
  description:
    "A handoff event says custody moved — but where is the proof? Brick #2 adds typed evidence references {type, hash, issuer, uri?} to the handoff payload: proof that travels with the transition, replayed with evidenceAssertedBy + issuerIsHopParty provenance. Includes the adversarial AI audit story — 0 Critical, 2 High, 7 Medium findings, all fixed or documented.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-06",
  dateModified: "2026-11-06",
  tags: [
    "supply-chain",
    "evidence",
    "economic-ledger",
    "agent-economy",
    "verifiable-transitions",
    "event-sourcing",
    "ai-audit",
    "arc",
    "provenance",
  ],
  readingTime: "7 min",
  shortAnswer:
    "Typed evidence is an optional list of {type, hash, issuer, uri?} references on a handoff event — seven write types, 1–32 refs, URI allowlist — replayed into per-hop state with evidenceAssertedBy and issuerIsHopParty provenance. A hash proves bytes existed, not that they are true; advisories warn, never block. Shipped after an adversarial AI audit (2 High, 7 Medium, all resolved).",
  heroImage: "/images/blog/supply-chain-typed-evidence-hero.webp",
  ogImage: "/images/blog/supply-chain-typed-evidence-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Zod",
    "ERC-8183",
    "event-sourcing",
  ],
  entities: [
    "supply-chain-pack",
    "econ-events-package",
    "shipment-state-replay",
    "supply-chain-participant-roles-article",
    "bedrij-principle-article",
  ],
  concepts: [
    "verifiable-state-transition",
    "typed-evidence",
    "evidence-provenance",
    "issuer-matches-party",
    "strict-write-lenient-read",
    "append-only-ledger",
    "advisory-not-enforcement",
    "link-not-fact",
  ],
  topics: [
    "supply-chain",
    "agent-economy",
    "economic-ledger",
    "verification",
    "schema-design",
    "provenance",
  ],
  capabilities: [
    "typed-evidence-refs",
    "evidence-provenance-annotations",
    "event-derived-state",
    "shipment-replay",
    "schema-split-write-read",
    "canonical-seq-gating",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/supply-chain-typed-evidence.md",
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
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What is typed evidence in a verifiable supply chain?",
      answer:
        "An optional list of {type, hash, issuer, uri?} references attached to a handoff event. Type is one of seven values (signature, gps, document, api_response, image, weight, temperature), hash is a 0x-prefixed 32-byte digest, issuer is the claiming participant, uri an optional pointer. A handoff carries 1–32 refs; replay lifts them into hops[].evidence.",
    },
    {
      question: "Does evidence verify the artifact it points to?",
      answer:
        "No — the ledger stores the reference, never fetches it. A hash proves specific bytes existed, not that they are accurate; an issuer is a self-declared claim (the same advisory layer as participant roles); resolving a URI is a trust decision each consumer makes separately. Issuer registries, countersigned evidence and oracle attestations are future layers.",
    },
    {
      question: "What are issuerIsHopParty and evidenceAssertedBy?",
      answer:
        "Read-model annotations added by the replay projection. issuerIsHopParty flags whether an evidence issuer is one of the two parties in the hop (a party vouching for its own data is weaker than an independent issuer); evidenceAssertedBy records which actor attached the refs at write time — neither exists in the stored event.",
    },
    {
      question: "What did the AI audit find in the evidence implementation?",
      answer:
        "REQUEST CHANGES with 0 Critical, 2 High, 7 Medium: no persisted issuer provenance with an inverted advisory, strict validation confined to one server wrapper so forged events replayed into public state, hostile URIs, missing cardinality pre-checks and unbounded error echoes. All fixed or documented-accepted; regression tests cover each finding.",
    },
    {
      question: "Why are the read and write schemas for evidence different?",
      answer:
        "The write path uses a closed schema (seven types, URI allowlist http(s)/ipfs/ar, no credentials, canonicalized) while the read schema keeps an open type — on an append-only log, a type added by a newer writer must never make a stored event unparseable for older clients. buildEconomicEvent defaults to strict write mode; mode: replay is for stored events.",
    },
  ],
  claims: [
    {
      id: "c41-evidence-in-handoff-payload",
      status: "VERIFIED",
      text: "Handoff events accept an evidence list of 1–32 refs {type, hash, issuer, uri?} where type is one of seven values, hash normalizes to lowercase 0x+64hex, and uri is allowlisted to http(s)/ipfs/ar and canonicalized; the write path validates via EvidenceRefWriteSchema inside buildEconomicEvent.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/claims.ts",
        },
      ],
    },
    {
      id: "c41-replay-annotations",
      status: "VERIFIED",
      text: "The replay read model lifts payload.evidence into ShipmentHop.evidence, adds per-ref issuerIsHopParty and per-hop evidenceAssertedBy, and gates claim-lifting on the canonical event sequence so forged events never enter public state.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/state.ts",
        },
      ],
    },
    {
      id: "c41-schema-split",
      status: "VERIFIED",
      text: "buildEconomicEvent defaults to strict handoff write validation and accepts mode: replay for stored events; the read schema keeps an open evidence type so future types never brick replay for older clients.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/emit.ts" },
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/state.ts" },
      ],
    },
    {
      id: "c41-audit-resolved",
      status: "VERIFIED",
      text: "An adversarial AI audit of the 213-1..3 deltas returned REQUEST CHANGES (0 Critical, 2 High, 7 Medium); all findings were fixed or documented-accepted in 213-5 with regression coverage — findings archived in docs/EPICS/213-supply-chain-evidence/reviews/.",
      evidence: [
        { type: "test", url: "https://github.com/spreadzp/agentbadge/blob/main/tests/supply-chain/replay-evidence.test.ts" },
      ],
    },
    {
      id: "c41-evidence-not-truth",
      status: "VERIFIED",
      text: "Evidence refs are advisory pointers: no fetch, no artifact verification, issuers are self-declared claims, and advisories are log warnings that never block a write.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/advisory.ts" },
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/claims.ts" },
      ],
    },
    {
      id: "c41-package-published",
      status: "VERIFIED",
      text: "@agentbadge/econ-events@0.1.3, containing the evidence schemas and strict/replay builder modes, is published on npm; 118 package tests and 35 supply-chain server tests pass.",
      evidence: [
        {
          type: "demo",
          url: "https://www.npmjs.com/package/@agentbadge/econ-events",
        },
      ],
    },
  ],
  externalLinks: [
    {
      platform: "devto",
      url: "https://dev.to/spread2009/brick-2-a-link-is-not-a-fact-typed-evidence-in-a-verifiable-supply-chain-3i68",
    },
  ],
  content: supplyChainTypedEvidenceContent,
};
