/**
 * EPIC-229 (SLICE-229-9): shared helpers for the /admin/knowledge
 * console — 228 admin-interactions vocabulary, knowledge-specific
 * pills + shell. hono/html escapes interpolated values — operator-
 * and agent-visible text never goes through raw().
 */

import { html } from "hono/html";

import { mintFormToken } from "../../server/lib/knowledge/form-tokens";

/** Arc R2 H-1: render-minted single-use token — every POST form
 *  carries one; a replayed/double POST is refused at the edge. */
export const tokenField = () =>
  html`<input type="hidden" name="formToken" value="${mintFormToken()}" />`;

/** Arc R2 M-5 + R3 M-5: flash errs carry structured codes, not raw
 *  domain text — anything that isn't a code-shaped token renders as
 *  a generic refusal so a crafted ?err= can't billboard the chrome. */
const capFlash = (s: string) => (s.length > 300 ? `${s.slice(0, 300)}…` : s);
// Arc R4 M-6: `>` widened in — domain codes carry it
// (`invalid_transition:DRAFT->PUBLISHED`) and were collapsing to the
// generic refusal, which hid the actual reason from the operator.
// Escaping happens downstream in hono/html; this gate is only about
// shape, so printable-safe punctuation is fine.
const flashErr = (s: string) =>
  /^[A-Za-z0-9_.:>+-]{1,120}$/.test(s) ? capFlash(s) : "request_refused";
// Same whitelist on the success side — a crafted ?ok=→ PUBLISHED
// used to paint a green false-success banner. Known prefixes get a
// friendlier render; the rest show the code as-is.
const flashOk = (s: string) => {
  if (!/^[A-Za-z0-9_.:-]{1,120}$/.test(s)) return "done";
  if (s.startsWith("transitioned_")) {
    return `→ ${s.slice("transitioned_".length).toUpperCase()}`;
  }
  if (s.startsWith("saved_v") || s.startsWith("restored_v")) {
    return `${s.startsWith("r") ? "Restored" : "Saved"} ${s.slice(s.indexOf("_") + 1)}`;
  }
  return s.replaceAll("_", " ");
};

const STATUS_PILL: Record<string, string> = {
  DRAFT: "bg-slate-800 text-slate-300",
  PENDING: "bg-amber-900/60 text-amber-300",
  VERIFIED: "bg-sky-900/60 text-sky-300",
  PUBLISHED: "bg-emerald-900/60 text-emerald-300",
  WITHDRAWN: "bg-red-900/40 text-red-400",
};

export const statusPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

const GAP_PILL: Record<string, string> = {
  OPEN: "bg-amber-900/60 text-amber-300",
  TRIAGED: "bg-sky-900/60 text-sky-300",
  RESOLVED: "bg-emerald-900/60 text-emerald-300",
  WONTFIX: "bg-slate-800 text-slate-400",
};

export const gapPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${GAP_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

export const knowledgeNav = (active: string) => {
  const links: [string, string, string][] = [
    ["items", "/admin/knowledge", "Items"],
    ["gaps", "/admin/knowledge/gaps", "Gaps"],
  ];
  return html`<nav class="mb-4 flex flex-wrap gap-2">
    ${links.map(
      ([key, href, label]) =>
        html`<a
          href="${href}"
          class="rounded px-3 py-1 text-sm ${key === active
            ? "bg-emerald-900/50 text-emerald-300"
            : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
          >${label}</a
        >`,
    )}
  </nav>`;
};

export const knowledgeShell = (title: string, body: unknown) => html`
  <div class="mx-auto max-w-6xl p-4">
    <h1 class="mb-3 text-xl font-semibold text-slate-100">
      Admin · Knowledge — ${title}
    </h1>
    <div
      class="mb-3 rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300"
    >
      Agent-visible content — preview is always the latest version;
      only PUBLISHED crosses the agent surface.
    </div>
    ${body}
  </div>
`;

export const statusFilterBar = (active: string) => {
  const items = [
    "DRAFT",
    "PENDING",
    "VERIFIED",
    "PUBLISHED",
    "WITHDRAWN",
    "all",
  ];
  return html`<div class="mb-3 flex flex-wrap gap-1.5">
    ${items.map(
      (s) =>
        html`<a
          href="/admin/knowledge?status=${s}"
          class="rounded px-2.5 py-1 text-xs ${s === active
            ? "bg-emerald-900/60 text-emerald-300"
            : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
          >${s}</a
        >`,
    )}
  </div>`;
};

export const flashBanner = (c: { ok?: string; err?: string }) => {
  if (c.err) {
    return html`<div
      class="mb-3 rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-300"
      >${flashErr(c.err)}</div
    >`;
  }
  if (c.ok) {
    return html`<div
      class="mb-3 rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-300"
      >${flashOk(c.ok)}</div
    >`;
  }
  return "";
};

export const sectionTitle = (t: string) => html`<h2
  class="mt-5 mb-2 text-sm font-semibold text-slate-300"
  >${t}</h2
>`;

export const miniForm = (
  action: string,
  fields: unknown,
  submitLabel: string,
) => html`<form method="post" action="${action}" class="mb-2 flex flex-wrap items-end gap-2">
  ${tokenField()}
  ${fields}
  <button
    type="submit"
    class="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-700"
    >${submitLabel}</button
  >
</form>`;

export const textInput = (name: string, placeholder: string, value = "") =>
  html`<input
    type="text"
    name="${name}"
    placeholder="${placeholder}"
    value="${value}"
    class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
  />`;
