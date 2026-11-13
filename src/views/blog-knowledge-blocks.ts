import { html } from "hono/html";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { type ContentStatus, type KnowledgeObject } from "../server/lib/blog/knowledge-object";

/**
 * SLICE-201-11: article knowledge blocks — Q&A, Key facts, context links,
 * FOR AI AGENTS agent-context (D-201-16) + Author/work-with (D-201-23).
 * All data derives from toKnowledgeObject(article) — same derivation as
 * /blog/:slug.json (SSOT, D-201-13).
 */

const STATUS_BADGE: Record<ContentStatus, string> = {
  IDEA: "border-slate-500/50 bg-slate-800/60 text-slate-400",
  EXPERIMENT: "border-amber-600/50 bg-amber-950/40 text-amber-400",
  PROTOTYPE: "border-sky-600/50 bg-sky-950/40 text-sky-400",
  LIVE: "border-emerald-600/50 bg-emerald-950/40 text-emerald-400",
  PRODUCTION: "border-emerald-600/50 bg-emerald-950/40 text-emerald-300",
  ARCHIVED: "border-slate-600/50 bg-slate-900/60 text-slate-500",
};

/**
 * agent-knowledge page registry (lazy, process-memoized).
 * /agent-guide/<kind>/<name> resolves to src/server/agent-knowledge/<kind>/<name>.md —
 * links are rendered only for names that actually have a page (404 fix:
 * article metadata may list concepts/capabilities without a doc yet).
 */
const AGENT_KNOWLEDGE_DIR = join(__dirname, "../server/agent-knowledge");
const knowledgePageCache = new Map<string, Set<string>>();

function listKnowledgePages(kind: "concepts" | "capabilities"): Set<string> {
  let pages = knowledgePageCache.get(kind);
  if (!pages) {
    try {
      pages = new Set(
        readdirSync(join(AGENT_KNOWLEDGE_DIR, kind))
          .filter((f) => f.endsWith(".md"))
          .map((f) => f.slice(0, -".md".length)),
      );
    } catch {
      pages = new Set();
    }
    knowledgePageCache.set(kind, pages);
  }
  return pages;
}

export function knowledgePageExists(
  kind: "concepts" | "capabilities",
  name: string,
): boolean {
  return listKnowledgePages(kind).has(name);
}

export function StatusBadge(status: ContentStatus) {
  return html`<span
    class="inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold uppercase tracking-wider ${STATUS_BADGE[status]}"
    aria-label="Content status: ${status}"
    >${status}</span
  >`;
}

/** SLICE-201-11: collapsible Q&A from ko.qa (H2-derived or curated). */
export function QaBlock(ko: KnowledgeObject) {
  if (ko.qa.length === 0) return "";
  return html`<section
    class="mt-8 rounded-xl border border-slate-700 bg-slate-900/50 p-6"
    aria-label="Questions and Answers"
  >
    <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">
      Questions &amp; Answers
    </h2>
    <div class="mt-3 divide-y divide-slate-800">
      ${ko.qa.map(
        (q) =>
          html`<details class="group py-3">
            <summary
              class="cursor-pointer list-none text-sm font-medium text-slate-200 hover:text-emerald-300"
            >
              <span
                class="mr-2 inline-block text-emerald-500 transition-transform group-open:rotate-90"
                >›</span
              >${q.question}
            </summary>
            <p class="mt-2 pl-5 text-sm text-slate-400">${q.answer}</p>
          </details>`,
      )}
    </div>
  </section>`;
}

/** SLICE-201-11: "Key facts" — verifiable claims with evidence links. */
export function KeyFactsBlock(ko: KnowledgeObject) {
  if (ko.claims.length === 0) return "";
  return html`<section
    class="mt-8 rounded-xl border border-slate-700 bg-slate-900/50 p-6"
    aria-label="Key facts"
  >
    <h2 class="text-sm font-semibold uppercase tracking-widest text-slate-500">Key facts</h2>
    <ul class="mt-3 space-y-3">
      ${ko.claims.map(
        (claim) =>
          html`<li class="text-sm text-slate-300">
            <span
              class="mr-2 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider ${claim.status === "VERIFIED" ? "border-emerald-600/50 text-emerald-400" : "border-slate-600/50 text-slate-500"}"
              >${claim.status}</span
            >
            ${claim.text}
            ${
              claim.evidence && claim.evidence.length > 0
                ? html`<span class="ml-2 inline-flex flex-wrap gap-2">
                    ${claim.evidence.map(
                    (e) =>
                      html`<a
                        href="${e.url}"
                        target="_blank"
                        rel="noopener"
                        class="text-xs text-emerald-500 hover:text-emerald-300"
                        >[${e.type}]</a
                      >`,
                  )}
                  </span>`
                : ""
            }
          </li>`,
      )}
    </ul>
  </section>`;
}

/** SLICE-201-11: context links (concepts/capabilities/technologies). */
export function ContextBlock(ko: KnowledgeObject) {
  const has =
    ko.concepts.length > 0 || ko.capabilities.length > 0 || (ko.technologies?.length ?? 0) > 0;
  if (!has) return "";
  return html`<nav
    class="mt-8 flex flex-wrap items-center gap-2 text-xs"
    aria-label="Article context"
  >
    <span class="font-semibold uppercase tracking-widest text-slate-500">Context:</span>
    ${ko.concepts.map((c) =>
      knowledgePageExists("concepts", c)
        ? html`<a
            href="/agent-guide/concepts/${encodeURIComponent(c)}"
            class="rounded-full border border-slate-700 px-3 py-1 text-slate-300 hover:border-emerald-600 hover:text-emerald-400"
            >${c}</a
          >`
        : html`<span
            class="rounded-full border border-slate-800 px-3 py-1 text-slate-500"
            >${c}</span
          >`,
    )}
    ${ko.capabilities.map((c) =>
      knowledgePageExists("capabilities", c)
        ? html`<a
            href="/agent-guide/capabilities/${encodeURIComponent(c)}"
            class="rounded-full border border-slate-700 px-3 py-1 text-slate-300 hover:border-emerald-600 hover:text-emerald-400"
            >${c}</a
          >`
        : html`<span
            class="rounded-full border border-slate-800 px-3 py-1 text-slate-500"
            >${c}</span
          >`,
    )}
    ${(ko.technologies ?? []).map(
      (t) => html`<span class="rounded-full bg-slate-800 px-3 py-1 text-slate-400">${t}</span>`,
    )}
  </nav>`;
}
