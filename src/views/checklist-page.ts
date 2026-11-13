import { html, raw } from "hono/html";
import { Layout } from "./layout";
import { type PageMeta, pageTitle } from "../server/lib/page-meta";
import { pageCoreSchemas, collectionPageLd, breadcrumbFor, ruleItemListLd } from "../server/lib/json-ld";
import { RULE_DESCRIPTIONS, CATEGORY_DESCRIPTIONS, PILLAR_DESCRIPTIONS } from "../agent-readiness/rule-descriptions";
import { PILLARS, PILLAR_CATEGORIES, PILLAR_LABELS } from "../agent-readiness/scoring/pillar-map";
import { CORE_RULE_IDS, isCoreRule } from "../agent-readiness/core-rules";
import { BASE_URL } from "../server/lib/page-meta";

const EFFORT_BADGE: Record<string, string> = {
  quick: "bg-emerald-500/10 text-emerald-400 border-emerald-500/30",
  moderate: "bg-amber-500/10 text-amber-400 border-amber-500/30",
  complex: "bg-rose-500/10 text-rose-400 border-rose-500/30",
};

function ruleItem(rule: (typeof RULE_DESCRIPTIONS)[number]) {
  const cat = CATEGORY_DESCRIPTIONS[rule.category];
  const core = isCoreRule(rule.rule_id);
  return `<details id="${rule.rule_id}" class="group rounded-xl border border-slate-800 bg-slate-900/40 px-5 py-4">
    <summary class="flex cursor-pointer list-none items-start justify-between gap-3">
      <div>
        <div class="flex flex-wrap items-center gap-2">
          <span class="font-mono text-xs text-slate-500">${rule.rule_id}</span>
          <span class="font-semibold text-slate-100">${rule.title}</span>
          ${core ? `<span class="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400">Core</span>` : ""}
          <span class="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider ${EFFORT_BADGE[rule.effort_hint] ?? EFFORT_BADGE.moderate}">${rule.effort_hint}</span>
        </div>
        <p class="mt-1 text-sm text-slate-400">${rule.short_description}</p>
      </div>
      <span class="mt-1 shrink-0 text-slate-600 transition-transform group-open:rotate-90">▸</span>
    </summary>
    <div class="mt-3 border-t border-slate-800 pt-3 text-sm text-slate-400">
      <p>${rule.user_value}</p>
      <div class="mt-2 grid gap-2 sm:grid-cols-2">
        <p class="rounded-lg bg-rose-500/5 p-2 text-xs"><span class="font-semibold text-rose-400">Avoid:</span> ${rule.wrong_example}</p>
        <p class="rounded-lg bg-emerald-500/5 p-2 text-xs"><span class="font-semibold text-emerald-400">Fix:</span> ${rule.right_example}</p>
      </div>
      <a href="/rules/${rule.rule_id}" class="mt-2 inline-block text-xs text-emerald-400 underline underline-offset-2 hover:text-emerald-300">Rule details → /rules/${rule.rule_id}</a>
    </div>
    <p class="sr-only">${cat ? cat.title : rule.category}</p>
  </details>`;
}

/**
 * /agent-readiness-checklist — every readiness rule as a printable,
 * expandable checklist grouped by pillar. Replaces the audit-flagged stub.
 */
