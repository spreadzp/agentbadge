/**
 * EPIC-231 (SLICE-231-6): shared helpers for the /admin/demand
 * console — demand-specific pills/nav/shell over the admin-knowledge
 * vocabulary (228/229 console conventions). Generic pieces
 * (tokenField, flashBanner, miniForm, textInput) are re-exported
 * from the knowledge shared module — single implementation.
 */

import { html } from "hono/html";

export {
  flashBanner,
  miniForm,
  textInput,
  tokenField,
} from "../admin-knowledge/shared";

const LEVEL_PILL: Record<string, string> = {
  INTEREST: "bg-slate-800 text-slate-300",
  NEED: "bg-sky-900/60 text-sky-300",
  INTENT: "bg-amber-900/60 text-amber-300",
  PURCHASE_INTENT: "bg-violet-900/60 text-violet-300",
  VERIFIED_DEMAND: "bg-emerald-900/60 text-emerald-300",
};

export const levelPill = (level: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${LEVEL_PILL[level] ?? "bg-slate-800 text-slate-300"}"
    >${level}</span
  >`;

const CLUSTER_PILL: Record<string, string> = {
  OPEN: "bg-amber-900/60 text-amber-300",
  TRIAGED: "bg-sky-900/60 text-sky-300",
  LINKED: "bg-emerald-900/60 text-emerald-300",
  DISMISSED: "bg-slate-800 text-slate-400",
};

export const clusterPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${CLUSTER_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

const OPP_PILL: Record<string, string> = {
  PROPOSED: "bg-amber-900/60 text-amber-300",
  EVALUATING: "bg-sky-900/60 text-sky-300",
  ACCEPTED: "bg-emerald-900/60 text-emerald-300",
  DECLINED: "bg-slate-800 text-slate-400",
  LINKED: "bg-emerald-900/60 text-emerald-300",
  SHIPPED: "bg-emerald-800 text-emerald-200",
  CLOSED: "bg-slate-800 text-slate-400",
};

export const oppPill = (status: string) =>
  html`<span
    class="inline-block rounded px-1.5 py-0.5 text-[11px] font-medium ${OPP_PILL[status] ?? "bg-slate-800 text-slate-300"}"
    >${status}</span
  >`;

export const sourceBadge = (source: string) =>
  html`<span class="inline-block rounded bg-slate-800 px-1.5 py-0.5 text-[11px] text-slate-400"
    >${source}</span
  >`;

export const demandNav = (active: string) => {
  const links: [string, string, string][] = [
    ["clusters", "/admin/demand", "Clusters"],
    ["signals", "/admin/demand/signals", "Signals"],
    ["opportunities", "/admin/demand/opportunities", "Opportunities"],
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

export const demandShell = (title: string, body: unknown) => html`
  <div class="mx-auto max-w-6xl p-4">
    <h1 class="mb-3 text-xl font-semibold text-slate-100">
      Admin · Demand — ${title}
    </h1>
    <div
      class="mb-3 rounded border border-amber-800/60 bg-amber-950/40 px-3 py-2 text-xs text-amber-300"
    >
      Internal surface — actor references and dedupe keys visible here
      never leave the admin console (D-228-8).
    </div>
    ${body}
  </div>
`;

export const demandFilterBar = (
  active: string,
  items: readonly string[],
  base: string,
  param: string,
  extra = "",
) => html`<div class="mb-3 flex flex-wrap gap-1.5">
  ${["all", ...items].map(
    (s) =>
      html`<a
        href="${base}?${param}=${s}${extra}"
        class="rounded px-2.5 py-1 text-xs ${s === active
          ? "bg-emerald-900/60 text-emerald-300"
          : "bg-slate-800 text-slate-400 hover:text-slate-200"}"
        >${s}</a
      >`,
  )}
</div>`;
