import type { RuleDescription } from "./index";

export const versioningRules: RuleDescription[] = [
  {
    rule_id: "AB-155",
    category: "versioning",
    icon: "📌",
    title: "Versioning declared",
    short_description: "API version and deprecation policy are documented.",
    user_value: "Agents need to know which version they're using and when it might be deprecated.",
    wrong_example: "info: { version: '1.0.0' } // no deprecation policy",
    right_example: 'info: { version: "1.0.0" } + agent-guide: { "deprecation_policy": "6 months notice" }',
    effort_hint: "quick",
    estimated_cost: "$0",
    severity: "medium",
  }
];
