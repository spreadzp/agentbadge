/**
 * EPIC-264 (SLICE-264-4): shared chrome for the /admin/operators
 * console — same vocabulary as admin-knowledge (D-229-12): code-shaped
 * flash params only, hono/html escapes everything, single-use form
 * tokens mint at render. The reveal banner is the ONE place an opk_
 * plaintext ever renders — it arrives via an owner-bound single-use
 * server slot, never via a flash param.
 */

import { html } from "hono/html";

import { mintFormToken } from "../../server/lib/knowledge/form-tokens";

export const tokenField = () =>
  html`<input type="hidden" name="formToken" value="${mintFormToken()}" />`;

// Code-shaped flash only — a crafted ?err=/?ok= must not billboard
// the chrome (knowledge console precedent).
const cap = (s: string) => (s.length > 300 ? `${s.slice(0, 300)}…` : s);
const CODE_RE = /^[A-Za-z0-9_.:>+-]{1,120}$/;

export const flashBanner = (c: { ok?: string; err?: string }) => {
  if (c.err) {
    const t = CODE_RE.test(c.err) ? cap(c.err) : "request_refused";
    return html`<div
      class="mb-3 rounded border border-red-800 bg-red-900/40 px-3 py-2 text-sm text-red-300"
      >${t}</div
    >`;
  }
  if (c.ok) {
    const t = CODE_RE.test(c.ok) ? cap(c.ok).replaceAll("_", " ") : "done";
    return html`<div
      class="mb-3 rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-300"
      >${t}</div
    >`;
  }
  return "";
};

/** The ONLY render path for a minted key — copy-now copy is explicit;
 *  the slot is already consumed, so a reload honestly shows nothing. */
export const revealBanner = (plaintext: string | null) =>
  plaintext === null
    ? ""
    : html`<div
        class="mb-3 rounded border border-amber-700 bg-amber-950/60 px-3 py-3"
      >
        <div class="mb-1 text-sm font-semibold text-amber-300">
          New operator key — copy it now. It will never be shown again.
        </div>
        <code
          class="block select-all break-all rounded bg-slate-950 px-2 py-1.5 font-mono text-sm text-amber-200"
          >${plaintext}</code
        >
      </div>`;

const TYPE_PILL: Record<string, string> = {
  human: "bg-emerald-900/60 text-emerald-300",
  service: "bg-sky-900/60 text-sky-300",
  break_glass: "bg-red-900/60 text-red-300",
};

export const typePill = (t: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${TYPE_PILL[t] ?? "bg-slate-800 text-slate-300"}"
    >${t}</span
  >`;

const STATUS_PILL: Record<string, string> = {
  active: "bg-emerald-900/60 text-emerald-300",
  disabled: "bg-red-900/40 text-red-400",
  revoked: "bg-slate-800 text-slate-400",
};

export const statusPill = (s: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[s] ?? "bg-slate-800 text-slate-300"}"
    >${s}</span
  >`;

export const capPills = (caps: string[]) =>
  caps.map(
    (cap) =>
      html`<span
        class="mr-1 inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-300"
        >${cap}</span
      >`,
  );

export const operatorsShell = (body: unknown) => html`
  <div class="mx-auto max-w-6xl p-4">
    <h1 class="mb-3 text-xl font-semibold text-slate-100">
      Admin · Operators
    </h1>
    <div
      class="mb-3 rounded border border-sky-800/60 bg-sky-950/40 px-3 py-2 text-xs text-sky-300"
    >
      Identity comes from the credential — this surface has no
      shared-key access and no x-operator-id. Key material appears
      once, here, then never again.
    </div>
    ${body}
  </div>
`;

export const actionForm = (
  action: string,
  label: string,
  danger = false,
) => html`<form method="post" action="${action}" class="inline">
  ${tokenField()}
  <button
    type="submit"
    class="rounded px-2 py-0.5 text-[11px] ${danger
      ? "bg-red-900/60 text-red-300 hover:bg-red-800"
      : "bg-slate-800 text-slate-300 hover:bg-slate-700"}"
    >${label}</button
  >
</form>`;
