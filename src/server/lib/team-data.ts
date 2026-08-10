export interface TeamMember {
  name: string;
  role: string;
  bio: string;
  expertise: string[];
  github?: string;
  url?: string;
}

export const TEAM_MEMBERS: TeamMember[] = [
  {
    name: "Oleksandr Khotemskyi",
    role: "Founder & Lead Engineer",
    bio: "Full-stack engineer specializing in blockchain infrastructure and AI agent systems. Built AgentBadge from the ground up on Hedera with HTS, HCS, and x402 payments. Previously worked on payment systems and exchange platforms.",
    expertise: ["Hedera", "TypeScript", "AI Agents", "x402", "MCP"],
    github: "https://github.com/spreadzp",
    url: "https://github.com/spreadzp",
  },
  {
    name: "AgentBadge Team",
    role: "Agency for the Agentic Web",
    bio: "AgentBadge is an agency building infrastructure for AI agent commerce on Hedera. We help businesses become agent-ready with readiness scanning, on-chain identity passports, and a task marketplace with machine payments.",
    expertise: ["Agent Readiness", "Hedera", "NFT Identity", "Marketplace"],
    url: "https://github.com/spreadzp/agentbadge",
  },
];
