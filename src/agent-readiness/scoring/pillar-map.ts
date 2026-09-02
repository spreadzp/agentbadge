import type { Category, Pillar } from "../shared.schema";
import type { AgentReadinessRule } from "../rule.schema";

export const CATEGORY_TO_PILLAR: Readonly<Record<Category, Pillar>> = {
  discovery: "discovery",
  machine_readable: "discovery",
  openapi: "discovery",
  skills: "discovery",
  agents_txt: "discovery",
  webmcp: "discovery",
  content_negotiation: "discovery",
  seo_aeo: "discovery",
  documentation: "understandability",
  actionability: "understandability",
  accessibility: "understandability",
  bot_auth: "executability",
  identity: "executability",
  payments: "executability",
  bazaar: "executability",
  verification: "verifiability",
  infrastructure: "verifiability",
  active_probing: "verifiability",
};

export const PILLARS: readonly Pillar[] = [
  "discovery",
  "understandability",
  "executability",
  "verifiability",
] as const;

export const PILLAR_CATEGORIES: Readonly<Record<Pillar, Category[]>> = Object.freeze(
  PILLARS.reduce(
    (acc, pillar) => {
      acc[pillar] = (Object.keys(CATEGORY_TO_PILLAR) as Category[]).filter(
        (cat) => CATEGORY_TO_PILLAR[cat] === pillar,
      );
      return acc;
    },
    {} as Record<Pillar, Category[]>,
  ),
);

export const PILLAR_LABELS: Record<Pillar, string> = {
  discovery: "Discovery",
  understandability: "Understandability",
  executability: "Executability",
  verifiability: "Verifiability",
};

export const PILLAR_QUESTIONS: Record<Pillar, string> = {
  discovery: "Can an agent find you?",
  understandability: "Can an agent understand you?",
  executability: "Can an agent act on your API?",
  verifiability: "Can an agent verify what it observed?",
};

export function rulePillar(rule: Pick<AgentReadinessRule, "category" | "pillar">): Pillar {
  return rule.pillar ?? CATEGORY_TO_PILLAR[rule.category];
}
