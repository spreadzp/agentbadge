/**
 * EPIC-230 (SLICE-230-5) + EPIC-232 (SLICE-232-7/9): the decide
 * form — criteria scoring, optional supervised AI prefill, and the
 * reject-suggestion escape hatch. Split from review-forms.ts
 * (max-lines). The decision stays human-written; the suggestion
 * only prefills inputs the operator can still edit or reject.
 */

import { html } from "hono/html";

import { criteriaForReview } from "../../server/lib/reviews/criteria";
import {
  REVIEW_DECISION_OUTCOMES,
  type ReviewCaseRecord,
} from "../../server/lib/reviews/types";

import {
  formBtn,
  inputCls,
  sel,
  tokenField,
} from "./review-forms";

/** 232-9 E9: the visible review_assist run distilled for the
 *  decide form — prefill only happens in `supervised` mode with
 *  confidence ≥ threshold; anything less is advisory/human-required. */
export interface AssistSuggestion {
  runId: string;
  mode: string;
  confidence: number | null;
  threshold: number | null;
  criteria: { name: string; passed: boolean; evidence?: string }[];
  recommendation: string;
}

export function decideForm(
  r: ReviewCaseRecord,
  token: string,
  suggestion?: AssistSuggestion | null,
) {
  if (r.status !== "IN_REVIEW") return "";
  const criteria = criteriaForReview(r.reviewType);
  const prefillable =
    suggestion != null &&
    suggestion.mode === "supervised" &&
    (suggestion.threshold == null ||
      (suggestion.confidence ?? 0) >= suggestion.threshold);
  const byName = new Map(
    (suggestion?.criteria ?? []).map((c) => [c.name, c]),
  );
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      Decide — score every platform criterion (required FAIL
      contradicts APPROVED*)
      ${suggestion
        ? prefillable
          ? html`<span
              class="ml-2 rounded border border-amber-700/60 bg-amber-950/40 px-1.5 py-0.5 text-[10px] font-normal text-amber-300"
              >supervised — AI prefilled · confirm / edit / reject</span
            >`
          : html`<span
              class="ml-2 rounded border border-slate-700 bg-slate-800 px-1.5 py-0.5 text-[10px] font-normal text-slate-400"
              >human required${suggestion.threshold != null && (suggestion.confidence ?? 0) < suggestion.threshold ? ` (conf ${suggestion.confidence} < ${suggestion.threshold})` : ""}</span
            >`
        : ""}
    </h3>
    <form
      method="post"
      action="/admin/review-center/reviews/${r.id}/decide"
      class="space-y-2"
    >
      ${tokenField(token)}
      ${suggestion
        ? html`<input type="hidden" name="aiRunRef" value="${suggestion.runId}" />`
        : ""}
      <div class="space-y-1.5">
        ${criteria.map((c) => {
          const ai = prefillable ? byName.get(c.key) : undefined;
          return html`<div
            class="flex flex-wrap items-center gap-2 text-xs"
          >
            <span class="w-56 text-slate-300"
              >${c.label}
              ${c.required
                ? html`<span class="text-amber-400">*</span>`
                : ""}</span
            >
            ${sel(
              `crit_${c.key}`,
              ["", "PASS", "FAIL", "NA"],
              ai ? (ai.passed ? "PASS" : "FAIL") : "",
            )}
            <input
              name="note_${c.key}"
              maxlength="1000"
              value="${ai?.evidence ? `ai: ${ai.evidence}`.slice(0, 200) : ""}"
              placeholder="note (internal — not shown to agent)"
              class="${inputCls} flex-1"
            />
          </div>`;
        })}
      </div>
      <label class="block text-xs text-slate-500"
        >outcome ${sel(
          "outcome",
          ["", ...REVIEW_DECISION_OUTCOMES],
          prefillable ? suggestion!.recommendation : "",
        )}
      </label>
      <label class="block text-xs text-slate-500">
        summary (public — returned to the agent)
        <textarea
          name="summary"
          rows="3"
          maxlength="4000"
          required
          class="${inputCls}"
        ></textarea>
      </label>
      ${formBtn(prefillable ? "Confirm decision →" : "Decide →")}
    </form>
    ${suggestion && suggestion.mode === "supervised"
      ? html`<form
          method="post"
          action="/admin/review-center/reviews/${r.id}/reject-suggestion"
          class="mt-2 border-t border-slate-800 pt-2"
        >
          ${tokenField(token)}
          <input type="hidden" name="aiRunRef" value="${suggestion.runId}" />
          <div class="flex items-center gap-2">
            <input
              name="reason"
              maxlength="200"
              placeholder="rejection reason (internal, for metrics)"
              class="${inputCls} flex-1"
            />
            <button
              type="submit"
              class="rounded bg-red-900 px-3 py-1.5 text-xs text-red-200 hover:bg-red-800"
            >
              Reject AI suggestion
            </button>
          </div>
        </form>`
      : ""}
  </section>`;
}
