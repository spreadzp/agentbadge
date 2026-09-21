import type { RuleDescription } from "./index";

export const skillsRules: RuleDescription[] = [
  {
    rule_id: "AB-026",
    category: "skills",
    icon: "🎯",
    title: "Skill File Present",
    short_description: "Your site has a skill file that describes specialized capabilities agents can use.",
    user_value: "Skill files let agents discover advanced features of your service that aren't part of your main API.",
    wrong_example: "No skill file. Agents only see your basic API and miss advanced features.",
    right_example: "A skill file describes specialized capabilities agents can use.",
    effort_hint: "moderate",
    estimated_cost: "$10-50",
  },
  {
    rule_id: "AB-027",
    category: "skills",
    icon: "✓",
    title: "Skill File Format Valid",
    short_description: "Your skill file follows the expected format with proper metadata.",
    user_value: "A malformed skill file causes errors. A valid one ensures agents can parse and use your skills.",
    wrong_example: "Skill file exists but has invalid format. Agents get errors when parsing it.",
    right_example: "Skill file is properly formatted with all required metadata.",
    effort_hint: "quick",
    estimated_cost: "$0",
  },
  {
    rule_id: "AB-065",
    category: "skills",
    icon: "📚",
    title: "Skills Index",
    short_description: "Your site has an index listing all available skills in one place.",
    user_value: "An index lets agents see all your skills at once, rather than discovering them one by one.",
    wrong_example: "Skills exist but there's no index. Agents have to find them individually.",
    right_example: "A skills index lists everything available for easy discovery.",
    effort_hint: "moderate",
    estimated_cost: "$10-50",
  }
];
