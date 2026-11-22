/**
 * EPIC-230 (SLICE-230-5, D-230-11): shared helpers for the
 * /admin/review-center console — queue tabs, status pills, shell.
 * Same dark Tailwind vocabulary as admin-interactions; all
 * agent-supplied values render escaped (hono/html default).
 */

import { html } from "hono/html";

const FB_STATUS_PILL: Record<string, string> = {
  RECEIVED: "bg-amber-900/60 text-amber-300",
  TRIAGED: "bg-sky-900/60 text-sky-300",
  ACCEPTED: "bg-emerald-900/60 text-emerald-300",
  DECLINED: "bg-red-900/60 text-red-300",
  DUPLICATE: "bg-slate-800 text-slate-400",
  CLOSED: "bg-slate-900 text-slate-500",
};

const RV_STATUS_PILL: Record<string, string> = {
  PENDING_TRIAGE: "bg-amber-900/60 text-amber-300",
  IN_REVIEW: "bg-sky-900/60 text-sky-300",
  DECIDED: "bg-emerald-900/60 text-emerald-300",
  DECLINED: "bg-red-900/60 text-red-300",
  REOPENED: "bg-orange-900/60 text-orange-300",
};

export const fbPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${FB_STATUS_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

export const rvPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${RV_STATUS_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

const ACTOR_PILL: Record<string, string> = {
  ANON: "bg-slate-800 text-slate-400",
  API_KEY: "bg-indigo-900/60 text-indigo-300",
  DID: "bg-violet-900/60 text-violet-300",
};

export const rcActorPill = (resolution: string | null) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${ACTOR_PILL[resolution ?? "ANON"] ?? ACTOR_PILL.ANON}"
    >${resolution ?? "ANON"}</span
  >`;

export const VIS_PILL: Record<string, string> = {
  PUBLIC: "bg-emerald-900/40 text-emerald-400",
  INTERNAL: "bg-red-900/40 text-red-400",
};

/** Queue tabs — feedback | reviews (D-230-11). */
export const queueTabs = (active: string, status: string) => {
  const tabs: [string, string][] = [
    ["feedback", `/admin/review-center?queue=feedback&status=${status}`],
    ["reviews", `/admin/review-center?queue=reviews&status=${status}`],
  ];
  return html`<nav class="mb-4 flex flex-wrap gap-2">
    ${tabs.map(
      ([key, href]) =>
        html`<a
          href="${href}"
          class="rounded px-3 py-1 text-sm ${key === active
            ? "bg-emerald-900/50 text-emerald-300"
            : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
          >${key}</a
        >`,
    )}
  </nav>`;
};

export const reviewCenterShell = (title: string, body: unknown) => html`
  <div class="mx-auto max-w-6xl p-4">
    <h1 class="mb-3 text-xl font-semibold text-slate-100">
      Admin · Review Center — ${title}
    </h1>
    <div
      class="mb-3 rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300"
    >
      Agent-supplied content is untrusted — rendered as text only,
      links are not clickable.
    </div>
    ${body}
  </div>
`;

/** Flash vocabulary — query strings carry CODES only (Arc lesson 7:
 *  never free text). The banner translates code → operator message;
 *  unknown codes collapse to a generic string. */
const FLASH_OK_MSG: Record<string, string> = {
  done: "done",
  triaged: "triaged",
  resolved: "resolved",
  closed: "closed",
  claimed: "claimed",
  declined: "declined",
  decided: "decided",
  reopened: "reopened",
  returned: "returned to triage",
  evidence_added: "evidence added",
  converted: "converted to knowledge draft",
};

const FLASH_ERR_MSG: Record<string, string> = {
  operation_failed: "operation failed",
  form_expired_or_duplicate: "form expired or already used — retry",
  bad_operator: "operator id must be [a-z0-9._@-] and not agent-shaped",
  not_found: "record not found",
  status_mismatch: "status changed — refresh and retry",
  illegal_transition: "illegal status transition",
  precondition_required: "missing required field for this transition",
  invalid_decline_reason: "declineReason must be a closed-vocabulary value",
  invalid_patch: "invalid triage fields",
  invalid_decision: "invalid decision payload",
  missing_criteria: "decision must score every platform criterion",
  unknown_criterion: "criterion key not in the platform template",
  duplicate_criterion: "criterion scored twice",
  inconsistent_outcome: "a required FAIL cannot be APPROVED",
  evidence_cap: "evidence cap (50) reached",
  not_editable_in_status: "evidence not editable in this status",
  invalid_uri: "evidence uri refused by the classifier",
  not_available: "knowledge conversion unavailable",
  already_converted: "already converted to a knowledge draft",
  not_convertible_status: "status does not allow knowledge conversion",
  not_assignee: "only the assigned operator may decide this case",
};

export const safeOkCode = (code: string): string =>
  Object.hasOwn(FLASH_OK_MSG, code) ? code : "done";
export const safeErrCode = (code: string): string =>
  Object.hasOwn(FLASH_ERR_MSG, code) ? code : "operation_failed";

export const flashBanner = (c: { ok?: string; err?: string }) => {
  if (c.err) {
    return html`<div
      class="mb-3 rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-300"
      >${FLASH_ERR_MSG[safeErrCode(c.err)]}</div
    >`;
  }
  if (c.ok) {
    return html`<div
      class="mb-3 rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-300"
      >${FLASH_OK_MSG[safeOkCode(c.ok)]}</div
    >`;
  }
  return "";
};

/** Status filter bar inside the active queue tab. */
export const statusBar = (
  queue: string,
  items: readonly string[],
  active: string,
) => html`<div class="mb-3 flex flex-wrap gap-1.5">
  ${items.map(
    (s) =>
      html`<a
        href="/admin/review-center?queue=${queue}&status=${s}"
        class="rounded px-3 py-1 text-xs ${s === active
          ? "bg-emerald-900/50 text-emerald-300"
          : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
        >${s}</a
      >`,
  )}
</div>`;

export const fmtIso = (iso: string | null | undefined): string =>
  iso ? iso.replace("T", " ").slice(0, 19) : "—";
