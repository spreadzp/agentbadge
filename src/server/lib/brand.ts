// SLICE-259-25: brand disambiguation vs the foreign unscoped npm
// package `agentbadge` (github.com/Emreceyhnn/Agentbadge — a
// different project that scores code repositories for AI coding
// agents). One sentence, reused verbatim across llms.txt, skill.md,
// index.md, /about, agent-card and Organization JSON-LD so every
// agent surface tells the same story. Facts and links only — we do
// not claim their name or call it fake.
export const BRAND_DISAMBIGUATION =
  'AgentBadge (agentbadge.xyz) is the agent-readiness platform for websites and APIs — not affiliated with the unscoped npm package "agentbadge" or github.com/Emreceyhnn/Agentbadge, a different project that scores code repositories for AI coding agents. Our npm packages ship only under the @agentbadge/* scope.';

// schema.org disambiguatingDescription — a short distinguishing
// description (property is meant for exactly this collision).
export const BRAND_DISAMBIGUATION_SHORT =
  'Agent-readiness platform for websites and APIs at agentbadge.xyz — not the unrelated npm package "agentbadge" (repo scoring for AI coding agents).';

// Canonical external profiles — Organization JSON-LD sameAs.
// github.com/spreadzp/agentbadge is the original source repo;
// github.com/agentbadge is the org.
export const BRAND_SAME_AS: readonly string[] = [
  "https://github.com/agentbadge",
  "https://github.com/spreadzp/agentbadge",
  "https://www.npmjs.com/org/agentbadge",
  "https://www.linkedin.com/company/agentbadge",
  "https://agentbadge.gitbook.io/agentbadge-docs",
  // EPIC-242: external marketplace presence (Circle agent services)
  "https://agents.circle.com/services",
];
