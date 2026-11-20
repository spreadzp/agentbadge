/**
 * EPIC-228 (SLICE-228-5): shared helpers for the /admin/interactions
 * console — same dark Tailwind vocabulary as views/finops (helpers
 * are imported from there; this file only adds interaction-specific
 * pills + the shell). hono/html escapes interpolated values —
 * agent-supplied text never goes through raw().
 */

import { html } from "hono/html";

const STATUS_PILL: Record<string, string> = {
  PENDING_REVIEW: "bg-amber-900/60 text-amber-300",
  IN_REVIEW: "bg-sky-900/60 text-sky-300",
  ANSWERED: "bg-emerald-900/60 text-emerald-300",
  REJECTED: "bg-red-900/60 text-red-300",
};

export const interactionPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${STATUS_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

const ACTOR_PILL: Record<string, string> = {
  ANON: "bg-slate-800 text-slate-400",
  API_KEY: "bg-indigo-900/60 text-indigo-300",
  DID: "bg-violet-900/60 text-violet-300",
};

export const actorPill = (resolution: string | null) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${ACTOR_PILL[resolution ?? "ANON"] ?? ACTOR_PILL.ANON}"
    >${resolution ?? "ANON"}</span
  >`;

export const VIS_PILL: Record<string, string> = {
  PUBLIC: "bg-emerald-900/40 text-emerald-400",
  INTERNAL: "bg-red-900/40 text-red-400",
};

export const interactionNav = (active: string) => {
  const links: [string, string, string][] = [
    ["inbox", "/admin/interactions", "Inbox"],
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

export const interactionShell = (title: string, body: unknown) => html`
  <div class="mx-auto max-w-6xl p-4">
    <h1 class="mb-3 text-xl font-semibold text-slate-100">
      Admin · Interactions — ${title}
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

/** Status filter pills for the inbox toolbar. */
export const statusFilterBar = (active: string) => {
  const items = ["PENDING_REVIEW", "IN_REVIEW", "ANSWERED", "REJECTED", "all"];
  return html`<div class="mb-3 flex flex-wrap gap-1.5">
    ${items.map(
      (s) =>
        html`<a
          href="/admin/interactions?status=${s}"
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
      >${c.err}</div
    >`;
  }
  if (c.ok) {
    return html`<div
      class="mb-3 rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-sm text-emerald-300"
      >${c.ok}</div
    >`;
  }
  return "";
};
