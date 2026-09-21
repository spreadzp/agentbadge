import type { RuleDescription } from "./index";

export const errorSemanticsRules: RuleDescription[] = [
  {
    rule_id: "AB-149",
    category: "error_semantics",
    icon: "🚫",
    title: "Error response schemas",
    short_description: "4xx and 5xx error responses are declared with schemas.",
    user_value: "Agents need to know what errors look like to handle them gracefully instead of crashing.",
    wrong_example: "responses: { '200': { ... } } // no 4xx/5xx",
    right_example: "responses: { '400': { description: 'Invalid request', content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } } } }",
    effort_hint: "moderate",
    estimated_cost: "$0",
    severity: "high",
  }
];
