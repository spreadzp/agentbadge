import type { RuleDescription } from "./index";

export const retrySemanticsRules: RuleDescription[] = [
  {
    rule_id: "AB-154",
    category: "retry_semantics",
    icon: "🔁",
    title: "Retry semantics declared",
    short_description: "Idempotency-Key or Retry-After headers are documented.",
    user_value: "Agents need to know which requests are safe to retry and how long to wait.",
    wrong_example: "// no mention of idempotency or retry",
    right_example: "headers: { 'Idempotency-Key': { description: 'Prevents duplicate charges' } }",
    effort_hint: "moderate",
    estimated_cost: "$0",
    severity: "medium",
  }
];
