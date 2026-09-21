import type { RuleDescription } from "./index";

export const sandboxRules: RuleDescription[] = [
  {
    rule_id: "AB-156",
    category: "sandbox",
    icon: "🧪",
    title: "Sandbox declared",
    short_description: "A sandbox/test environment is documented in agent-guide.",
    user_value: "Agents need a safe environment to test calls before executing real transactions.",
    wrong_example: "// no sandbox mentioned",
    right_example: 'agent-guide.json: { "sandbox": { "url": "https://sandbox.example.com", "description": "Test environment" } }',
    effort_hint: "quick",
    estimated_cost: "$0",
    severity: "low",
  }
];
