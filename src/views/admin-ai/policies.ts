/**
 * EPIC-232 (SLICE-232-8, E8): /admin/ai — automation policies.
 * Per-scenario declared/effective modes, threshold + model override
 * controls, kill-switch, and the append-only PolicyChange audit
 * stream (no edit/delete — audit rows render read-only by design).
 */

import { html } from "hono/html";

import type { BudgetState } from "../../server/lib/ai/budget";
import type { PolicyChangeRecord } from "../../server/lib/ai/types";

const inputCls =
  "mt-0.5 w-full rounded border border-slate-700 bg-slate-900 px-2 py-1 text-sm text-slate-200";
const th =
  "px-2 py-1.5 text-left text-[11px] font-semibold uppercase text-slate-500";
const td = "px-2 py-1.5 align-top text-xs text-slate-300";

export interface AiPolicyRow {
  scenario: string;
  mode: string;
  confidenceThreshold: number | null;
  model: string | null;
  updatedBy: string | null;
  effective: string;
}

const sel = (
  name: string,
  options: readonly string[],
  current: string,
) => html`<select name="${name}" class="${inputCls}">
  ${options.map(
    (o) =>
      html`<option value="${o}" ${o === current ? "selected" : ""}>
        ${o}
      </option>`,
  )}
</select>`;

const effChip = (effective: string, mode: string) =>
  html`<span
    class="rounded px-1.5 py-0.5 text-[11px] ${effective === "off"
      ? "bg-slate-800 text-slate-400"
      : effective !== mode
        ? "bg-amber-900/50 text-amber-300"
        : "bg-emerald-900/50 text-emerald-300"}"
    >${effective}</span>`;

const flashBox = (f: { ok?: string; err?: string }) =>
  f.err
    ? html`<div class="mb-3 rounded border border-red-900 bg-red-950/40 px-3 py-2 text-sm text-red-300">
        ${f.err}
      </div>`
    : f.ok
      ? html`<div class="mb-3 rounded border border-emerald-900 bg-emerald-950/40 px-3 py-2 text-sm text-emerald-300">
          ${f.ok}
        </div>`
      : "";

const envStrip = (opts: {
  enabled: boolean;
  budget: BudgetState;
  limits: { dailyCallLimit: number; monthlyBudgetUsd: number } | null;
}) => html`<section
  class="mb-4 rounded-lg border border-slate-800 bg-slate-900 p-3 text-xs text-slate-300"
>
  <div class="flex flex-wrap gap-x-4 gap-y-1">
    <span
      >master kill
      (AI_AUTOMATION_ENABLED):
      <strong class="${opts.enabled ? "text-emerald-300" : "text-red-300"}"
        >${opts.enabled ? "enabled" : "OFF"}</strong
      ></span
    >
    <span
      >budget:
      <strong class="${opts.budget.state === "ok" ? "text-emerald-300" : "text-amber-300"}"
        >${opts.budget.state}</strong
      >
      — ${opts.budget.dailyCalls} calls today,
      ~$${opts.budget.monthlyUsdEstimate.toFixed(4)} this month</span
    >
    ${opts.limits
      ? html`<span class="text-slate-500"
          >limits: ${opts.limits.dailyCallLimit || "∞"} calls/day,
          $${opts.limits.monthlyBudgetUsd || "∞"}/mo</span
        >`
      : ""}
  </div>
</section>`;

