import type { RuleDescription } from "./index";

export const agentPolicyRules: RuleDescription[] = [
  {
    rule_id: "AB-157",
    category: "agent_policy",
    icon: "📜",
    title: "Agent policy machine-readable",
    short_description: "A machine-readable usage policy for AI agents is present.",
    user_value: "Agents need to know if they're allowed to use the API and under what conditions.",
    wrong_example: "// no agents.txt or policy file",
    right_example: 'agents.txt: "User-agent: *\nAllow: /\n# AI agents may use this API"',
    effort_hint: "quick",
    estimated_cost: "$0",
    severity: "medium",
  }
];
