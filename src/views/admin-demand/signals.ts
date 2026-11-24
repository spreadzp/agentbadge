/**
 * EPIC-231 (SLICE-231-6): Signals tab — the internal feed
 * (source / declared→effective level / category·feature / actor)
 * with an inline re-tag form per canonical row. Related burst rows
 * render read-only — retag acts on canonicals (store refusal).
 */

import { html } from "hono/html";

import type { DemandSignalRecord } from "../../server/lib/demand/types";
import {
  DEMAND_LEVELS,
  DEMAND_SOURCES,
} from "../../server/lib/demand/types";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  demandFilterBar,
  demandNav,
  demandShell,
  flashBanner,
  levelPill,
  sourceBadge,
  tokenField,
} from "./shared";

const excerpt = (s: string, n = 80) =>
  s.length > n ? `${s.slice(0, n)}…` : s;

const retagForm = (s: DemandSignalRecord) => {
  if (s.relatedSignalId !== null) {
    return html`<span class="text-[11px] text-slate-600"
      >linked → ${s.relatedSignalId}</span
    >`;
  }
  return html`<form
      method="post"
      action="/admin/demand/signals/${s.id}/retag"
      class="flex flex-wrap items-center gap-1"
    >
      ${tokenField()}
      <input
        type="text"
        name="category"
        placeholder="category"
        value="${s.category ?? ""}"
        class="w-24 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      />
      <input
        type="text"
        name="feature"
        placeholder="feature"
        value="${s.feature ?? ""}"
        class="w-24 rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[11px] text-slate-200"
      />
      <button
        type="submit"
        class="rounded bg-sky-800 px-2 py-0.5 text-[11px] text-sky-100 hover:bg-sky-700"
        >re-tag</button
      >
    </form>`;
};

const row = (s: DemandSignalRecord) => {
  const created = Date.parse(s.createdAt);
  return html`<tr>
    ${td(html`<span class="font-mono text-[11px]" title="${s.id}">${s.id.slice(0, 14)}…</span>`, false)}
    ${td(html`<span title="${s.normalizedText}">${excerpt(s.normalizedText)}</span>`, false)}
    ${td(sourceBadge(s.source), false)}
    ${td(`${s.declaredLevel} → `, false)}
    ${td(levelPill(s.level), false)}
    ${td(s.category ?? "—", false)}
    ${td(s.feature ?? "—", false)}
    ${td(
      html`<span title="${s.actorRef ?? "unattributed"}">${s.actorResolution}</span>`,
      false,
    )}
    ${td(String(s.relatedCount))}
    ${td(fmtMs(Number.isFinite(created) ? created : null))}
    ${td(retagForm(s), false)}
  </tr>`;
};

export function demandSignalsPage(input: {
  rows: DemandSignalRecord[];
  source: string;
  level: string;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${flashBanner(input.flash ?? {})}
    ${demandFilterBar(input.source, DEMAND_SOURCES, "/admin/demand/signals", "source")}
    ${demandFilterBar(input.level, DEMAND_LEVELS, "/admin/demand/signals", "level")}
    ${input.rows.length === 0
      ? emptyMsg("No demand signals at this filter.")
      : tableShell(
          [
            "id",
            "text",
            "source",
            "",
            "level",
            "category",
            "feature",
            "actor",
            "repeats",
            "created",
            "re-tag",
          ],
          html`${input.rows.map(row)}`,
        )}
  `;
  return demandShell(
    "Signals",
    html`${demandNav("signals")}${body}`,
  ).toString();
}
