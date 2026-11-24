/**
 * EPIC-264 (SLICE-264-4): operators console — identity + credential
 * table with inline lifecycle actions. Pure SSR fragment; all cells
 * escaped by hono/html. Credential cells show prefix/status/dates —
 * NEVER keyHash or plaintext (plaintext renders only via the
 * owner-bound reveal banner in shared.ts).
 */

import { html } from "hono/html";

import type {
  AdminOperator,
  AdminOperatorCredential,
} from "../../server/lib/operators";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  actionForm,
  capPills,
  flashBanner,
  operatorsShell,
  revealBanner,
  statusPill,
  tokenField,
  typePill,
} from "./shared";

export interface OperatorRow {
  operator: AdminOperator;
  credentials: AdminOperatorCredential[];
}

const credLine = (o: AdminOperator, cred: AdminOperatorCredential) => html`
  <div class="mb-1 flex flex-wrap items-center gap-1.5">
    <code class="font-mono text-xs text-slate-400">${cred.keyPrefix}…</code>
    ${statusPill(cred.status)}
    <span class="text-[11px] text-slate-500"
      >issued ${fmtMs(Date.parse(cred.issuedAt) || null)} · used
      ${cred.lastUsedAt ? fmtMs(Date.parse(cred.lastUsedAt)) : "never"}</span
    >
    ${cred.status === "active"
      ? html`${o.status === "active"
          ? actionForm(
              `/admin/operators/${o.id}/credentials/${cred.id}/rotate`,
              "rotate",
            )
          : ""}${actionForm(
          `/admin/operators/${o.id}/credentials/${cred.id}/revoke`,
          "revoke",
          true,
        )}`
      : ""}
  </div>
`;

const row = (r: OperatorRow) => {
  const o = r.operator;
  return html`<tr>
    ${td(html`<div>
      <div class="text-slate-200">${o.displayName}</div>
      <div class="text-[11px] text-slate-500">${o.id}</div>
    </div>`, false)}
    ${td(typePill(o.principalType), false)}
    ${td(statusPill(o.status), false)}
    ${td(capPills(o.capabilities), false)}
    ${td(
      r.credentials.length === 0
        ? html`<span class="text-slate-600">—</span>`
        : html`${r.credentials.map((cred) => credLine(o, cred))}`,
      false,
    )}
    ${td(
      o.status === "active"
        ? html`${actionForm(
            `/admin/operators/${o.id}/credentials`,
            "issue key",
          )}${actionForm(
            `/admin/operators/${o.id}/disable`,
            "disable",
            true,
          )}`
        : actionForm(`/admin/operators/${o.id}/enable`, "enable"),
      false,
    )}
  </tr>`;
};

const createForm = (caps: readonly string[], types: readonly string[]) => html`
  <form method="post" action="/admin/operators/create" class="flex flex-col gap-2">
    ${tokenField()}
    <div class="flex flex-wrap items-end gap-2">
      <input
        type="text"
        name="displayName"
        placeholder="display name (a-z0-9._@-)"
        required
        class="w-64 rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      />
      <select
        name="principalType"
        class="rounded border border-slate-700 bg-slate-900 px-2 py-1 text-xs text-slate-200"
      >
        ${types.map((t) => html`<option value="${t}">${t}</option>`)}
      </select>
      <button
        type="submit"
        class="rounded bg-emerald-800 px-3 py-1 text-xs text-emerald-100 hover:bg-emerald-700"
        >Create operator</button
      >
    </div>
    <div class="flex flex-wrap gap-3 text-xs text-slate-400">
      ${caps.map(
        (cap) => html`<label class="flex items-center gap-1">
          <input type="checkbox" name="cap_${cap}" ${cap === "read" || cap === "workflow" ? "checked" : ""} />
          ${cap}
        </label>`,
      )}
      <span class="text-slate-600">(none checked → read+workflow)</span>
    </div>
  </form>
`;

export function operatorsPage(input: {
  rows: OperatorRow[];
  capabilities: readonly string[];
  principalTypes: readonly string[];
  reveal: string | null;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${flashBanner(input.flash ?? {})} ${revealBanner(input.reveal)}
    ${input.rows.length === 0
      ? emptyMsg("No operators — create the first below.")
      : tableShell(
          ["operator", "type", "status", "capabilities", "credentials", "actions"],
          html`${input.rows.map(row)}`,
        )}
    <div class="mt-5 rounded border border-slate-800 bg-slate-950/60 p-3">
      <h2 class="mb-2 text-sm font-semibold text-slate-300">
        Create operator
      </h2>
      ${createForm(input.capabilities, input.principalTypes)}
    </div>
  `;
  return operatorsShell(body).toString();
}
