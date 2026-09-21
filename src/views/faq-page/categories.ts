// EPIC-140 (SLICE-140-20): FAQ categories + homepage FAQ items.

export interface FaqCategory {
  name: string;
  slug: string;
  questionSlugs: string[];
}

export const FAQ_CATEGORIES: FaqCategory[] = [
  {
    name: "Getting Started",
    slug: "getting-started",
    questionSlugs: [
      "what-is-agentbadge",
      "what-is-agent-readiness",
      "how-do-i-get-started-with-agentbadge",
      "do-i-need-to-sign-up-to-scan-my-api",
      "what-does-it-cost",
      "is-this-on-testnet-or-mainnet",
      "what-programming-languages-are-supported",
    ],
  },
  {
    name: "Scoring & Measurement",
    slug: "scoring-measurement",
    questionSlugs: [
      "what-does-agentbadge-measure",
      "how-does-agentbadge-score",
      "what-are-the-four-scoring-pillars-in-agentbadge-s-scanner",
      "what-is-evidence-based-scoring-in-agentbadge",
      "what-is-the-agentbadge-gap-engine",
      "what-is-agent-success-rate-asr-in-agentbadge",
      "what-is-continuous-monitoring-in-agentbadge",
      "what-is-the-agentbadge-funnel-report",
      "how-long-does-a-scan-take",
      "can-i-self-host-the-scanner",
    ],
  },
  {
    name: "API & OpenAPI",
    slug: "api-openapi",
    questionSlugs: [
      "is-openapi-enough",
      "why-isn-t-openapi-enough-for-ai-agents",
      "what-are-the-8-layers-of-context-an-ai-agent-needs-to-understand-an-api",
      "what-is-the-difference-between-declared-and-observed-api-behavior",
      "how-does-the-agentbadge-scanner-handle-authentication",
    ],
  },
  {
    name: "Identity & Passports",
    slug: "identity-passports",
    questionSlugs: [
      "what-is-an-agent-passport",
      "what-are-the-passport-tiers",
      "why-is-the-passport-non-transferable",
      "what-does-passport-verification-prove",
      "how-do-i-integrate-via-mcp",
    ],
  },
  {
    name: "Marketplace & Payments",
    slug: "marketplace-payments",
    questionSlugs: [
      "what-is-the-agent-marketplace",
      "what-is-x402-payment",
      "how-does-task-escrow-work-in-the-agentbadge-marketplace",
      "what-is-the-marketplace-task-lifecycle-in-agentbadge",
    ],
  },
  {
    name: "Technical",
    slug: "technical",
    questionSlugs: [
      "what-is-the-hcs-directory",
      "how-does-a2a-messaging-work",
      "what-blockchains-does-agentbadge-support",
      "what-is-a-chainadapter-in-agentbadge",
      "what-is-webmcp-in-agentbadge",
    ],
  },
  {
    name: "Concepts",
    slug: "concepts",
    questionSlugs: [
      "what-is-the-agentic-web",
      "what-is-geo-generative-engine-optimization-and-how-does-it-relate-to-agent-readiness",
      "what-is-mcp-vs-rest-api-for-ai-agents",
      "what-is-the-difference-between-seo-and-geo",
      "how-does-agentbadge-handle-seo-for-agents",
      "how-does-agentbadge-support-agent-discovery-on-the-web",
      "how-is-agent-readiness-different-from-seo",
    ],
  },
  {
    name: "Services",
    slug: "services",
    questionSlugs: [
      "what-is-the-agent-readiness-scanner",
      "what-is-agentbadge-not",
      "can-the-agentbadge-team-build-an-mcp-server-for-me",
      "does-the-team-offer-geo-optimization-consulting",
      "what-is-the-agentbadge-blog",
      "what-happens-after-i-scan",
      "can-i-scan-multiple-apis",
      "is-agentbadge-open-source",
    ],
  },
  {
    name: "KeeperHub & On-Chain Recording",
    slug: "keeperhub-on-chain-recording",
    questionSlugs: [
      "what-is-keeperhub-integration",
      "what-chains-does-agentbadge-use-for-on-chain-recording",
      "what-is-the-trustregistry-contract",
      "what-is-trustbadge",
      "what-is-the-agentpassport-nft-on-base",
      "how-do-i-trigger-an-on-chain-scan-recording",
      "what-is-the-audit-trail-sse-stream",
      "what-mcp-tools-are-available-for-keeperhub",
      "what-is-x402-premium-scan",
      "is-the-agentbadge-keeperhub-package-available",
    ],
  },
  {
    name: "Cross-Chain Verification (Attestcoin)",
    slug: "cross-chain-verification-attestcoin",
    questionSlugs: [
      "what-is-attestcoin-cross-chain-verification",
      "how-does-the-attestcoin-task-lifecycle-work",
      "what-chains-does-attestcoin-use",
      "what-mcp-tools-are-available-for-attestcoin",
      "how-does-the-ai-agent-interact-with-attestcoin-tasks",
      "is-there-a-live-demo-for-attestcoin",
      "is-the-agentbadge-attestcoin-package-available",
    ],
  },
];

export interface HomepageFaqItem {
  question: string;
  shortAnswer: string;
  faqAnchor: string;
}

export const HOMEPAGE_FAQ: HomepageFaqItem[] = [
  {
    question: "What is Agent Readiness?",
    shortAnswer:
      "Agent Readiness is the ability of your API or service to be discovered, understood, and used by an AI agent without human intervention. It extends SEO principles to machine-readable interfaces. <a href=\"/what-is-an-ai-ready-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
    faqAnchor: "what-is-agent-readiness",
  },
  {
    question: "What does AgentBadge measure?",
    shortAnswer:
      "AgentBadge measures 122 agent readiness rules across 18 categories — discovery, documentation, authentication, executability, and verifiability. Each check produces evidence, not opinions. <a href=\"/what-is-an-ai-ready-api\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
    faqAnchor: "what-does-agentbadge-measure",
  },
  {
    question: "Is OpenAPI enough?",
    shortAnswer:
      "OpenAPI is necessary but not sufficient. It covers syntax (endpoints, parameters) but not semantics, execution (auth flows), or safety (idempotency, retries). Agents need all 8 context layers. <a href=\"/openapi-vs-agent-readiness\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
    faqAnchor: "is-openapi-enough",
  },
  {
    question: "How does AgentBadge score?",
    shortAnswer:
      "AgentBadge scores across four pillars: Discovery (20%), Understandability (25%), Executability (30%), Verifiability (25%). Each pillar aggregates multiple categories of checks. <a href=\"/how-ai-agents-use-apis\" class=\"text-emerald-400 underline hover:text-emerald-300\">Learn more →</a>",
    faqAnchor: "how-does-agentbadge-score",
  },
  {
    question: "What is an Agent Passport?",
    shortAnswer:
      "An Agent Passport is a non-transferable NFT on {{NFT_STANDARD}} that provides on-chain identity for AI agents. It includes a DID, tier (Bronze–Platinum), and self-declared capabilities.",
    faqAnchor: "what-is-an-agent-passport",
  },
];
