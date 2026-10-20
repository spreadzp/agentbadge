/**
 * SLICE-198-1: ops taskboard routes.
 *   GET /ops/board          — SSR kanban over Backlog.md tasks
 *   GET /api/ops/board.json — same snapshot as JSON
 * Read-only by design → public (agents fetch JSON, humans view HTML).
 * Mounted only when OPS_BOARD_DIR is set — see ops.ts.
 * HTML page is wrapped in the shared site Layout (header + sidebar + footer).
 */

import { Hono } from "hono";
import {
  createBoardStore,
  filterTasks,
  sortTasks,
  type BoardFilters,
  type BoardSort,
} from "../lib/ops-board/store";
import { renderOpsBoard } from "../../views/ops-board";
import { Layout } from "../../views/layout";

const SORTS: ReadonlySet<string> = new Set([
  "priority",
  "updated",
  "budget_asc",
  "budget_desc",
]);

function numParam(v: string | undefined): number | undefined {
  if (v == null || v === "") return undefined;
  const n = Number(v);
  return Number.isFinite(n) ? n : undefined;
}

export function createOpsBoardRoutes(opts: {
  dir: string;
  cacheMs?: number;
}): Hono {
  const routes = new Hono();
  const store = createBoardStore(opts.dir, opts.cacheMs ?? 30_000);

  const parseFilters = (q: URLSearchParams): BoardFilters => ({
    status: q.get("status") || undefined,
    label: q.get("label") || undefined,
    milestone: q.get("milestone") || undefined,
    epic: q.get("epic") || undefined,
    assignee: q.get("assignee") || undefined,
    q: q.get("q") || undefined,
    me: q.get("me") || undefined,
    budgetMin: numParam(q.get("budget_min") ?? undefined),
    budgetMax: numParam(q.get("budget_max") ?? undefined),
  });

  routes.get("/ops/board", async (c) => {
    const url = new URL(c.req.url);
    const filters = parseFilters(url.searchParams);
    const sortParam = url.searchParams.get("sort") ?? "priority";
    const sort = (SORTS.has(sortParam) ? sortParam : "priority") as BoardSort;
    const data = await store.getBoard();
    const tasks = sortTasks(filterTasks(data.tasks, filters), sort);
    const body = renderOpsBoard({ data, tasks, filters, sort }).toString();
    return c.html(
      Layout(
        body,
        "Ops Board",
        { path: "/ops/board", description: "Ops taskboard — Backlog.md kanban" },
        [],
        true,
      ),
    );
  });

  routes.get("/api/ops/board.json", async (c) => {
    const url = new URL(c.req.url);
    const filters = parseFilters(url.searchParams);
    const sortParam = url.searchParams.get("sort") ?? "priority";
    const sort = (SORTS.has(sortParam) ? sortParam : "priority") as BoardSort;
    const data = await store.getBoard();
    return c.json({
      scannedAt: data.scannedAt,
      skipped: data.skipped,
      statuses: data.statuses,
      labels: data.labels,
      milestones: data.milestones,
      epicStats: data.epicStats,
      total: data.tasks.length,
      tasks: sortTasks(filterTasks(data.tasks, filters), sort),
    });
  });

  return routes;
}