function policyRow(r: AiPolicyRow, modes: readonly string[], token: string) {
  return html`<tr class="border-t border-slate-800">
    <td class="${td} font-mono">${r.scenario}</td>
    <td class="${td}">
      <form
        method="post"
        action="/admin/ai/policies/${r.scenario}"
        class="space-y-1.5"
      >
        <input type="hidden" name="formToken" value="${token}" />
        ${sel("mode", modes, r.mode)}
        <input
          name="confidenceThreshold"
          value="${r.confidenceThreshold ?? ""}"
          placeholder="threshold 0..1 (empty keep · clear)"
          class="${inputCls}"
        />
        <input
          name="model"
          value="${r.model ?? ""}"
          placeholder="model override (empty keep · clear)"
          maxlength="64"
          class="${inputCls}"
        />
        <input
          name="reason"
          placeholder="reason (audit)"
          maxlength="200"
          class="${inputCls}"
        />
        <button
          type="submit"
          class="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-700"
        >
          Save
        </button>
      </form>
    </td>
    <td class="${td}">${effChip(r.effective, r.mode)}</td>
    <td class="${td} text-slate-500">${r.updatedBy ?? "—"}</td>
    <td class="${td}">
      ${r.mode !== "off"
        ? html`<form method="post" action="/admin/ai/policies/${r.scenario}/kill">
            <input type="hidden" name="formToken" value="${token}" />
            <button
              type="submit"
              class="rounded bg-red-900 px-3 py-1 text-xs text-red-200 hover:bg-red-800"
            >
              Kill → off
            </button>
          </form>`
        : ""}
    </td>
  </tr>`;
}

const auditTable = (changes: PolicyChangeRecord[]) =>
  html`<section
    class="mt-4 rounded-lg border border-slate-800 bg-slate-900 p-3"
  >
    <h3 class="mb-2 text-xs font-semibold uppercase text-slate-500">
      PolicyChange audit (append-only, latest 100)
    </h3>
    ${changes.length === 0
      ? html`<p class="text-xs text-slate-600">no changes yet</p>`
      : html`<table class="w-full border-collapse">
          <thead>
            <tr>
              <th class="${th}">time</th>
              <th class="${th}">scenario</th>
              <th class="${th}">field</th>
              <th class="${th}">old → new</th>
              <th class="${th}">actor</th>
              <th class="${th}">reason</th>
            </tr>
          </thead>
          <tbody>
            ${changes.map(
              (ch) => html`<tr class="border-t border-slate-800">
                <td class="${td} font-mono text-slate-500">${ch.createdAt.slice(0, 19)}</td>
                <td class="${td}">${ch.scenario}</td>
                <td class="${td}">${ch.field}</td>
                <td class="${td} font-mono"
                  >${ch.oldValue ?? "—"} → ${ch.newValue ?? "—"}</td
                >
                <td class="${td} ${ch.actor === "budget-guard" ? "text-amber-400" : ""}"
                  >${ch.actor}</td
                >
                <td class="${td} text-slate-500">${ch.reason ?? "—"}</td>
              </tr>`,
            )}
          </tbody>
        </table>`}
  </section>`;

export function adminAiPage(opts: {
  rows: AiPolicyRow[];
  changes: PolicyChangeRecord[];
  enabled: boolean;
  budget: BudgetState;
  limits: { dailyCallLimit: number; monthlyBudgetUsd: number } | null;
  modes: readonly string[];
  formToken: string;
  flash: { ok?: string; err?: string };
}) {
  return html`
    <h2 class="mb-3 text-lg font-semibold text-slate-200">
      AI automation policies
    </h2>
    ${flashBox(opts.flash)} ${envStrip(opts)}
    <section class="rounded-lg border border-slate-800 bg-slate-900 p-3">
      <p class="mb-2 text-xs text-slate-500">
        Declared mode vs effective (env kill + budget gates apply at
        the worker tick — no redeploy needed). Missing rows resolve
        to <code>off</code>.
      </p>
      <table class="w-full border-collapse">
        <thead>
          <tr>
            <th class="${th}">scenario</th>
            <th class="${th}">controls</th>
            <th class="${th}">effective</th>
            <th class="${th}">updated by</th>
            <th class="${th}">kill</th>
          </tr>
        </thead>
        <tbody>
          ${opts.rows.map((r) => policyRow(r, opts.modes, opts.formToken))}
        </tbody>
      </table>
    </section>
    ${auditTable(opts.changes)}
  `;
}
