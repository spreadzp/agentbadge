import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta } from "../server/lib/page-meta";
import { RelatedLinks } from "./related-links";
import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  PILLAR_DESCRIPTIONS,
  type RuleDescription,
  type CategoryDescription,
} from "../agent-readiness/rule-descriptions";
import { categoryEnum } from "../agent-readiness/shared.schema";
import { PILLARS, PILLAR_CATEGORIES } from "../agent-readiness/scoring/pillar-map";
import { AGENT_READINESS_RULESET } from "../agent-readiness/ruleset";
import { pageCoreSchemas, breadcrumbFor, collectionPageLd } from "../server/lib/json-ld";
import { DEFAULT_GAP_TYPE_BY_CATEGORY } from "../agent-readiness/gap-engine/gap-types";

const GAP_TYPE_DESCRIPTIONS: Record<string, { label: string; description: string }> = {
  documentation: { label: "Documentation", description: "Artifact is absent — nothing to read" },
  semantic: { label: "Semantic", description: "Artifact exists but doesn't answer the agent's question" },
  capability: { label: "Capability", description: "Service lacks what agents need" },
  evidence: { label: "Evidence", description: "Sources disagree" },
};

const EFFORT_STYLES: Record<string, string> = {
  quick: "text-emerald-400 border-emerald-500/30 bg-emerald-500/10",
  moderate: "text-amber-400 border-amber-500/30 bg-amber-500/10",
  complex: "text-rose-400 border-rose-500/30 bg-rose-500/10",
};

const EFFORT_LABELS: Record<string, string> = {
  quick: "Quick fix",
  moderate: "Moderate",
  complex: "Complex",
};

const SEVERITY_STYLES: Record<string, string> = {
  critical: "text-rose-300 border-rose-500/40 bg-rose-500/10",
  high: "text-orange-300 border-orange-500/40 bg-orange-500/10",
  medium: "text-amber-300 border-amber-500/40 bg-amber-500/10",
  low: "text-sky-300 border-sky-500/40 bg-sky-500/10",
};

function ruleCard(rule: RuleDescription) {
  const effortStyle = EFFORT_STYLES[rule.effort_hint];
  const effortLabel = EFFORT_LABELS[rule.effort_hint];
  const ruleDef = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === rule.rule_id);
  const severity = rule.severity ?? ruleDef?.severity ?? "medium";
  const severityStyle = SEVERITY_STYLES[severity] ?? SEVERITY_STYLES.medium;
  const gapType = ruleDef?.gap_type ?? DEFAULT_GAP_TYPE_BY_CATEGORY[rule.category];
  const gapTypeLabel = GAP_TYPE_DESCRIPTIONS[gapType]?.label ?? gapType;
  return html`<a
    href="/rules/${rule.rule_id}"
    class="block rounded-lg border border-slate-800 bg-slate-900/50 p-4 hover:border-slate-600 hover:bg-slate-800/50 transition-colors"
  >
    <div class="flex items-start justify-between gap-3">
      <div class="flex items-start gap-3 min-w-0">
        <span class="text-xl flex-shrink-0">${rule.icon}</span>
        <div class="min-w-0">
          <div class="font-medium text-slate-100 truncate">${rule.title}</div>
          <div class="text-sm text-slate-400 mt-0.5 line-clamp-2">${rule.short_description}</div>
        </div>
      </div>
      <div class="flex flex-col items-end gap-1 flex-shrink-0">
        <span class="text-[10px] border ${raw(severityStyle)} rounded px-1.5 py-0.5 font-mono uppercase tracking-wider">
          ${severity}
        </span>
        <span class="text-[10px] border ${raw(effortStyle)} rounded px-1.5 py-0.5 font-mono uppercase tracking-wider">
          ${effortLabel}
        </span>
        <span class="text-[10px] border border-slate-700 rounded px-1.5 py-0.5 font-mono text-slate-400" title="Gap type: ${gapTypeLabel}">
          ${gapTypeLabel}
        </span>
      </div>
    </div>
  </a>`;
}

function categorySection(
  category: string,
  desc: CategoryDescription,
  rules: RuleDescription[],
  index: number,
) {
  const ruleCards = rules.map((r) => ruleCard(r)).join("\n");
  return html`<details class="group border border-slate-800 rounded-lg overflow-hidden" ${index === 0 ? "open" : ""}>
    <summary
      class="flex items-center justify-between gap-4 px-5 py-4 cursor-pointer hover:bg-slate-800/30 transition-colors select-none"
    >
      <div class="flex items-center gap-3 min-w-0">
        <span class="text-2xl flex-shrink-0">${desc.icon}</span>
        <div class="min-w-0">
          <div class="font-semibold text-slate-100">${desc.title}</div>
          <div class="text-sm text-slate-400 truncate">${desc.description}</div>
        </div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <span class="text-xs font-mono text-slate-500 border border-slate-700 rounded px-2 py-0.5">
          ${rules.length} ${rules.length === 1 ? "rule" : "rules"}
        </span>
        <svg class="w-5 h-5 text-slate-500 transition-transform group-open:rotate-180" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </summary>
    <div class="border-t border-slate-800 p-4 space-y-3 bg-slate-950/50">
      ${raw(ruleCards)}
    </div>
  </details>`;
}

