import type { Category, Pillar } from "../shared.schema";

export interface RuleDescription {
  rule_id: string;
  category: Category;
  icon: string;
  title: string;
  short_description: string;
  user_value: string;
  wrong_example: string;
  right_example: string;
  effort_hint: "quick" | "moderate" | "complex";
  estimated_cost: string;
  severity?: string;
}

export interface CategoryDescription {
  icon: string;
  title: string;
  description: string;
}

export const CATEGORY_DESCRIPTIONS: Record<Category, CategoryDescription> = {
  discovery: {
    icon: "🔍",
    title: "Discovery",
    description: "Can AI agents find your site and understand what it offers?",
  },
  documentation: {
    icon: "📖",
    title: "Documentation",
    description: "Is your API documented in formats that AI agents can read?",
  },
  actionability: {
    icon: "⚡",
    title: "Actionability",
    description: "Can agents actually call your API with the right authentication?",
  },
  machine_readable: {
    icon: "🤖",
    title: "Machine-Readable",
    description: "Is your site's data structured for AI consumption?",
  },
  verification: {
    icon: "✅",
    title: "Verification",
    description: "Can agents verify you are who you say you are?",
  },
  content_negotiation: {
    icon: "🔄",
    title: "Content Negotiation",
    description: "Does your site serve the right format to AI agents?",
  },
  payments: {
    icon: "💰",
    title: "Payments",
    description: "Can agents pay for your services programmatically?",
  },
  bazaar: {
    icon: "🏪",
    title: "Bazaar",
    description: "Is your agent listed in the decentralized marketplace?",
  },
  openapi: {
    icon: "📋",
    title: "OpenAPI",
    description: "Is your API specification complete and reachable?",
  },
  skills: {
    icon: "🎯",
    title: "Skills",
    description: "Can agents discover and use your specialized skills?",
  },
  agents_txt: {
    icon: "📜",
    title: "Agents.txt",
    description: "Do you have instructions specifically for AI agents?",
  },
  webmcp: {
    icon: "🌐",
    title: "WebMCP",
    description: "Can browsers interact with your agent via MCP?",
  },
  identity: {
    icon: "🪪",
    title: "Identity",
    description: "Can agents verify your on-chain identity?",
  },
  bot_auth: {
    icon: "🔐",
    title: "Bot Authentication",
    description: "Can you prove which AI bot is making the request?",
  },
  infrastructure: {
    icon: "🏗️",
    title: "Infrastructure",
    description: "Are your caching, errors, and rate limits agent-ready?",
  },
  seo_aeo: {
    icon: "🔎",
    title: "SEO / AEO",
    description: "Is your content optimized for search engines and AI answer engines?",
  },
  accessibility: {
    icon: "♿",
    title: "Accessibility",
    description: "Is your site accessible to all users, including those using assistive technology?",
  },
  active_probing: {
    icon: "🔍",
    title: "Active Probing",
    description: "Are auth, endpoints, and operational metadata discoverable by active probing?",
  },
  pricing: {
    icon: "💲",
    title: "Pricing",
    description: "Is pricing information available in machine-readable formats for automated clients?",
  },
  rate_limits: {
    icon: "⏱️",
    title: "Rate Limits",
    description: "Are rate limits and over-limit behavior declared machine-readably?",
  },
  error_semantics: {
    icon: "🚫",
    title: "Error Semantics",
    description: "Are 4xx error responses declared with schemas and descriptions in the spec?",
  },
  retry_semantics: {
    icon: "🔁",
    title: "Retry Semantics",
    description: "Are idempotency and retry guidance (Retry-After) declared for agents?",
  },
  sandbox: {
    icon: "🧪",
    title: "Sandbox",
    description: "Is a test/sandbox environment advertised for agent experimentation?",
  },
  versioning: {
    icon: "📌",
    title: "Versioning",
    description: "Is the API version declared with a deprecation/sunset policy?",
  },
  agent_policy: {
    icon: "📜",
    title: "Agent Policy",
    description: "Is there a machine-readable usage policy for automated clients?",
  },
};

export interface PillarDescription {
  label: string;
  question: string;
  weight: number;
  description: string;
}

export const PILLAR_DESCRIPTIONS: Record<Pillar, PillarDescription> = {
  discovery: {
    label: "Discovery",
    question: "Can an agent find you?",
    weight: 20,
    description:
      "Measures whether AI agents can discover your site and its capabilities through standard protocols like robots.txt, sitemaps, OpenAPI specs, llms.txt, agents.txt, and structured data. Covers 8 categories: discovery, machine-readable, OpenAPI, skills, agents.txt, WebMCP, content negotiation, and SEO/AEO.",
  },
  understandability: {
    label: "Understandability",
    question: "Can an agent understand you?",
    weight: 25,
    description:
      "Measures whether AI agents can comprehend your API documentation, act on instructions, and access content in accessible formats. Covers 3 categories: documentation, actionability, and accessibility.",
  },
  executability: {
    label: "Executability",
    question: "Can an agent act on your API?",
    weight: 30,
    description:
      "Measures whether AI agents can authenticate, transact, and interact with your services programmatically. Covers 4 categories: bot auth, identity, payments, and bazaar (marketplace listing).",
  },
  verifiability: {
    label: "Verifiability",
    question: "Can an agent verify what it observed?",
    weight: 25,
    description:
      "Measures whether AI agents can verify your identity, infrastructure reliability, and operational metadata through active probing. Covers 3 categories: verification, infrastructure, and active probing.",
  },
};

// EPIC-140 (SLICE-140-11): RULE_DESCRIPTIONS split by category into ./{category}.ts
import { discoveryRules } from "./discovery";
import { documentationRules } from "./documentation";
import { actionabilityRules } from "./actionability";
import { machineReadableRules } from "./machine_readable";
import { verificationRules } from "./verification";
import { contentNegotiationRules } from "./content_negotiation";
import { paymentsRules } from "./payments";
import { bazaarRules } from "./bazaar";
import { openapiRules } from "./openapi";
import { skillsRules } from "./skills";
import { agentsTxtRules } from "./agents_txt";
import { webmcpRules } from "./webmcp";
import { identityRules } from "./identity";
import { botAuthRules } from "./bot_auth";
import { infrastructureRules } from "./infrastructure";
import { seoAeoRules } from "./seo_aeo";
import { accessibilityRules } from "./accessibility";
import { errorSemanticsRules } from "./error_semantics";
import { pricingRules } from "./pricing";
import { rateLimitsRules } from "./rate_limits";
import { retrySemanticsRules } from "./retry_semantics";
import { versioningRules } from "./versioning";
import { sandboxRules } from "./sandbox";
import { agentPolicyRules } from "./agent_policy";

export const RULE_DESCRIPTIONS: RuleDescription[] = [
  ...discoveryRules,
  ...documentationRules,
  ...actionabilityRules,
  ...machineReadableRules,
  ...verificationRules,
  ...contentNegotiationRules,
  ...paymentsRules,
  ...bazaarRules,
  ...openapiRules,
  ...skillsRules,
  ...agentsTxtRules,
  ...webmcpRules,
  ...identityRules,
  ...botAuthRules,
  ...infrastructureRules,
  ...seoAeoRules,
  ...accessibilityRules,
  ...errorSemanticsRules,
  ...pricingRules,
  ...rateLimitsRules,
  ...retrySemanticsRules,
  ...versioningRules,
  ...sandboxRules,
  ...agentPolicyRules,
];
