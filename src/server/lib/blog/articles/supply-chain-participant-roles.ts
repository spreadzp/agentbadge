import type { BlogArticle } from "../../blog-data";
import { supplyChainParticipantRolesContent } from "./supply-chain-participant-roles.content";

export const article: BlogArticle = {
  slug: "supply-chain-participant-roles",
  title: "Brick #1: Any Node Can Hand Off — Typed Participants in a Verifiable Supply Chain",
  description:
    "A handoff event says custody moved from one address to another — but not WHO those addresses are. Brick #1 adds typed participant roles (custodian/operator/device/sensor) to the handoff payload: orgs, agents and devices in a single primitive, replayed with provenance. Includes the adversarial AI audit story — 0 Critical, 4 High findings, all fixed and re-verified.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-29",
  dateModified: "2026-10-29",
  tags: [
    "supply-chain",
    "participant-roles",
    "economic-ledger",
    "agent-economy",
    "verifiable-transitions",
    "event-sourcing",
    "ai-audit",
    "arc",
    "evidence",
  ],
  readingTime: "7 min",
  shortAnswer:
    "Participant roles are optional typed declarations of who participated in a hop — custodian, operator, device, sensor — carried in the handoff event and replayed into per-hop state with rolesAssertedBy provenance. Self-declared, never identity: no guard consults them. Shipped after an adversarial AI audit (4 High findings, all fixed).",
  heroImage: "/images/blog/supply-chain-participant-roles-hero.webp",
  ogImage: "/images/blog/supply-chain-participant-roles-og.jpeg",
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
    "economic-ledger-article",
    "bedrij-principle-article",
  ],
  concepts: [
    "verifiable-state-transition",
    "participant-roles",
    "self-declared-claims",
    "claim-provenance",
    "strict-write-lenient-read",
    "append-only-ledger",
    "advisory-not-enforcement",
  ],
  topics: [
    "supply-chain",
    "agent-economy",
    "economic-ledger",
    "verification",
    "schema-design",
  ],
  capabilities: [
    "typed-participant-roles",
    "role-provenance",
    "event-derived-state",
    "shipment-replay",
    "schema-split-write-read",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/supply-chain-participant-roles.md",
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
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What are participant roles in a verifiable supply chain?",
      answer:
        "Optional typed declarations of who participated in a hop — custodian, operator, device, sensor — each an address plus one of seven types (org, agent, device, robot, drone, service, human) and an optional display label. They travel inside the handoff event payload and surface in the replayed hop state.",
    },
    {
      question: "Are participant roles verified identities?",
      answer:
        "No — they are self-declared claims by the handoff actor, recorded with provenance via rolesAssertedBy. No authorization, payment or custody guard consults them; labels are display-only. Verified identity, countersigned roles and a participant registry are separate, future layers.",
    },
    {
      question: "Why must custodian.address equal the handoff counterparty?",
      answer:
        "Because custodian is the one slot whose meaning the ledger already defines — it IS the party taking custody. Letting it name an arbitrary address would let a handoff claim contradict its own custody transfer; other slots (operator/device/sensor) may legitimately be third parties.",
    },
    {
      question: "What did the AI audit find in the participant-roles implementation?",
      answer:
        "REQUEST CHANGES with 0 Critical, 4 High, 6 Medium: roles lacked provenance, custodian could contradict the custody model, repeat handoffs could rewrite roles, and caller-supplied epcis could override guarded payload fields. All fixed; re-audit returned APPROVE WITH NITS.",
    },
    {
      question: "Why are the read and write schemas for roles different objects?",
      answer:
        "The write path uses a strict schema (unknown keys reject loudly, addresses normalize, consistency refines) while the read schema stays lenient — on an append-only log, tightening a rule tomorrow must never make a stored event unparseable. The read contract can only grow more permissive.",
    },
  ],
  claims: [
    {
      id: "c39-roles-in-handoff-payload",
      status: "VERIFIED",
      text: "Handoff events accept an optional roles object {custodian?, operator?, device?, sensor?} where each role is an EVM address, one of seven types and an optional label; the write path validates via ParticipantRolesWriteSchema (strict, lowercase-normalizing, consistency-refined).",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/state.ts" },
      ],
    },
    {
      id: "c39-replay-provenance",
      status: "VERIFIED",
      text: "The replay read model lifts roles into ShipmentHop.roles with structuredClone (no shared references), records the asserting actor in rolesAssertedBy, and uses first-event-wins so a later roles-less event cannot clear them.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/state.ts" },
      ],
    },
    {
      id: "c39-custodian-equals-counterparty",
      status: "VERIFIED",
      text: "Write-side validation rejects a custodian whose address differs from the handoff counterparty (case-insensitive), and rejects one address carrying two different role types.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/state.ts" },
      ],
    },
    {
      id: "c39-audit-approve-with-nits",
      status: "VERIFIED",
      text: "An adversarial AI audit of the 212-1..3 deltas returned REQUEST CHANGES (0 Critical, 4 High, 6 Medium); after fixes the re-audit returned APPROVE WITH NITS — findings archived in docs/EPICS/212-supply-chain-participant-roles/reviews/.",
      evidence: [],
    },
    {
      id: "c39-roles-not-identity",
      status: "VERIFIED",
      text: "Roles are self-declared advisory claims: no guard, auth or settlement path reads them; labels are display-only text and look-alike strings are an accepted residual risk.",
      evidence: [],
    },
  ],
  externalLinks: [
    {
      platform: "devto",
      url: "https://dev.to/spread2009/brick-1-any-node-can-hand-off-typed-participants-in-a-verifiable-supply-chain-415g",
    },
  ],
  content: supplyChainParticipantRolesContent,
};
