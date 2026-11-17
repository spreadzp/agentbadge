/**
 * EPIC-226 / SLICE-226-3 — shared FinOps view helpers.
 * Dark Tailwind palette, consistent with src/views/* fragments.
 * hono/html escapes interpolated values by default.
 */

import { html } from "hono/html";

export const fmtDate = (ms: number): string =>
  new Date(ms).toISOString().replace("T", " ").slice(0, 19) + "Z";

export const fmtMs = (ms: number | null | undefined): string =>
  typeof ms === "number" ? fmtDate(ms) : "—";

const PILL: Record<string, string> = {
  CONFIRMED: "bg-emerald-900/60 text-emerald-300",
  REFUNDED: "bg-violet-900/60 text-violet-300",
  FAILED: "bg-red-900/60 text-red-300",
  EXPIRED: "bg-slate-800 text-slate-400",
  PENDING: "bg-amber-900/60 text-amber-300",
  CREATED: "bg-slate-800 text-slate-300",
  PROCESSING: "bg-amber-900/60 text-amber-300",
  OPEN: "bg-amber-900/60 text-amber-300",
  COMPLETED: "bg-emerald-900/60 text-emerald-300",
  RESOLVED: "bg-emerald-900/60 text-emerald-300",
};

export const statusPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

/** Top nav for the /admin/finance console. */
export const finopsNav = (active: string) => {
  const links: [string, string, string][] = [
    ["payments", "/admin/finance/payments", "Payments"],
    ["exceptions", "/admin/finance/exceptions", "Exceptions"],
    ["reports", "/admin/finance/reports", "Reports"],
    ["audit", "/admin/finance/audit", "Audit"],
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

export const finopsShell = (active: string, body: unknown) => html`
  <div class="mx-auto max-w-6xl p-4">
    <h1 class="mb-3 text-xl font-semibold text-slate-100">
      Admin · Finance
    </h1>
    ${finopsNav(active)} ${body}
  </div>
`;

export const emptyMsg = (msg: string) =>
  html`<div
    class="rounded-lg border border-slate-800 bg-slate-900 p-6 text-center text-sm text-slate-500"
    >${msg}</div
  >`;

export const kv = (label: string, value: unknown) =>
  html`<div class="flex gap-2 text-sm">
    <span class="w-36 shrink-0 text-slate-500">${label}</span>
    <span class="break-all font-mono text-slate-200">${String(value ?? "—")}</span>
  </div>`;

/** Small labelled input for admin forms (operator/evidence/…). */
export const field = (
  name: string,
  label: string,
  opts: { required?: boolean; placeholder?: string; type?: string } = {},
) => html`<label class="block text-xs text-slate-500">
    ${label}${opts.required ? html`<span class="text-red-400"> *</span>` : ""}
    <input
      name="${name}"
      type="${opts.type ?? "text"}"
      ${opts.required ? html`required` : ""}
      placeholder="${opts.placeholder ?? ""}"
      class="mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200"
    />
  </label>`;

export const submitBtn = (label: string) =>
  html`<button
    type="submit"
    class="rounded bg-emerald-700 px-3 py-1 text-xs font-medium text-emerald-50 hover:bg-emerald-600"
    >${label}</button
  >`;

/** HTMX result slot — handlers target it with a status fragment. */
export const resultSlot = (id: string) =>
  html`<div id="${id}" class="mt-2 text-xs"></div>`;

export const okMsg = (text: string) =>
  html`<div
    class="rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-emerald-300"
    >${text}</div
  >`;

export const errMsg = (text: string) =>
  html`<div
    class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-red-300"
    >${text}</div
  >`;

export const th = (t: string) =>
  html`<th
    class="px-2 py-1.5 text-left text-[11px] font-medium uppercase tracking-wide text-slate-500"
    >${t}</th
  >`;

export const td = (content: unknown, mono = true) =>
  html`<td
    class="px-2 py-1.5 text-sm ${mono
      ? "font-mono text-slate-300"
      : "text-slate-300"}"
    >${content}</td
  >`;

export const tableShell = (head: string[], body: unknown) => html`
  <div class="overflow-x-auto rounded-lg border border-slate-800">
    <table class="min-w-full divide-y divide-slate-800 bg-slate-900">
      <thead class="bg-slate-950/60">
        <tr>${head.map((h) => th(h))}</tr>
      </thead>
      <tbody class="divide-y divide-slate-800">${body}</tbody>
    </table>
  </div>
`;
