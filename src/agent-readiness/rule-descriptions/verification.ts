import type { RuleDescription } from "./index";

export const verificationRules: RuleDescription[] = [
  {
    rule_id: "AB-013",
    category: "verification",
    icon: "✅",
    title: "Owner Verification",
    short_description: "Your site can prove that you own the domain and are who you claim to be.",
    user_value: "Verification builds trust. Agents are more likely to interact with verified sites than anonymous ones.",
    wrong_example: "No verification mechanism. Agents can't confirm you're legitimate.",
    right_example: "Domain ownership is verified, so agents know you're the real deal.",
    effort_hint: "complex",
    estimated_cost: "$100+",
  },
  {
    rule_id: "AB-152",
    category: "verification",
    icon: "🔍",
    title: "Pricing/limits consistency",
    short_description: "Pricing and rate limits are consistent across all sources.",
    user_value: "Conflicting pricing across sources makes agents unable to trust any single source.",
    wrong_example: "guide says 2.9%, llms.txt says 3.5%",
    right_example: "guide and llms.txt both say 2.9% + 30¢ per transaction",
    effort_hint: "quick",
    estimated_cost: "$0",
    severity: "medium",
  }
];
