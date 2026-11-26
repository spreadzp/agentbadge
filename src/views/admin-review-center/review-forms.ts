/**
 * EPIC-230 (SLICE-230-5, D-230-11): review detail action forms —
 * claim / decline / decide / reopen / return + operator evidence add.
 * The decide form renders the case's platform criteria template —
 * agentCriteria renders as context only, never as score inputs.
 */

import { html } from "hono/html";

import {
  REVIEW_DECLINE_REASONS,
  REVIEW_EVIDENCE_TYPES,
  type ReviewCaseRecord,
} from "../../server/lib/reviews/types";

export const inputCls =
  "mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200";

export const formBtn = (label: string, cls = "") => html`<button
  type="submit"
  class="mt-2 rounded bg-emerald-800 px-3 py-1.5 text-sm text-emerald-100 hover:bg-emerald-700 ${cls}"
>
  ${label}
</button>`;

export const tokenField = (token: string) =>
  html`<input type="hidden" name="formToken" value="${token}" />`;

export const sel = (
  name: string,
  options: readonly string[],
  current: unknown,
) => html`<select
  name="${name}"
  class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
>
  ${options.map(
    (o) =>
      html`<option value="${o}" ${o === current ? "selected" : ""}>${o === "" ? "—" : o}</option>`,
  )}
</select>`;

export function claimForm(r: ReviewCaseRecord, token: string) {
  if (r.status !== "PENDING_TRIAGE") return "";
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      Claim — take this case IN_REVIEW as the assignee
    </h3>
    <form method="post" action="/admin/review-center/reviews/${r.id}/claim">
      ${tokenField(token)} ${formBtn("Claim →")}
    </form>
  </section>`;
}

export function declineForm(r: ReviewCaseRecord, token: string) {
  if (r.status !== "PENDING_TRIAGE" && r.status !== "IN_REVIEW") return "";
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      Decline — closed-vocabulary reason required
    </h3>
    <form
      method="post"
      action="/admin/review-center/reviews/${r.id}/decline"
      class="space-y-2"
    >
      ${tokenField(token)}
      <input type="hidden" name="fromStatus" value="${r.status}" />
      <label class="block text-xs text-slate-500"
        >declineReason
        ${sel("declineReason", REVIEW_DECLINE_REASONS, "OUT_OF_SCOPE")}
      </label>
      <label class="block text-xs text-slate-500">
        note (internal)
        <input name="reason" maxlength="300" class="${inputCls}" />
      </label>
      ${formBtn("Decline →", "bg-red-800 hover:bg-red-700")}
    </form>
  </section>`;
}

export function reopenForm(r: ReviewCaseRecord, token: string) {
  if (r.status !== "DECIDED") return "";
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      Reopen — a new decision will append seq+1 (old ones immutable)
    </h3>
    <form
      method="post"
      action="/admin/review-center/reviews/${r.id}/reopen"
      class="space-y-2"
    >
      ${tokenField(token)}
      <label class="block text-xs text-slate-500">
        reason (internal)
        <input name="reason" maxlength="300" class="${inputCls}" />
      </label>
      ${formBtn("Reopen →", "bg-orange-800 hover:bg-orange-700")}
    </form>
  </section>`;
}

export function returnForm(r: ReviewCaseRecord, token: string) {
  if (r.status !== "REOPENED") return "";
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <form
      method="post"
      action="/admin/review-center/reviews/${r.id}/return"
    >
      ${tokenField(token)} ${formBtn("Return to triage →", "bg-slate-700 hover:bg-slate-600")}
    </form>
  </section>`;
}

export function convertForm(r: ReviewCaseRecord, token: string) {
  if (r.status !== "DECIDED" || r.knowledgeConverted) return "";
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      → Knowledge draft (creates a DRAFT — 229 approval stays human)
    </h3>
    <form method="post" action="/admin/review-center/reviews/${r.id}/convert">
      ${tokenField(token)} ${formBtn("Convert →")}
      <a
        href="/admin/review-center/reviews/${r.id}/draft.json"
        class="ml-3 text-xs text-slate-400 underline"
        >export draft JSON</a
      >
    </form>
  </section>`;
}

export function evidenceForm(r: ReviewCaseRecord, token: string) {
  if (r.status !== "IN_REVIEW") return "";
  return html`<section
    class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      Add operator evidence
    </h3>
    <form
      method="post"
      action="/admin/review-center/reviews/${r.id}/evidence"
      class="space-y-2"
    >
      ${tokenField(token)}
      <div class="grid grid-cols-2 gap-2">
        <label class="block text-xs text-slate-500"
          >type ${sel("type", REVIEW_EVIDENCE_TYPES, "OTHER")}
        </label>
        <label class="block text-xs text-slate-500">
          label
          <input name="label" maxlength="300" class="${inputCls}" />
        </label>
      </div>
      <label class="block text-xs text-slate-500">
        uri
        <input name="uri" maxlength="1000" required class="${inputCls}" />
      </label>
      <label class="block text-xs text-slate-500">
        description
        <input name="description" maxlength="1000" class="${inputCls}" />
      </label>
      ${formBtn("Add evidence →")}
    </form>
  </section>`;
}
