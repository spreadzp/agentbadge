import type { BlogArticle } from "../../blog-data";
import { supplyChainLiveTestnetContent } from "./supply-chain-live-testnet.content";

export const article: BlogArticle = {
  slug: "supply-chain-live-testnet",
  title:
    "Brick #5: The Experiment Ran - a Three-Hop Supply Chain Settled on Arc Testnet",
  description:
    "The final brick of the MVP wave: shipment dogfood-1794151620383 ran a real three-hop custody cycle on Arc testnet (chainId 5042002) - three ERC-8183 escrowed jobs (66/67/68), six confirmed transactions, all hops verified in 53 seconds, publicly replayable via GET /api/ledger/shipments/dogfood-1794151620383. Includes the live-discovered executor fixes and the 2-Critical audit that held under live fire.",
  author: "AgentBadge Team",
  authorRole: "Agency for the Agentic Web",
  date: "2026-11-08",
  dateModified: "2026-11-08",
  tags: [
    "supply-chain",
    "verifiable-transitions",
    "economic-ledger",
    "agent-economy",
    "event-sourcing",
    "erc-8183",
    "arc-testnet",
    "escrow",
    "live-dogfood",
    "usdc",
  ],
  readingTime: "9 min",
  shortAnswer:
    "A real three-hop supply chain executed end-to-end on Arc testnet: shipment dogfood-1794151620383 settled three ERC-8183 escrowed jobs (shipper -> agent -> device -> org, 0.01 USDC per hop) in 53 seconds - the final proof that verifiable transitions compose into a working economic loop on live rails, not just in test fixtures.",
  heroImage: "/images/blog/supply-chain-live-testnet-hero.webp",
  ogImage: "/images/blog/supply-chain-live-testnet-og.jpeg",
  status: "EXPERIMENT",
  technologies: [
    "TypeScript",
    "Bun",
    "ERC-8183",
    "viem",
    "USDC EIP-3009",
    "Postgres",
  ],
  entities: [
    "supply-chain-pack",
    "econ-events-package",
    "erc8183-ref-proxy",
    "arc-testnet",
    "shipment-replay-view",
    "bedrij-principle-article",
    "supply-chain-participant-roles-article",
    "supply-chain-typed-evidence-article",
    "supply-chain-scenario-matrix-article",
    "supply-chain-verifiable-showcase-article",
  ],
  concepts: [
    "live-dogfood",
    "escrowed-hops",
    "erc8183-job-lifecycle",
    "canonical-sequence-gating",
    "ledger-asserted-claims",
    "advisory-evidence",
    "delegated-evaluator",
    "resume-not-orphan",
  ],
  topics: [
    "supply-chain",
    "agent-economy",
    "economic-ledger",
    "escrow",
    "public-verification",
    "arc-testnet",
    "adversarial-review",
  ],
  capabilities: [
    "live-escrowed-execution",
    "provider-signed-lifecycle",
    "public-replay-endpoint",
    "canonical-seq-gating",
    "resumable-jobs",
    "honest-limits",
  ],
  rules: [],
  actions: [
    {
      type: "read",
      label: "Read article (Markdown)",
      url: "https://agentbadge.xyz/blog/supply-chain-live-testnet.md",
    },
    {
      type: "read",
      label: "Replay the live shipment",
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
      label: "Brick #4: Verifiable Vitrine",
      url: "https://agentbadge.xyz/blog/supply-chain-verifiable-showcase",
    },
    {
      type: "read",
      label: "Agent Guide",
      url: "https://agentbadge.xyz/agent-guide",
    },
  ],
  qa: [
    {
      question: "What ran on Arc testnet on 2026-11-08?",
      answer:
        "Shipment dogfood-1794151620383 - a three-hop cold-chain delivery: shipper (client 0xcdd2...8699d) -> agent (Plant intake 0xb21f...7005) -> device (ColdVan unit 0x67d4...7C96) -> org (Restaurant 0x8B9F...D98D). Each hop carried a 0.01 USDC escrow in its own ERC-8183 job (jobs 66/67/68) on the ref proxy 0x0049e5...bf6a0, chainId 5042002. Status: completed, 3/3 hops verified, 0 USDC outstanding, 53 seconds wall clock.",
    },
    {
      question: "What does each hop execute on the ERC-8183 contract?",
      answer:
        "Four ordered stages: the provider signs setBudget, the client approves and funds the escrow, the provider submits the deliverable, and the evaluator completes the job - releasing escrow only after the accept. Every hop produced two confirmed transactions (create + settle), six total across the shipment.",
    },
    {
      question: "Can I verify the shipment without credentials?",
      answer:
        "Yes - GET https://agentbadge.xyz/api/ledger/shipments/dogfood-1794151620383 returns the canonical ShipmentReplayResponse (status, 13-event timeline, per-hop roles/evidence/provenance, aggregate, limits). The six transaction hashes are independently checkable on testnet.arcscan.app - the replay's pay/txHash fields are ledger-asserted, so the explorer links are the independent check.",
    },
    {
      question: "What did the live run expose that tests missed?",
      answer:
        "Four executor bugs invisible to the in-memory chain, which lets any key call any method: setBudget is provider-only on the ref contract (fixed via spec.providerKey + sendAsAccount), submit must precede complete (JobStatus.Submitted), the client cannot also act as provider (ClientCannotBeProvider - dedicated restaurant key), and failed runs must resume funded jobs (SC_DOGFOOD_RESUME_JOBS) instead of orphaning escrow.",
    },
    {
      question: "What does the live run not prove yet?",
      answer:
        "Automated evidence evaluation is still a delegated ops evaluator (ops-settled), evidence authenticity remains advisory (typed refs, self-declared issuers), chains are linear only, and amounts are dogfood-scale (0.01 USDC/hop, testnet gas). The run proves the transition contract executes on real rails - not autonomous verification, branching chains, or real-value settlement.",
    },
  ],
  claims: [
    {
      id: "c44-live-shipment-completed",
      status: "VERIFIED",
      text: "Shipment dogfood-1794151620383 executed a full three-hop custody cycle on Arc testnet (chainId 5042002, ERC-8183 ref proxy 0x0049e5362736c933055e502b3cf3ba90cc0bf6a0): jobs 66/67/68 each escrowed 0.01 USDC, all three hops verified, status completed, outstandingUsdc 0, 13 log events in 53 seconds (15:27:41Z-15:28:34Z).",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/api/ledger/shipments/dogfood-1794151620383",
        },
      ],
    },
    {
      id: "c44-tx-receipts-explorer",
      status: "VERIFIED",
      text: "All six lifecycle transactions are independently verifiable on the public explorer - e.g. hop-2 job 68 create tx 0xdc7c70...c3ff and settle tx 0x7798a4...df39 (full create+settle set for jobs 66/67/68 in the article table).",
      evidence: [
        {
          type: "demo",
          url: "https://testnet.arcscan.app/tx/0x7798a4e627633c897ad256319d0d1158b2ecbcc5a5e2de02fdbd7b886db1df39",
        },
        {
          type: "demo",
          url: "https://testnet.arcscan.app/tx/0xdc7c70beed73c41d60b99763b36c9e4cab5f7bf73fe8852141052501fec5c3ff",
        },
      ],
    },
    {
      id: "c44-executor-live-fixes",
      status: "VERIFIED",
      text: "Live execution exposed and fixed provider-only setBudget (spec.providerKey + sendAsAccount local-signing path), provider-signed submit before complete, ClientCannotBeProvider (dedicated SC_DOGFOOD_RESTAURANT_KEY), and SC_DOGFOOD_RESUME_JOBS for resuming funded-but-unfinished jobs instead of orphaning escrow.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/econ-ledger/supply-chain/executor.ts",
        },
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/src/server/lib/venue/lifecycle-sign.ts",
        },
      ],
    },
    {
      id: "c44-audit-gate-held",
      status: "VERIFIED",
      text: "An external adversarial audit ran before live execution (REQUEST CHANGES: 2 Critical - orphan escrow on partial create, fail-open budget path - 4 High); all confirmed findings were fixed and re-verified, supply-chain suite 99/99 green with 12 new regression tests, before the first testnet transaction.",
      evidence: [
        {
          type: "github",
          url: "https://github.com/spreadzp/agentbadge/blob/main/tests/supply-chain/scenario-matrix.test.ts",
        },
      ],
    },
    {
      id: "c44-honesty-boundaries",
      status: "VERIFIED",
      text: "Declared limits of the live evidence: replay pay/txHash fields are ledger-asserted (explorer links are the independent check), settlement was ops-settled (delegated evaluator signer, not the logical plan evaluator), evidence remains advisory typed refs, chains are linear only, amounts are dogfood-scale 0.01 USDC per hop.",
      evidence: [
        {
          type: "demo",
          url: "https://agentbadge.xyz/api/ledger/shipments/dogfood-1794151620383",
        },
      ],
    },
  ],
  externalLinks: [
    {
      platform: "linkedin",
      url: "https://www.linkedin.com/pulse/brick-5-experiment-ran-three-hop-supply-chain-settled-paul-spread-wjzne",
    },
  ],
  content: supplyChainLiveTestnetContent,
};