function pillarSection(
  pillar: string,
  pillarDesc: { label: string; question: string; weight: number; description: string },
  categorySections: unknown[],
) {
  return html`<section class="space-y-3" id="pillar-${pillar}">
    <div class="flex items-center justify-between gap-4 border-b border-slate-700 pb-3 mb-2">
      <div>
        <h2 class="text-xl font-bold text-slate-100">${pillarDesc.label}</h2>
        <p class="text-sm text-slate-400 mt-0.5">${pillarDesc.question}</p>
      </div>
      <div class="flex items-center gap-2 flex-shrink-0">
        <span class="text-xs font-mono text-slate-500 border border-slate-700 rounded px-2 py-0.5">
          Weight: ${pillarDesc.weight}
        </span>
      </div>
    </div>
    <div class="space-y-3">
      ${raw(categorySections.join("\n"))}
    </div>
  </section>`;
}

export function RulesCatalogPage() {
  const categories = categoryEnum.options;

  const schemas = [
    ...pageCoreSchemas(),
    collectionPageLd({
      name: "Rules Catalog",
      description:
        `All ${RULE_DESCRIPTIONS.length} agent readiness rules across ${categories.length} categories. Understand what AgentBadge checks and why each rule matters for AI agent compatibility.`,
      path: "/rules",
    }),
    breadcrumbFor("/rules", "Rules"),
  ];

  const meta: PageMeta = {
    title: "Rules Catalog",
    description:
      `All ${RULE_DESCRIPTIONS.length} agent readiness rules across ${categories.length} categories. Understand what AgentBadge checks and why each rule matters for AI agent compatibility.`,
    path: "/rules",
  };

  const sections = PILLARS.map((pillar) => {
    const pillarCats = PILLAR_CATEGORIES[pillar];
    const catSections = pillarCats
      .map((cat, i) => {
        const rules = RULE_DESCRIPTIONS.filter((r) => r.category === cat);
        if (rules.length === 0) return "";
        return categorySection(cat, CATEGORY_DESCRIPTIONS[cat], rules, i);
      })
      .filter(Boolean);
    if (catSections.length === 0) return "";
    return pillarSection(pillar, PILLAR_DESCRIPTIONS[pillar], catSections);
  }).filter(Boolean).join("\n");

  const content = html`<div class="min-h-screen">
    <div class="mx-auto max-w-4xl px-4 py-16 md:py-24">
      <!-- Hero -->
      <div class="text-center mb-12">
        <div class="text-xs font-mono uppercase tracking-widest text-emerald-400 mb-3">
          Agent Readiness Rules
        </div>
        <h1 class="text-4xl md:text-5xl font-bold tracking-tight">What We Check</h1>
        <p class="mt-4 text-lg text-slate-400 max-w-2xl mx-auto">
          ${RULE_DESCRIPTIONS.length} rules across ${categories.length} categories. Each rule ensures your site is
          discoverable, understandable, and usable by AI agents.
        </p>
        <div class="mt-4 text-sm">
          <a href="/agent-readiness-checklist" class="text-emerald-400 hover:text-emerald-300 inline-flex items-center gap-1">
            View as checklist
            <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </a>
        </div>
        <div class="mt-6 inline-flex items-center gap-2 text-sm text-slate-500">
          <span class="inline-flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-emerald-400"></span> Quick fix
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-amber-400"></span> Moderate
          </span>
          <span class="inline-flex items-center gap-1.5">
            <span class="w-2 h-2 rounded-full bg-rose-400"></span> Complex
          </span>
          <span class="inline-flex items-center gap-1.5 ml-2 pl-2 border-l border-slate-700">
            <span class="inline-flex items-center gap-1 text-xs font-mono border border-rose-500/40 bg-rose-500/10 rounded px-1.5 py-0.5 text-rose-300">CRITICAL</span>
            <span class="inline-flex items-center gap-1 text-xs font-mono border border-amber-500/40 bg-amber-500/10 rounded px-1.5 py-0.5 text-amber-300">MEDIUM</span>
            <span class="inline-flex items-center gap-1 text-xs font-mono border border-sky-500/40 bg-sky-500/10 rounded px-1.5 py-0.5 text-sky-300">LOW</span>
            <span class="text-slate-500">Severity</span>
          </span>
        </div>
        <!-- Gap type legend -->
        <div class="mt-4 flex flex-wrap items-center justify-center gap-2 text-xs text-slate-500">
          <span class="text-slate-600">Gap types:</span>
          ${raw(Object.entries(GAP_TYPE_DESCRIPTIONS).map(([_key, desc]) =>
    `<span class="inline-flex items-center gap-1 text-xs font-mono border border-slate-700 rounded-full px-2.5 py-0.5 text-slate-400" title="${desc.description}">${desc.label}</span>`
  ).join(" "))}
        </div>
      </div>

      <!-- Category sections -->
      <div class="space-y-3">
        ${raw(sections)}
      </div>

      <!-- CTA -->
      <div class="mt-12 text-center border-t border-slate-800 pt-8">
        <p class="text-slate-400 mb-4">Want to check your site against all ${RULE_DESCRIPTIONS.length} rules?</p>
        <a
          href="/#scan"
          class="inline-flex items-center gap-2 rounded-lg bg-emerald-500 px-6 py-3 font-medium text-slate-950 hover:bg-emerald-400 transition-colors"
        >
          Scan Your Site
          <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
        </a>
      </div>
    </div>
  </div>`;

  const rulesCrossLinks = [
    { label: "FAQ", href: "/faq", description: "Common questions about agent readiness rules" },
    { label: "Agent Guide", href: "/agent-guide", description: "Step-by-step guide to becoming agent-ready" },
    { label: "Blog", href: "/blog", description: "Deep dives into agent readiness concepts" },
  ];
  const crossLinks = RelatedLinks("Explore More", rulesCrossLinks);

  return Layout(content.toString() + crossLinks, meta.title, meta, schemas);
}
