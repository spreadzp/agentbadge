import type { RuleDescription } from "./index";

export const agentsTxtRules: RuleDescription[] = [
  {
    rule_id: "AB-048",
    category: "agents_txt",
    icon: "📜",
    title: "Agents.txt File",
    short_description: "Your site has an agents.txt file with instructions specifically for AI agents.",
    user_value: "Agents.txt is like robots.txt but for AI agents — it tells them what they can do and how to behave on your site.",
    wrong_example: "No agents.txt. AI agents don't know your preferences for how they should interact.",
    right_example: "A clear agents.txt guides AI agents on how to interact with your site.",
    effort_hint: "moderate",
    estimated_cost: "$10-50",
  }
];
