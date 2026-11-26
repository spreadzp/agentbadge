/**
 * EPIC-232 (SLICE-232-2, §16.5): "AI suggestion" block for the
 * interaction detail page — renders advisory AiRun output NEXT TO
 * (never inside) the human classification form. Visually distinct:
 * amber dashed border + advisory badge; values are display-only —
 * nothing prefills or mutates operator fields.
 */

import { html } from "hono/html";

import type { AiSuggestionView } from "../../server/lib/ai/intake";

const STATUS_PILL: Record<string, string> = {
  success: "bg-emerald-900/60 text-emerald-300",
  invalid_json: "bg-amber-900/60 text-amber-300",
  timeout: "bg-amber-900/60 text-amber-300",
  error: "bg-red-900/60 text-red-300",
  skipped: "bg-slate-800 text-slate-400",
  none: "bg-slate-800 text-slate-500",
};

function field(label: string, value: unknown) {
  if (value === null || value === undefined || value === "") return "";
  const rendered = Array.isArray(value)
    ? (value as unknown[]).map(String).join(", ")
    : typeof value === "object"
      ? JSON.stringify(value)
      : String(value);
  return html`<div class="text-xs">
    <span class="text-slate-500">${label}:</span>
    <span class="ml-1 text-slate-200">${rendered}</span>
  </div>`;
}

function runBody(s: AiSuggestionView) {
  if (s.status === "none") {
    return html`<div class="text-xs text-slate-500">no run yet</div>`;
  }
  if (s.status !== "success") {
    return html`<div class="text-xs text-slate-500">
      ${s.error ?? s.status}
    </div>`;
  }
  const out = (s.output ?? {}) as Record<string, unknown>;
  // E3 (232-4): render matched knowledge entries "id (0.9)"-style —
  // suggestion only, never an auto-attach affordance.
  const scores = (out.relevanceScores ?? {}) as Record<string, number>;
  const matched = Array.isArray(out.matchedEntryIds)
    ? (out.matchedEntryIds as string[]).map((id) =>
        scores[id] !== undefined ? `${id} (${scores[id]})` : id,
      )
    : null;
  return html`<div class="mt-1 space-y-1">
    ${field("category", out.category)} ${field("intent", out.intent)}
    ${field("capabilities", out.capabilities)}
    ${field("summary", out.summary)} ${field("key facts", out.keyFacts)}
    ${field("query", out.query)} ${field("matched", matched)}
    ${field("confidence", s.confidence)}
  </div>`;
}

export function aiSuggestionSection(list: AiSuggestionView[]) {
  if (list.length === 0) return "";
  return html`<section
    class="mb-4 rounded-lg border border-dashed border-amber-700/60 bg-amber-950/20 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-amber-500/90">
      AI suggestion
      <span
        class="ml-2 rounded bg-amber-900/50 px-1.5 py-0.5 text-[10px] font-medium normal-case text-amber-300"
        >advisory — never applied to classification</span
      >
    </h3>
    <div class="grid grid-cols-1 gap-3 md:grid-cols-2">
      ${list.map(
        (s) => html`<div
          class="rounded border border-slate-800 bg-slate-900/60 p-2"
        >
          <div class="mb-1 flex items-center gap-2 text-xs">
            <span class="font-mono text-slate-300">${s.scenario}</span>
            <span
              class="rounded px-1 text-[10px] ${STATUS_PILL[s.status] ?? STATUS_PILL.none}"
              >${s.status}</span
            >
            ${s.belowThreshold
              ? html`<span
                  class="rounded bg-red-900/60 px-1 text-[10px] text-red-300"
                  >below threshold — human path</span
                >`
              : ""}
          </div>
          ${runBody(s)}
          <div class="mt-1 text-[10px] text-slate-600">
            mode ${s.mode} · model ${s.model ?? "—"} · prompt
            ${s.promptVersion ?? "—"}
          </div>
        </div>`,
      )}
    </div>
  </section>`;
}
