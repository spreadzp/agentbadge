import type { RuleDescription } from "./index";

export const pricingRules: RuleDescription[] = [
  {
    rule_id: "AB-150",
    category: "pricing",
    icon: "💲",
    title: "Pricing discoverability",
    short_description: "Pricing information is discoverable in agent-guide or llms.txt.",
    user_value: "Agents need to know what a call costs before making it — pricing must be in sources agents check.",
    wrong_example: "// pricing only on /pricing.html (not in guide or llms.txt)",
    right_example: 'agent-guide.json: { "pricing": { "model": "per_transaction", "note": "2.9% + 30¢" } }',
    effort_hint: "quick",
    estimated_cost: "$0",
    severity: "high",
  }
];
