import type { RuleDescription } from "./index";

export const bazaarRules: RuleDescription[] = [
  {
    rule_id: "AB-036",
    category: "bazaar",
    icon: "🏪",
    title: "Bazaar Discoverable",
    short_description: "Your agent marketplace listings can be discovered by other agents.",
    user_value: "The Bazaar is where agents find services to use. If you're not discoverable, you're invisible to the agent economy.",
    wrong_example: "Not listed in the Bazaar. Other agents can't find or use your services.",
    right_example: "Your services are discoverable in the Bazaar marketplace.",
    effort_hint: "moderate",
    estimated_cost: "$10-50",
  },
  {
    rule_id: "AB-037",
    category: "bazaar",
    icon: "🏷️",
    title: "Bazaar Service Declared",
    short_description: "Your site declares what services it offers in the Bazaar marketplace.",
    user_value: "A declared service tells other agents exactly what you offer, so they can decide to use it.",
    wrong_example: "Present in Bazaar but no services declared. Agents don't know what you offer.",
    right_example: "Services are clearly declared in the Bazaar for other agents to discover.",
    effort_hint: "moderate",
    estimated_cost: "$10-50",
  },
  {
    rule_id: "AB-072",
    category: "bazaar",
    icon: "🛒",
    title: "Bazaar in Lightning Payments",
    short_description: "Your Lightning payment responses include Bazaar marketplace information.",
    user_value: "This connects your payment system with the marketplace, so agents can discover and pay for services in one flow.",
    wrong_example: "Lightning payments work but don't include Bazaar info. Agents miss marketplace opportunities.",
    right_example: "Bazaar info is included in payment responses, connecting payments to the marketplace.",
    effort_hint: "complex",
    estimated_cost: "$100+",
  }
];
