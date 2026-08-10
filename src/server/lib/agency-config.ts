export interface AgencyService {
  id: string;
  name: string;
  tagline: string;
  description: string;
  url: string;
  icon: string;
  features: string[];
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
  },
];

export function getAgencyService(id: string): AgencyService | undefined {
  return AGENCY_SERVICES.find((s) => s.id === id);
}
