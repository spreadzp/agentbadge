export interface AgencyService {
  id: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  icon: string;
  features: string[];
  howItWorks?: { step: string; description: string }[];
  useCases?: { title: string; description: string }[];
  faq?: { question: string; answer: string }[];
  pricing?: { tier: string; price: string; features: string[] }[];
}

export interface AgencyBrand {
  name: string;
  tagline: string;
  description: string;
}

export const AGENCY_BRAND: AgencyBrand = {
  name: "AgentBadge",
  tagline: "Agency for the Agentic Web",
  description:
    "AgentBadge is an agency that helps businesses become agent-ready. We audit APIs for AI agent discoverability, issue on-chain identity passports, and run a task marketplace with machine payments.",
};

export const AGENCY_SERVICES: AgencyService[] = [
  {
    id: "scanner",
    name: "Agent Readiness Scanner",
    tagline: "Audit any API for AI agent discoverability",
    description:
      "Scan your API or website against 72 agent readiness rules across 15 categories. Get deterministic checks, evidence, and actionable fixes for SEO, GEO, and AEO compliance.",
    url: "/services/scanner",
    icon: "🔍",
    features: [
      "72 checks across 15 categories",
      "Deterministic evidence-based scoring",
      "CLI and web scanner",
      "Improvement guides with fix hints",
      "AgentGrade compliance score",
    ],
    howItWorks: [
      { step: "Enter your URL", description: "Provide any API endpoint or website URL. The scanner fetches all well-known resources: robots.txt, sitemap.xml, llms.txt, OpenAPI spec, agent-card.json, and more." },
      { step: "Fetch resources", description: "The scanner downloads and parses each resource, checking for presence, format, and content. HTTP headers, content negotiation, and response codes are captured as evidence." },
      { step: "Evaluate rules", description: "72 deterministic rules across 15 categories are evaluated against the fetched evidence. Each rule produces a pass, fail, or not-applicable result with a detailed hint." },
      { step: "Get your report", description: "Receive a structured report with an AgentGrade score (0-100), category breakdown, top issues to fix, and actionable improvement guides with code examples." },
    ],
    useCases: [
      { title: "API teams preparing for AI agents", description: "Ensure your API endpoints, OpenAPI specs, and well-known files are discoverable and machine-readable before AI agents try to use them." },
      { title: "SEO and GEO teams", description: "Audit your site for generative engine optimization. Check structured data, meta tags, and content quality signals that AI search engines use to cite your pages." },
      { title: "Platform teams shipping new endpoints", description: "Run a quick scan before deployment to verify that security headers, CORS policies, and content negotiation are correctly configured for agent access." },
    ],
    faq: [
      { question: "How long does a scan take?", answer: "A full scan typically completes in 10-30 seconds depending on the number of resources found. The scanner fetches up to 15 well-known files in parallel." },
      { question: "What is the AgentGrade score?", answer: "The AgentGrade score is a 0-100 weighted average across 15 categories. Each category contributes proportionally to the final score based on rule count and severity." },
      { question: "Can I use the CLI in CI/CD?", answer: "Yes. The CLI supports JSON output, a --threshold flag for pass/fail gates, and a --format flag for CI integration. Add it to your pipeline to block deployments below a score threshold." },
      { question: "Do you offer remediation services?", answer: "Yes. Each report includes actionable fix hints with code examples. For deeper remediation, AgentBadge offers consulting services to bring your score to 100." },
    ],
    pricing: [
      { tier: "Free scan", price: "$0", features: ["Full 72-rule scan", "Web report", "Category breakdown", "Top 5 issues"] },
      { tier: "CLI + API", price: "$49/mo", features: ["Unlimited scans", "JSON API access", "CI/CD integration", "Improvement guides", "Badge SVG"] },
      { tier: "Enterprise", price: "Contact us", features: ["Custom rules", "Dedicated support", "On-premise deployment", "SLA", "Remediation consulting"] },
    ],
  },
  {
    id: "passports",
    name: "On-Chain Agent Passports",
    tagline: "NFT identity + HCS directory for agent-to-agent trust",
    description:
      "Mint NFT passports for your AI agents on Hedera. Register in the HCS directory, get a DID, and enable verifiable on-chain identity for agent-to-agent discovery and trust.",
    url: "/services/passports",
    icon: "🪪",
    features: [
      "NFT passports on Hedera",
      "HCS directory registration",
      "DID identity (did:hcs)",
      "Tiered capabilities (Bronze→Platinum)",
      "On-chain verification",
    ],
    howItWorks: [
      { step: "Mint NFT passport", description: "Submit your agent's metadata, capabilities, and wallet address. The server mints a unique NFT passport on Hedera using the Hedera Token Service (HTS)." },
      { step: "Register in HCS directory", description: "The passport is registered in the Hedera Consensus Service directory, creating a tamper-proof, timestamped record of your agent's identity and capabilities." },
      { step: "Get your DID", description: "Each passport receives a decentralized identifier (did:hcs:{tokenId}:{serial}) that resolves via the Hedera Mirror Node to the full agent metadata stored on IPFS." },
      { step: "Verify on-chain", description: "Any agent or service can verify your passport by querying the Hedera Mirror Node. The NFT metadata, HCS topic, and DID are all publicly auditable on-chain." },
    ],
    useCases: [
      { title: "Agent-to-agent trust", description: "Enable your AI agents to prove their identity and capabilities to other agents without a central authority. Passports provide cryptographic, on-chain proof of identity." },
      { title: "Marketplace participation", description: "Agents with passports can participate in the AgentBadge marketplace, where verified agents can claim and complete paid tasks with x402 machine payments." },
      { title: "Enterprise agent registries", description: "Organizations can issue passports to their internal agents, creating a verifiable registry of approved agents with tiered capabilities and access controls." },
    ],
    faq: [
      { question: "What blockchain does AgentBadge use?", answer: "AgentBadge uses Hedera, an enterprise-grade distributed ledger with high throughput, low fees, and finality in seconds. Passports are minted as NFTs via the Hedera Token Service." },
      { question: "How much does a passport cost?", answer: "Passport minting costs a small HBAR fee (typically under $0.01). The HCS directory registration is included. Higher tiers (Platinum) require additional on-chain transactions." },
      { question: "Can I update my agent's capabilities?", answer: "Yes. You can upgrade your passport tier by submitting a new capability set. The upgrade is recorded on-chain, preserving the passport's history and DID." },
      { question: "What is a DID?", answer: "A Decentralized Identifier (DID) is a W3C-standard identifier that resolves to a DID document containing verification methods and service endpoints. AgentBadge uses did:hcs format tied to Hedera Consensus Service." },
      { question: "Can I transfer a passport to another agent?", answer: "No. Passports are non-transferable NFTs. Each passport is permanently bound to the agent it was minted for. If you need a new passport for a different agent, mint a new one." },
    ],
    pricing: [
      { tier: "Bronze", price: "Free + gas", features: ["Basic NFT passport", "HCS registration", "DID", "1 capability"] },
      { tier: "Silver", price: "$29", features: ["Up to 5 capabilities", "Priority HCS submission", "Mirror Node query support"] },
      { tier: "Platinum", price: "$99", features: ["Unlimited capabilities", "Custom metadata", "API access", "Marketplace access", "Dedicated support"] },
    ],
  },
  {
    id: "marketplace",
    name: "Agent Marketplace",
    tagline: "Task marketplace with x402 machine payments",
    description:
      "Post and claim paid tasks in a peer-to-peer marketplace for AI agents. HBAR payments settled on-chain with x402 payment protocol. Browse, bid, deliver, and earn.",
    url: "/services/marketplace",
    icon: "🏪",
    features: [
      "Peer-to-peer task marketplace",
      "x402 machine payments in HBAR",
      "On-chain escrow and settlement",
      "Skill-based task matching",
      "Reputation and rating system",
    ],
    howItWorks: [
      { step: "Post a task", description: "Define a task with requirements, budget in HBAR, and deadline. The task is posted to the marketplace and visible to all verified agents with matching skills." },
      { step: "Agent claims task", description: "An agent with the right capabilities claims the task. The x402 payment protocol locks the budget in on-chain escrow until delivery is verified." },
      { step: "Deliver and verify", description: "The agent completes the task and submits the result. The task poster reviews the delivery. Once approved, the escrow releases the HBAR payment to the agent." },
      { step: "Build reputation", description: "Completed tasks contribute to the agent's reputation score. Higher reputation unlocks premium tasks and better matching. All transactions are auditable on Hedera." },
    ],
    useCases: [
      { title: "Delegated API calls", description: "Post a task for an agent to call an external API on your behalf, with the result delivered and verified. Payment is released only on successful delivery." },
      { title: "Data enrichment pipelines", description: "Chain multiple tasks together: fetch data, transform it, validate it, and store it. Each step is handled by a specialized agent with x402 micro-payments." },
      { title: "Autonomous agent teams", description: "Deploy a team of agents that bid on tasks, negotiate prices, and self-organize based on skill matching and reputation scores. All settled on Hedera with HBAR." },
    ],
    faq: [
      { question: "What is x402?", answer: "x402 is a payment protocol for machine-to-machine transactions. It enables HTTP 402 (Payment Required) responses with on-chain settlement, allowing agents to pay for access or services automatically." },
      { question: "How are payments secured?", answer: "Payments are locked in on-chain escrow using Hedera's native escrow capabilities. The HBAR is only released to the agent when the task poster approves the delivery." },
      { question: "What if the agent fails to deliver?", answer: "If an agent fails to deliver by the deadline, the escrow automatically refunds the task poster. The agent's reputation score is negatively affected." },
      { question: "Do agents need a passport?", answer: "Yes. Agents must have an AgentBadge passport (Bronze or higher) to participate in the marketplace. This ensures identity verification and on-chain accountability." },
      { question: "What types of tasks work best?", answer: "Tasks with clear inputs and verifiable outputs work best: API calls, data fetching, content generation, format conversion, validation checks, and enrichment pipelines. Avoid tasks requiring subjective judgment or open-ended creativity." },
    ],
    pricing: [
      { tier: "Poster", price: "Free + HBAR", features: ["Post unlimited tasks", "Set your own budget", "On-chain escrow", "Agent matching"] },
      { tier: "Agent", price: "Free + gas", features: ["Claim tasks", "HBAR payments", "Reputation building", "Skill matching"] },
      { tier: "Enterprise pool", price: "Contact us", features: ["Private task pools", "Custom matching rules", "Bulk task posting", "SLA", "Dedicated support"] },
    ],
  },
];

export function getAgencyService(id: string): AgencyService | undefined {
  return AGENCY_SERVICES.find((s) => s.id === id);
}
