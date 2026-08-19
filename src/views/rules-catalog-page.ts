import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta } from "../server/lib/page-meta";
import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  type RuleDescription,
  type CategoryDescription,
} from "../agent-readiness/rule-descriptions";
import { categoryEnum } from "../agent-readiness/shared.schema";
import { faqPageLd, defaultCoreSchemas } from "../server/lib/json-ld";

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

function ruleCard(rule: RuleDescription) {
  const effortStyle = EFFORT_STYLES[rule.effort_hint];
  const effortLabel = EFFORT_LABELS[rule.effort_hint];
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
      <span class="flex-shrink-0 text-[10px] border ${raw(effortStyle)} rounded px-1.5 py-0.5 font-mono uppercase tracking-wider">
        ${effortLabel}
      </span>
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

export function RulesCatalogPage(jsonLd?: object[]) {
  const categories = categoryEnum.options;
  const faqEntries = categories.map((cat) => ({
    question: `What is the ${CATEGORY_DESCRIPTIONS[cat].title} category?`,
    answer: CATEGORY_DESCRIPTIONS[cat].description,
  }));

  const schemas = [...defaultCoreSchemas(), faqPageLd(faqEntries)];

  const meta: PageMeta = {
    title: "Rules Catalog",
    description:
      "All 76 agent readiness rules across 15 categories. Understand what AgentBadge checks and why each rule matters for AI agent compatibility.",
    path: "/rules",
  };

  const sections = categories
    .map((cat, i) => {
      const rules = RULE_DESCRIPTIONS.filter((r) => r.category === cat);
      if (rules.length === 0) return "";
      return categorySection(cat, CATEGORY_DESCRIPTIONS[cat], rules, i);
    })
    .filter(Boolean)
    .join("\n");

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

  return Layout(content.toString(), meta.title, meta, schemas);
}
