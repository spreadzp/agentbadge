import type { BlogArticle } from "../../blog-data";
import { ups0LayersBricksContent } from "./ups-0-layers-bricks.content";

export const article: BlogArticle = {
  slug: "ups-0-layers-bricks",
  title:
    "Six Models of \"Process\" in One Codebase - So We're Building the Universal Layer",
  description:
    "Announcing the Universal Process Semantics program (EPIC-235..241): a shared contract layer over the canonical economic event ledger - three layers (frozen ledger, thirteen contract bricks, domain adapters), cryptographic commitments anchored on-chain, and cross-language conformance vectors. Honest roadmap, not a release note: npm publish deliberately deferred until v1 schemas plus vectors stabilize.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-27",
  dateModified: "2026-11-27",
  tags: [
    "universal-process-semantics",
    "process-contracts",
    "econ-events",
    "verifiable-state-transition",
    "conformance",
    "agent-economy",
    "roadmap",
    "epic-235",
  ],
  readingTime: "9 min",
  shortAnswer:
    "Universal Process Semantics is a seven-epic program (EPIC-235..241) building a shared contract vocabulary over the canonical economic event ledger: the ledger stays frozen (econ-events/1 closed), thirteen contract bricks cover actors, assets, policies, evidence, workflows, projections, commitments, measurements, documents and telemetry, and domain adapters translate real systems - supply chain first, software development second, physical measurement third. Verified transitions produce immutable commitments anchored on-chain; conformance vectors are generated in TypeScript and independently re-checked in Python. This article is a roadmap: @agentbadge/process-contracts stays private until v1 schemas plus vectors stabilize, and the closing article carries the live receipts.",
  heroImage: "/images/blog/ups-0-layers-bricks-hero.webp",
  ogImage: "/images/blog/ups-0-layers-bricks-og.jpeg",
  status: "IDEA",
  technologies: [
    "TypeScript",
    "Zod",
    "JSON Schema",
    "RFC 8785 JCS",
    "SHA-256",
    "keccak256",
    "Python",
  ],
  entities: [
    "@agentbadge/process-contracts",
    "@agentbadge/econ-events",
    "epic-235",
    "epic-236",
    "epic-237",
    "epic-238",
    "epic-239",
    "epic-240",
    "epic-241",
  ],
  concepts: [
    "verifiable-state-transition",
    "universal-process-semantics",
    "process-contracts",
    "domain-adapter",
    "process-event-projection",
    "state-transition-commitment",
    "cross-language-conformance",
    "typed-external-references",
    "append-only-ledger",
    "evidence-first-settlement",
    "composability",
  ],
  topics: [
    "agent-economy",
    "economic-ledger",
    "verification",
    "conformance",
    "supply-chain",
    "composability",
    "schemas",
  ],
  capabilities: [
    "typed-evidence-refs",
    "event-derived-state",
    "process-semantics-contracts",
    "cross-language-vectors",
    "onchain-commitment-anchors",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/ups-0-layers-bricks.md",
    },
    {
      type: "read",
      label: "Live agent-interaction manifest (8 tools, keyless)",
      url: "https://agentbadge.xyz/.well-known/agent-interaction.json",
    },
    {
      type: "read",
      label: "Public repository (ledger, adapters land here)",
      url: "https://github.com/spreadzp/agentbadge",
    },
    {
      type: "read",
      label: "Published event vocabulary package",
      url: "https://www.npmjs.com/package/@agentbadge/econ-events",
    },
    {
      type: "read",
      label: "Previous anchor: the Bedrij principle",
      url: "https://agentbadge.xyz/blog/bedrij-principle",
    },
  ],
  qa: [
    {
      question: "What is the Universal Process Semantics program?",
      answer:
        "A seven-epic public program (EPIC-235..241) building a domain-independent contract layer over the canonical economic event ledger at agentbadge.xyz. It adds a shared vocabulary for actors, assets, policies, evidence, workflows, projections, commitments, measurements, documents and telemetry, plus the machinery to prove a state transition: cryptographic commitments anchored on-chain and cross-language conformance vectors. Announced 2026-11-27 as a roadmap - the contracts package is private until v1 schemas and vectors stabilize.",
    },
    {
      question: "What are the three layers of the design?",
      answer:
        "Layer 1 is the Canonical Economic Event Ledger - it already exists and stays frozen (econ-events/1 closed; no universal event envelope, no second event store). Layer 2 is Universal Process Semantics: the thirteen contracts, event projections, immutable state-transition commitments and conformance vectors. Layer 3 is domain adapters that translate real systems into the contracts without being rewritten: supply chain (reference), software development (second), physical measurement (third).",
    },
    {
      question: "Why do the contracts use external references instead of UUIDs?",
      answer:
        "A bare UUID only means something inside the database that issued it. Contracts are meant to be verified by parties who do not share our primary keys, so identity is expressed as typed, namespaced external references - eip155:5042002:..., erc8004:..., agentbadge:... . Actor resolution returns RESOLVED, UNRESOLVED or AMBIGUOUS and never silently merges two references into one identity.",
    },
    {
      question: "When will @agentbadge/process-contracts be published to npm?",
      answer:
        "Not yet, by decision. The package stays private until the v1 schema set stabilizes and cross-language conformance vectors exist - a contract package is a promise, and publishing one before it can be verified would be an unverified promise. The already-published vocabulary is @agentbadge/econ-events on npm; public code lands in github.com/spreadzp/agentbadge as slices ship.",
    },
    {
      question: "What can be verified today versus what is still a plan?",
      answer:
        "Verifiable today: the live agent-interaction protocol (manifest plus JSON-RPC, 8 tools, keyless), the public knowledge layer, the econ-ledger supply-chain code on GitHub, and @agentbadge/econ-events on npm. Still a plan: the thirteen contracts, domain adapters, commitments with anchors, conformance vectors - the closing article of EPIC-241 is where the program shows live transactions, a conformance run and the vector corpus.",
    },
  ],
  claims: [
    {
      id: "ups-ledger-frozen-existing",
      status: "VERIFIED",
      text: "Layer 1 already exists and stays frozen: the canonical economic event ledger runs on the closed econ-events/1 envelope, published as @agentbadge/econ-events on npm, with the supply-chain ledger code public on GitHub - no universal event envelope and no second event store will be built.",
      evidence: [
        {
          type: "demo",
          url: "https://www.npmjs.com/package/@agentbadge/econ-events",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/src/server/lib/econ-ledger",
        },
      ],
    },
    {
      id: "ups-agent-protocol-live",
      status: "VERIFIED",
      text: "The agent-facing surface exists today: a keyless capability manifest plus a JSON-RPC endpoint exposing eight live tools - the discovery and interaction layer this program's outputs will eventually plug into.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/.well-known/agent-interaction.json",
        },
        {
          type: "demo",
          url: "https://agentbadge.xyz/blog/arc-c66-agent-protocol",
        },
      ],
    },
    {
      id: "ups-supply-chain-dogfood",
      status: "VERIFIED",
      text: "The reference adapter domain is not a paper scenario: a multi-hop verifiable handoff already runs as live dogfood on Arc testnet - the supply-chain series documented it end to end before this program existed.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/blog/bedrij-principle",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/tree/main/src/server/lib/econ-ledger",
        },
      ],
    },
    {
      id: "ups-program-shape-roadmap",
      status: "UNVERIFIED",
      text: "Program shape as designed: seven epics (235 contracts, 236 supply-chain adapter, 237 commitments+anchors, 238 conformance vectors, 239 asset lineage, 240 physical measurement, 241 software conformance + closing article), 51 slices, contracts-first ordering - a roadmap statement, not a shipped result.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/blog/ups-0-layers-bricks.md",
        },
      ],
    },
    {
      id: "ups-npm-publish-deferred",
      status: "UNVERIFIED",
      text: "@agentbadge/process-contracts is deliberately not on npm: the package stays private until the v1 schema set stabilizes and conformance vectors exist - stated as intent, verifiable by absence from the registry.",
      evidence: [
        {
          type: "demo",
          url: "https://www.npmjs.com/package/@agentbadge/process-contracts",
        },
      ],
    },
    {
      id: "ups-contract-inventory",
      status: "UNVERIFIED",
      text: "The contract vocabulary counts thirteen bricks - ActorRef, ActorResolutionResult, AssetRef, AssetRelationship, PolicyRef, EvidenceRef, WorkflowDefinition, ProcessStep, ProcessEventProjection, StateTransitionCommitment, MeasurementObservation, DocumentArtifact, TelemetryBatch - the designed set the program will emit as JSON Schemas; schemas land as slices ship.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/blog/ups-0-layers-bricks.md",
        },
      ],
    },
  ],
  externalLinks: [],
  content: ups0LayersBricksContent,
};
