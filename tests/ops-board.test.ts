/**
 * SLICE-198-1: ops taskboard — store unit + route e2e over mock backlog.
 *
 * Fixtures: tests/fixtures/ops-board/tasks/*.md (5 tasks across
 * Draft/To Do/In Progress/Done, labels epic-163/171/192/ops, budgets
 * on three tasks, one XSS title, one broken file → skipped++).
 * `me` param marks "my" tasks (assignee/labels/id substring match) —
 * public read-only, no auth.
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { Hono } from "hono";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import {
  createBoardStore,
  filterTasks,
  isMineTask,
  scanBoard,
  sortTasks,
} from "../src/server/lib/ops-board/store";
import { createOpsBoardRoutes } from "../src/server/routes/ops-board";

const FIXTURE = join(
  dirname(fileURLToPath(import.meta.url)),
  "fixtures/ops-board",
);

function app(): Hono {
  const a = new Hono();
  a.route("/", createOpsBoardRoutes({ dir: FIXTURE, cacheMs: 60_000 }));
  return a;
}

function get(url: string) {
  return app().fetch(new Request(`http://x${url}`));
}

describe("scanBoard", () => {
  it("parses frontmatter, skips broken files", async () => {
    const d = await scanBoard(FIXTURE);
    expect(d.tasks).toHaveLength(5);
    expect(d.skipped).toBe(1);
    expect(d.statuses).toEqual(["Draft", "To Do", "In Progress", "Done"]);
    expect(d.labels).toContain("epic-163");
    expect(d.milestones).toEqual(["m1-signals", "m2-yield"]);
    const e163 = d.epicStats.find((e) => e.epic === "epic-163");
    const e192 = d.epicStats.find((e) => e.epic === "epic-192");
    expect(e163).toEqual({ epic: "epic-163", total: 2, done: 0 });
    expect(e192).toEqual({ epic: "epic-192", total: 1, done: 1 });
  });

  it("returns empty board for missing tasks dir", async () => {
    const d = await scanBoard("/nonexistent");
    expect(d.tasks).toEqual([]);
    expect(d.skipped).toBe(0);
  });
});

describe("filterTasks / sortTasks", () => {
  it("filters by status, label, epic, milestone, assignee, q", async () => {
    const { tasks } = await scanBoard(FIXTURE);
    expect(filterTasks(tasks, { status: "To Do" })).toHaveLength(2);
    expect(filterTasks(tasks, { label: "security" })).toHaveLength(1);
    expect(filterTasks(tasks, { epic: "epic-163" })).toHaveLength(2);
    expect(filterTasks(tasks, { milestone: "m2-yield" })).toHaveLength(1);
    expect(filterTasks(tasks, { assignee: "dev" })).toHaveLength(2);
    expect(filterTasks(tasks, { q: "payer" })).toHaveLength(1);
    expect(filterTasks(tasks, { q: "MYPROJ-3" })).toHaveLength(1);
    expect(filterTasks(tasks, {})).toHaveLength(5);
  });

  it("filters by budget range; tasks without budget are excluded", async () => {
    const { tasks } = await scanBoard(FIXTURE);
    expect(filterTasks(tasks, { budgetMin: 100 })).toHaveLength(2);
    expect(filterTasks(tasks, { budgetMax: 100 })).toHaveLength(1);
    expect(filterTasks(tasks, { budgetMin: 80, budgetMax: 200 })).toHaveLength(
      2,
    );
  });

  it("sorts by priority, updated, budget asc/desc", async () => {
    const { tasks } = await scanBoard(FIXTURE);
    const pri = sortTasks(tasks, "priority").map((t) => t.id);
    expect(pri[0]).toBe("MYPROJ-5");
    expect(pri[1]).toBe("MYPROJ-1");
    expect(pri.at(-1)).toBe("MYPROJ-4");
    const upd = sortTasks(tasks, "updated").map((t) => t.id);
    expect(upd[0]).toBe("MYPROJ-5");
    const bDesc = sortTasks(tasks, "budget_desc")
      .filter((t) => t.budget != null)
      .map((t) => t.budget);
    expect(bDesc).toEqual([300, 150, 80]);
    const bAsc = sortTasks(tasks, "budget_asc")
      .filter((t) => t.budget != null)
      .map((t) => t.budget);
    expect(bAsc).toEqual([80, 150, 300]);
  });
});

describe("isMineTask", () => {
  it("matches assignee, labels, id — case-insensitive substring", async () => {
    const { tasks } = await scanBoard(FIXTURE);
    const byId = (id: string) => tasks.find((t) => t.id === id)!;
    expect(isMineTask(byId("MYPROJ-1"), "dev")).toBe(true); // assignee
    expect(isMineTask(byId("MYPROJ-3"), "ops")).toBe(true); // assignee + label
    expect(isMineTask(byId("MYPROJ-4"), "OPS")).toBe(true); // label, case
    expect(isMineTask(byId("MYPROJ-2"), "epic-171")).toBe(true); // label
    expect(isMineTask(byId("MYPROJ-1"), "myproj-1")).toBe(true); // id
    expect(isMineTask(byId("MYPROJ-2"), "dev")).toBe(false);
    expect(isMineTask(byId("MYPROJ-1"), "")).toBe(false);
    expect(isMineTask(byId("MYPROJ-1"), undefined)).toBe(false);
  });
});

describe("cache", () => {
  it("reuses snapshot within TTL, rescans after", async () => {
    const store = createBoardStore(FIXTURE, 60_000);
    await store.getBoard();
    await store.getBoard();
    expect(store.scanSeq()).toBe(1);
    const fresh = createBoardStore(FIXTURE, 0);
    await fresh.getBoard();
    await fresh.getBoard();
    expect(fresh.scanSeq()).toBe(2);
  });
});

describe("routes e2e", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("public read-only: 200 without any token (humans view, agents fetch)", async () => {
    const ok = await get("/ops/board");
    expect(ok.status).toBe(200);
    expect(ok.headers.get("content-type")).toContain("text/html");
    const j = await (await get("/api/ops/board.json")).json();
    expect(j.tasks.length).toBeGreaterThan(0);
  });

  it("HTML renders kanban columns and task cards", async () => {
    const html = await (await get("/ops/board")).text();
    for (const s of ["Draft", "To Do", "In Progress", "Done"]) {
      expect(html).toContain(s);
    }
    expect(html).toContain("MYPROJ-1");
    expect(html).toContain('data-epic-name="epic-163"');
    expect(html).toContain("0/2");
    expect(html).toContain('data-epic-name="epic-192"');
    expect(html).toContain("1/1");
  });

  it("escapes XSS in title", async () => {
    const html = await (await get("/ops/board")).text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("query filters apply", async () => {
    const r = await get("/api/ops/board.json?status=To+Do");
    const j = await r.json();
    expect(j.tasks).toHaveLength(2);
    const r2 = await get("/api/ops/board.json?epic=epic-163&q=funding");
    const j2 = await r2.json();
    expect(j2.tasks).toHaveLength(1);
    expect(j2.tasks[0].id).toBe("MYPROJ-1");
    const r3 = await get("/api/ops/board.json?budget_min=100");
    expect((await r3.json()).tasks).toHaveLength(2);
    const r4 = await get("/api/ops/board.json?sort=budget_desc");
    const j4 = await r4.json();
    expect(j4.tasks[0].budget).toBe(300);
  });

  it("?me=dev renders My tasks strip + mine badges on cards", async () => {
    const html = await (await get("/ops/board?me=dev")).text();
    expect(html).toContain("My tasks");
    expect(html).toContain(">dev<");
    expect(html).toContain(">mine<");
    expect(html).toContain('id="task-MYPROJ-1"');
    expect(html).toContain("ring-emerald-500/30");
  });

  it("?me=unknown renders My tasks section with zero count", async () => {
    const html = await (await get("/ops/board?me=nobody")).text();
    expect(html).toContain("My tasks");
    expect(html).toContain(">nobody<");
    expect(html).toContain("No tasks match this identity.");
  });

  it("route absent when OPS_BOARD_DIR unset (mount gate)", async () => {
    vi.stubEnv("OPS_BOARD_DIR", "");
    vi.resetModules();
    const { opsRoutes } = await import("../src/server/routes/ops");
    const a = new Hono();
    a.route("/", opsRoutes);
    const res = await a.fetch(new Request("http://x/ops/board"));
    expect(res.status).toBe(404);
  });
});
