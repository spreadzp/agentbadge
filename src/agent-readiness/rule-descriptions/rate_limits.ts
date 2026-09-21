import type { RuleDescription } from "./index";

export const rateLimitsRules: RuleDescription[] = [
  {
    rule_id: "AB-151",
    category: "rate_limits",
    icon: "⏱️",
    title: "Rate limits machine-readable",
    short_description: "Rate limits are declared in a machine-readable format.",
    user_value: "Agents need to know how many calls they can make per minute to avoid throttling.",
    wrong_example: "// rate limits only mentioned in prose docs",
    right_example: 'openapi.json: { "x-rate-limit": "100/min" } or agent-guide.json: { "rate_limits": { "per_minute": 100 } }',
    effort_hint: "moderate",
    estimated_cost: "$0",
    severity: "high",
  }
];
