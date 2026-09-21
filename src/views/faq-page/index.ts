// EPIC-140 (SLICE-140-20): FAQ page — assembled from data + categories.
import { html, raw } from "hono/html";
import { Layout } from "../layout";
import { PageMeta } from "../../server/lib/page-meta";
import { applyChainTemplates } from "../../server/lib/chain-templates.js";
import { RelatedLinks } from "../related-links";
import { RAW_FAQ_ENTRIES, type QaPair } from "./data";
import { FAQ_CATEGORIES } from "./categories";

const faqCrossLinks = [
  { label: "About AgentBadge", href: "/about", description: "Our mission, architecture, and team" },
  { label: "Pricing", href: "/pricing", description: "Passport tiers and marketplace fees" },
  { label: "Use Cases", href: "/use-cases", description: "Real-world scenarios for agent-ready APIs" },
  { label: "Blog", href: "/blog", description: "Deep dives into agent readiness" },
];

export function slugifyQuestion(question: string): string {
  return question
    .toLowerCase()
    .replace(/[?.]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function getFaqEntries(): QaPair[] {
  return RAW_FAQ_ENTRIES.map((qa) => ({
    question: qa.question,
    answer: applyChainTemplates(qa.answer),
  }));
}

export function FaqPage(
  entries: QaPair[],
  jsonLd?: object[],
): string {
  const faqMeta = PageMeta["/faq"];
  const schemas = jsonLd;

  // Group entries by category
  const categorized = FAQ_CATEGORIES.map((cat) => {
    const items = cat.questionSlugs.map((slug) => {
      const entry = entries.find((e) => slugifyQuestion(e.question) === slug);
      if (!entry) return null;
      return { ...entry, anchor: slug };
    }).filter((item): item is NonNullable<typeof item> => item !== null);
    return { name: cat.name, slug: cat.slug, items };
  }).filter((cat) => cat.items.length > 0);

  const content = html`<section class="rounded-xl border border-slate-800 bg-gradient-to-br from-slate-900 to-slate-950 p-8">
    <span class="inline-block rounded-full border border-emerald-500/40 bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-300">FAQ</span>
    <h1 class="mt-4 text-3xl font-semibold text-white sm:text-4xl">Frequently Asked Questions</h1>
    <p class="mt-4 max-w-2xl text-slate-400">Answers to 40+ questions about AgentBadge, agent readiness, and on-chain identity.</p>

    <!-- Category Navigation: Desktop sidebar + Mobile tabs -->
    <div class="mt-8 flex flex-col gap-8 md:flex-row">
      <!-- Sidebar (desktop) -->
      <nav class="hidden md:block w-48 flex-shrink-0">
        <div class="sticky top-8 space-y-1">
          ${raw(FAQ_CATEGORIES.map((cat) => html`
            <a href="#${cat.slug}" class="block rounded-lg px-3 py-2 text-sm text-slate-400 hover:bg-slate-900 hover:text-emerald-400 transition-colors">
              ${cat.name}
            </a>
          `).join(""))}
        </div>
      </nav>

      <!-- Mobile tabs -->
      <div class="md:hidden -mx-4 px-4 overflow-x-auto">
        <div class="flex gap-2 pb-2">
          ${raw(FAQ_CATEGORIES.map((cat) => html`
            <a href="#${cat.slug}" class="whitespace-nowrap rounded-lg border border-slate-800 px-3 py-1.5 text-xs text-slate-400 hover:border-emerald-500 hover:text-emerald-400">
              ${cat.name}
            </a>
          `).join(""))}
        </div>
      </div>

      <!-- FAQ Content -->
      <div class="flex-1 min-w-0">
        ${raw(categorized.map((cat) => html`
          <section id="${cat.slug}" class="mb-12 scroll-mt-8">
            <h2 class="text-xl font-semibold text-white mb-4">${cat.name}</h2>
            <div class="space-y-3">
              ${raw(cat.items.map((item) => html`
                <details id="${item!.anchor}" class="group scroll-mt-8 rounded-lg border border-slate-800 bg-slate-900/50 p-5">
                  <summary class="flex cursor-pointer items-center justify-between text-white font-medium">
                    ${item!.question}
                    <svg class="h-5 w-5 text-slate-400 transition-transform group-open:rotate-180" fill="none" stroke="currentColor" stroke-width="2" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" /></svg>
                  </summary>
                  <div class="mt-3 text-sm text-slate-400 leading-relaxed">
                    ${raw(item!.answer)}
                  </div>
                </details>
              `).join(""))}
            </div>
          </section>
        `).join(""))}
      </div>
    </div>
  </section>

  <section class="mt-8 rounded-lg border border-slate-800 bg-slate-900 p-6 text-center">
    <p class="text-slate-300">Still have questions?</p>
    <p class="mt-2 text-sm text-slate-400">
      <a href="/services/scanner" class="text-emerald-400 underline hover:text-emerald-300">Scan your API</a>,
      get an <a href="/services/passports" class="text-emerald-400 underline hover:text-emerald-300">agent passport</a>,
      or browse the <a href="/services/marketplace" class="text-emerald-400 underline hover:text-emerald-300">marketplace</a>.
      Read the <a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Agent Guide</a> for step-by-step onboarding.
    </p>
  </section>

  <section class="mt-4 rounded-lg border border-slate-800 bg-slate-900/50 p-6">
    <h2 class="text-sm font-semibold text-slate-200">Agent Resources</h2>
    <p class="mt-1 text-xs text-slate-400">Machine-readable endpoints for AI agents:</p>
    <ul class="mt-3 flex flex-wrap gap-3 text-sm">
      <li><a href="/llms.txt" class="text-emerald-400 underline hover:text-emerald-300">llms.txt</a></li>
      <li><a href="/llms-full.txt" class="text-emerald-400 underline hover:text-emerald-300">llms-full.txt</a></li>
      <li><a href="/agent-guide" class="text-emerald-400 underline hover:text-emerald-300">Agent Guide</a></li>
      <li><a href="/sitemap.xml" class="text-emerald-400 underline hover:text-emerald-300">sitemap.xml</a></li>
      <li><a href="/.well-known/ai-plugin.json" class="text-emerald-400 underline hover:text-emerald-300">ai-plugin.json</a></li>
      <li><a href="/blog" class="text-emerald-400 underline hover:text-emerald-300">Blog</a></li>
    </ul>
  </section>

  ${raw(RelatedLinks("Explore More", faqCrossLinks))}`;

  return Layout(content.toString(), faqMeta.title, faqMeta, schemas);
}
