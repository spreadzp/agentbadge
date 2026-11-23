export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  expertise: string[];
  github?: string;
  url?: string;
  linkedin?: string;
}

export const TEAM_MEMBERS: TeamMember[] = [
  {
    name: "Paul Spread",
    role: "Founder & Lead Engineer",
    bio: "Full-stack engineer specializing in blockchain infrastructure and AI agent systems. Built AgentBadge from the ground up — originally on Hedera with HTS, HCS, and x402 payments (legacy: founding stack — now Arc/EVM). Previously worked on payment systems and exchange platforms.",
    expertise: ["EVM", "Arc", "TypeScript", "AI Agents", "x402", "MCP"],
    github: "https://github.com/spreadzp",
    url: "https://github.com/spreadzp",
    linkedin: "https://www.linkedin.com/in/spreadzp",
  },
  {
    name: "AgentBadge Team",
    role: "Agency for the Agentic Web",
    bio: "AgentBadge is an agency building infrastructure for AI agent commerce on Arc. We help businesses become agent-ready with readiness scanning, on-chain identity passports, and a task marketplace with machine payments. (legacy: founded on Hedera — HTS/HCS stack.)",
    expertise: ["Agent Readiness", "Arc", "EVM", "NFT Identity", "Marketplace"],
    url: "https://github.com/spreadzp/agentbadge",
  },
];
