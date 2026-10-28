import type { BlogArticle } from "../../blog-data";
import { bedrijPrincipleContentA } from "./bedrij-principle.content-a";
import { bedrijPrincipleContentB } from "./bedrij-principle.content-b";

export const article: BlogArticle = {
  slug: "bedrij-principle",
  title: "The Bedrij Principle: One Primitive for Infinite Agent Supply Chains",
  description:
    "What if supply chains don't need more integrations — but one small primitive from which complexity composes? The Bedrij Principle: a verifiable state transition as the smallest useful unit — preconditions, action, evidence, verification, acceptance, settlement — chaining into hop-ordered custody with per-hop escrow on an append-only economic ledger. Hypothesis, transition contract, and the v0.1 experiment already running.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-10-28",
  dateModified: "2026-10-28",
  tags: [
    "supply-chain",
    "bedrij-principle",
    "transition-contract",
    "economic-ledger",
    "agent-economy",
    "verifiable-transitions",
    "event-sourcing",
    "escrow",
    "arc",
    "evidence",
  ],
  readingTime: "10 min",
  shortAnswer:
    "Supply chains fail at the joins: every participant runs different systems, and the chain is an integration graph growing quadratically. Our candidate primitive is the verifiable state transition — preconditions, action, evidence, verification, acceptance — composed into chains of arbitrary length. v0.1 is live: append-only ledger, per-hop escrow, ordering enforced by the event log.",
  heroImage: "/images/blog/bedrij-principle-hero.webp",
  ogImage: "/images/blog/bedrij-principle-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "Hono",
    "Postgres",
    "ERC-8183",
    "event-sourcing",
  ],
  entities: [
    "supply-chain-pack",
    "econ-ledger-store",
    "shipment-executor",
    "economic-ledger-article",
  ],
  concepts: [
    "verifiable-state-transition",
    "transition-contract",
    "one-and-the-many",
    "composability",
    "append-only-ledger",
    "evidence-first-settlement",
    "advisory-not-enforcement",
  ],
  topics: [
    "supply-chain",
    "agent-economy",
    "economic-ledger",
    "verification",
    "composability",
  ],
  capabilities: [
    "hop-gated-settlement",
    "event-derived-state",
    "typed-evidence-refs",
    "shipment-replay",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/bedrij-principle.md",
    },
    {
      type: "read",
      label: "Shipment read endpoint",
      url: "https://agentbadge.xyz/api/ledger/shipments/demo",
    },
    {
      type: "read",
      label: "Economic ledger article",
      url: "https://agentbadge.xyz/blog/economic-ledger",
    },
    {
      type: "read",
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What is the smallest useful unit of a supply chain?",
      answer:
        "Not the shipment, the participant, the payment or the API call — but a transition whose result can be independently verified: explicit preconditions, an action, required evidence, verification rules and acceptance. Everything else in the model is composition of that single shape.",
    },
    {
      question: "What is a transition contract?",
      answer:
        "The explicit agreement governing one transition: what must be true before, what happens, what counts as proof, who verifies, and what follows — including settlement. A business rule like 'deliver 1,000 units at 2–8°C, sealed, by 14:00' lives as preconditions and evidence requirements, not as a paragraph in a PDF.",
    },
    {
      question: "Why 'the Bedrij Principle'?",
      answer:
        "Orest Bedrij spent decades searching for a fundamental '1' — a principle of the One-and-the-Many from which nature's phenomena could be predicted, validated and measured. We borrow only the question: can complexity be composed from a sufficiently fundamental primitive? It is intellectual inspiration, not a scientific claim — the article's note on Bedrij states this explicitly.",
    },
    {
      question: "How does hop ordering work in the v0.1?",
      answer:
        "Each hop of a shipment is escrowed in its own job; the event log is the source of truth. Hop i+1 cannot hand off until hop i is paid — the guard re-derives state from the log and throws ShipmentOrderError. Settle refuses a hop that was never handed off: no evidence, no money.",
    },
    {
      question: "What is deliberately missing in v0.1?",
      answer:
        "Evidence is advisory (typed references, not automated evaluation) and verification is a manual evaluator — a human or delegated agent acting as a risk gate before settlement. Automated evidence evaluation and a live testnet dogfood are announced, not shipped; the article's honesty table lists exact status per layer.",
    },
  ],
  claims: [
    {
      id: "c38-hop-order-enforced",
      status: "VERIFIED",
      text: "Hop i+1 cannot hand off until hop i is paid, and settle is refused without the hop's own handoff — ordering is re-derived from the shipment's event stream on every call.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/shipment.ts" },
      ],
    },
    {
      id: "c38-event-order",
      status: "VERIFIED",
      text: "The per-hop custody cycle is work_offer → handoff → pay → verify; verification is terminal and requires the hop already paid.",
      evidence: [
        { type: "github", url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/verify.ts" },
      ],
    },
    {
      id: "c38-bedrij-paper",
      status: "VERIFIED",
      text: "O. Bedrij, 'New Relationships and Measurements for Gravity Physics', Proceedings of the Institute of Mathematics of NAS of Ukraine, 2002, Vol. 43, Part 2, pp. 589–601 — confirmed against the PDF on imath.kiev.ua and INSPIRE record 580870.",
      evidence: [],
    },
    {
      id: "c38-bedrij-bio",
      status: "VERIFIED",
      text: "Per the Fetzer Institute trustee history, Orest Bedrij (1933–2022) was a Ukrainian physicist and investment banker who at age 29 served as IBM's technical director on the computer complex for the first soft moon landing at NASA/JPL.",
      evidence: [],
    },
    {
      id: "c38-prod-executor-not-live",
      status: "UNVERIFIED",
      text: "The production ERC-8183 hop executor is composed but has not settled a funded hop on testnet; the dogfood runs an in-memory executor on the same contract — listed as 'announced' in the honesty table.",
      evidence: [],
    },
  ],
  content: bedrijPrincipleContentA + bedrijPrincipleContentB,
};
