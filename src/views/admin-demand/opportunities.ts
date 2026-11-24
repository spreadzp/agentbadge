/**
 * EPIC-231 (SLICE-231-6): Opportunities tab — lifecycle board
 * (read-only in this slice; transition actions ship with 231-7).
 */

import { html } from "hono/html";

import type { DemandOpportunityRecord } from "../../server/lib/demand/types";
import { DEMAND_OPPORTUNITY_STATUSES } from "../../server/lib/demand/types";
import { emptyMsg, fmtMs, tableShell, td } from "../finops/shared";
import {
  demandFilterBar,
  demandNav,
  demandShell,
  flashBanner,
  oppPill,
} from "./shared";

const row = (o: DemandOpportunityRecord) => {
  const created = Date.parse(o.createdAt);
  return html`<tr>
    ${td(html`<span class="font-mono text-[11px]">${o.clusterId.slice(0, 14)}…</span>`, false)}
    ${td(o.title, false)}
    ${td(oppPill(o.status), false)}
    ${td(o.backlogTaskId ?? "—", false)}
    ${td(o.createdBy, false)}
    ${td(fmtMs(Number.isFinite(created) ? created : null))}
  </tr>`;
};

export function demandOpportunitiesPage(input: {
  rows: DemandOpportunityRecord[];
  status: string;
  flash?: { ok?: string; err?: string };
}): string {
  const body = html`
    ${flashBanner(input.flash ?? {})}
    ${demandFilterBar(input.status, DEMAND_OPPORTUNITY_STATUSES, "/admin/demand/opportunities", "status")}
    ${input.rows.length === 0
      ? emptyMsg("No opportunities yet — «→ Opportunity» on a cluster drafts one.")
      : tableShell(
          ["cluster", "title", "status", "backlog", "created by", "created"],
          html`${input.rows.map(row)}`,
        )}
    <p class="mt-2 text-xs text-slate-500">
      Lifecycle actions (evaluate / accept / link backlog / ship) ship with
      SLICE-231-7 — this board is read-only for now.
    </p>
  `;
  return demandShell(
    "Opportunities",
    html`${demandNav("opportunities")}${body}`,
  ).toString();
}
