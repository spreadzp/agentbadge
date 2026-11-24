/**
 * EPIC-264 (SLICE-264-12): gaps console pages —
 *   GET /admin/knowledge/gaps       → managed backlog: overdue-first
 *                                    sort, owner column, unassigned
 *                                    pool filter, per-row assign forms
 *   GET /admin/knowledge/gaps/:id   → gap detail: audit feed + the
 *                                    due-change form (reason, C3)
 *
 * Split out of admin-knowledge-ui.ts (300-line cap) — the routes
 * mount INSIDE the family's auth/cap/origin middleware (registered
 * from createAdminKnowledgeUi).
 */

import type { Hono } from "hono";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import type { KnowledgeStore } from "../lib/knowledge/store";
import type { OperatorStore } from "../lib/operators/store";
import { KNOWLEDGE_GAP_STATUSES, listGaps } from "../lib/knowledge";
import { rejectCtrl } from "./admin-operator-guard";
import { page } from "./admin-knowledge-ui";
import { knowledgeGapsPage } from "../../views/admin-knowledge/gaps";
import { knowledgeGapDetailPage } from "../../views/admin-knowledge/gap-detail";

/** 264-14: the header band's timeToClear window — matches the
 *  JSON digest default. */
const METRICS_WINDOW_DAYS = 30;

export function registerKnowledgeUiGapPages(
  app: Hono,
  store: KnowledgeStore,
  operatorStore: OperatorStore,
): void {
  app.get("/admin/knowledge/gaps", async (c) => {
    const status = c.req.query("status") ?? "OPEN";
    // Arc R1 M8: unvalidated ?status= reached the PG driver → 500
    // on %00 etc. Same enum + "all" contract as the JSON API.
    if (
      status !== "all" &&
      !KNOWLEDGE_GAP_STATUSES.includes(status as never)
    ) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "bad status");
    }
    // Arc R3 M-9: ?offset= paging — a fixed limit-200 hid the tail
    // of a capped 2000-row backlog from triage entirely.
    // Arc R4 M-9: floor — ?offset=1.5 otherwise binds a non-integer
    // to the int4 param and 500s on PG.
    const offset = Math.max(
      0,
      Math.min(100000, Math.floor(Number(c.req.query("offset") ?? 0)) || 0),
    );
    // 264-12: the console manages work — overdue-first is the
    // default order (SQL-derived so paging can't hide past-due
    // rows); ?assigned=none is the unassigned pick-up pool.
    // 264-14 review: ?overdue=1 gates to the live-overdue set —
    // the metrics band's drill-down (carry status=all so TRIAGED
    // overdue isn't dropped by the default status filter). The 4
    // reads are independent — Promise.all (was serialized RTs).
    const assigned = c.req.query("assigned");
    const overdueOnly = c.req.query("overdue") === "1";
    const [gaps, items, humans, metrics] = await Promise.all([
      listGaps(store, {
        status: status === "all" ? undefined : status,
        sort: "overdue",
        unassigned: assigned === "none",
        overdueOnly,
        limit: 200,
        offset,
      }),
      store.listItems({ limit: 200 }),
      // Assignee display + the select list: ACTIVE humans only —
      // service/break_glass principals can't own backlog work
      // (D-264-Q8) so offering them would mint guaranteed
      // refusals.
      operatorStore.listOperators({
        principalType: "human",
        status: "active",
      }),
      // 264-14: the header band — same 30d default as the JSON
      // digest; page render is a read (no auth extra).
      store.gapMetrics({
        now: new Date().toISOString(),
        resolvedSince: new Date(
          Date.now() - METRICS_WINDOW_DAYS * 86_400_000,
        ).toISOString(),
      }),
    ]);
    const displayById: Record<string, string> = {};
    for (const o of humans) displayById[o.id] = o.displayName;
    return page(
      c,
      knowledgeGapsPage({
        gaps,
        status,
        items,
        metrics,
        metricsWindowDays: METRICS_WINDOW_DAYS,
        offset,
        operators: humans.map((o) => ({
          id: o.id,
          displayName: o.displayName,
        })),
        displayById,
        // PRG target for the row forms — the filtered view they
        // were rendered on (mutation lands back here).
        next: `/admin/knowledge/gaps?status=${status}${assigned === "none" ? "&assigned=none" : ""}${overdueOnly ? "&overdue=1" : ""}${offset > 0 ? `&offset=${offset}` : ""}`,
        assigned: assigned === "none" ? "none" : "",
        overdue: overdueOnly ? "1" : "",
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Gaps",
    );
  });

  // Gap detail — the persisted audit feed (previousAssignee chain
  // reads row-by-row) + assignment/due forms.
  app.get("/admin/knowledge/gaps/:id", async (c) => {
    const id = c.req.param("id") ?? "";
    const ctrlBad = rejectCtrl(c, id);
    if (ctrlBad) return ctrlBad;
    const gap = await store.getGap(id);
    if (!gap) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "no such gap",
      );
    }
    const [events, humans, items] = await Promise.all([
      store.listGapEvents(id),
      operatorStore.listOperators({ principalType: "human", status: "active" }),
      store.listItems({ limit: 200 }),
    ]);
    const displayById: Record<string, string> = {};
    for (const o of humans) displayById[o.id] = o.displayName;
    return page(
      c,
      knowledgeGapDetailPage({
        gap,
        events,
        operators: humans.map((o) => ({
          id: o.id,
          displayName: o.displayName,
        })),
        displayById,
        items,
        flash: { ok: c.req.query("ok"), err: c.req.query("err") },
      }),
      "Gap detail",
    );
  });
}