export function ChecklistPage() {
  const meta: PageMeta = {
    title: "Agent Readiness Checklist",
    description:
      "A complete checklist of all agent-readiness rules: what AI agents check when they scan your site, grouped by pillar — discovery, understandability, executability, verifiability.",
    path: "/agent-readiness-checklist",
  };

  const schemas = [
    ...pageCoreSchemas(),
    collectionPageLd({
      name: meta.title,
      description: meta.description,
      path: "/agent-readiness-checklist",
    }),
    breadcrumbFor("/agent-readiness-checklist", "Agent Readiness Checklist"),
    ruleItemListLd({
      name: "Agent Readiness Checklist",
      path: "/agent-readiness-checklist",
      items: RULE_DESCRIPTIONS.map((r) => ({
        name: `${r.rule_id} — ${r.title}`,
        url: `${BASE_URL}/rules/${r.rule_id}`,
        description: r.short_description,
      })),
    }),
  ];

  const pillarSections = PILLARS.map((pillar) => {
    const info = PILLAR_DESCRIPTIONS[pillar];
    const cats = PILLAR_CATEGORIES[pillar];
    const rules = RULE_DESCRIPTIONS.filter((r) => cats.includes(r.category));
    const groups = cats
      .map((cat) => {
        const catRules = rules.filter((r) => r.category === cat);
        if (catRules.length === 0) return "";
        const c = CATEGORY_DESCRIPTIONS[cat];
        return `<div class="mt-4">
          <h3 id="cat-${cat}" class="text-sm font-semibold text-emerald-300">${c?.title ?? cat}</h3>
          ${c ? `<p class="mt-1 text-xs text-slate-500">${c.description}</p>` : ""}
          <div class="mt-3 grid gap-3">
            ${catRules.map((r) => ruleItem(r)).join("\n")}
          </div>
        </div>`;
      })
      .join("\n");

    return `<section class="mt-12">
      <div class="flex flex-wrap items-baseline justify-between gap-2">
        <h2 class="text-2xl font-bold text-white">${PILLAR_LABELS[pillar]}</h2>
        <span class="text-xs font-mono text-slate-500">${info.weight}% of score · ${rules.length} rules</span>
      </div>
      <p class="mt-1 text-slate-400">${info.question} — ${info.description}</p>
      ${groups}
    </section>`;
  }).join("\n");

  const content = html`<div class="min-h-screen">
    <div class="mx-auto max-w-4xl px-4 py-16 md:py-20">
      <nav class="flex items-center gap-2 text-sm text-slate-500 mb-8" aria-label="Breadcrumb">
        <a href="/" class="hover:text-slate-300 transition-colors">Home</a>
        <span>/</span>
        <span class="text-slate-400">Agent Readiness Checklist</span>
      </nav>

      <h1 class="text-4xl md:text-5xl font-bold tracking-tight text-white">Agent Readiness Checklist</h1>
      <p class="mt-4 text-lg text-slate-400">
        Every rule our scanner checks when it evaluates your site for AI-agent readiness —
        ${RULE_DESCRIPTIONS.length} rules across 4 pillars, ${CORE_RULE_IDS.length} core rules
        with the highest scoring weight.
      </p>

      <div class="prose prose-invert prose-slate mt-10 max-w-none prose-headings:text-white">
        <h2>How to Use This Checklist</h2>
        <p>
          Work through each pillar top to bottom. Every item expands to show why it matters,
          a common anti-pattern, and the fix. When you're done, run the scanner — it walks
          the same ruleset and reports a weighted score.
        </p>
        <h2>How Scoring Works</h2>
        <p>
          Each pillar contributes its weight to the final score: ${PILLARS.map((p) => `${PILLAR_DESCRIPTIONS[p].label} ${PILLAR_DESCRIPTIONS[p].weight}%`).join(", ")}.
          A rule counts only when the scanner finds verifiable evidence on your live site —
          not promises in docs.
        </p>
        <h2>Core Rules vs Advanced Rules</h2>
        <p>
          <strong>Core rules</strong> (${CORE_RULE_IDS.length} of ${RULE_DESCRIPTIONS.length}) are the baseline
          every agent-facing site should pass — they're marked with a <em>Core</em> badge and carry
          the most scoring weight. The rest are advanced checks for deeper interop — payments,
          marketplace listing, WebMCP, and content negotiation.
        </p>
      </div>

      ${raw(pillarSections)}

      <div class="mt-14 rounded-2xl border border-emerald-500/30 bg-emerald-500/5 p-8 text-center">
        <h2 class="text-xl font-bold text-white">Check your site</h2>
        <p class="mt-2 text-slate-400">Run the scanner — it walks this exact ruleset against your live site.</p>
        <a href="/#scan" class="mt-4 inline-block rounded-lg bg-emerald-600 px-6 py-3 font-semibold text-white hover:bg-emerald-500 transition-colors">
          Scan Your Site →
        </a>
      </div>
    </div>
  </div>`;

  return Layout(content.toString(), pageTitle(meta.title), meta, schemas);
}
