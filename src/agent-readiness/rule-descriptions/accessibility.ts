import type { RuleDescription } from "./index";

export const accessibilityRules: RuleDescription[] = [
  {
    rule_id: "AB-117",
    category: "accessibility",
    icon: "♿",
    title: "Image alt text coverage",
    short_description: "All images on your page have alt attributes (empty alt is valid for decorative images).",
    user_value: "Alt text ensures screen readers and AI agents can understand image content. Missing alt text is a WCAG 2.1 Level A violation.",
    wrong_example: "<img src=\"hero.jpg\"> — no alt attribute at all.",
    right_example: "<img src=\"hero.jpg\" alt=\"Product dashboard showing analytics\"> or <img src=\"spacer.gif\" alt=\"\"> for decorative images.",
    effort_hint: "moderate",
    estimated_cost: "$0",
  },
  {
    rule_id: "AB-118",
    category: "accessibility",
    icon: "♿",
    title: "Lazy loading on below-fold images",
    short_description: "Images below the fold use loading=\"lazy\" for improved page load performance.",
    user_value: "Lazy loading defers off-screen image loading, improving Largest Contentful Paint and reducing bandwidth for both users and AI crawlers.",
    wrong_example: "<img src=\"below-fold.jpg\" alt=\"Content\"> — no loading attribute.",
    right_example: "<img src=\"below-fold.jpg\" alt=\"Content\" loading=\"lazy\">.",
    effort_hint: "quick",
    estimated_cost: "$0",
  }
];
