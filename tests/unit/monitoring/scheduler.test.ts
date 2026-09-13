import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMonitoringStore } from "../../../src/agent-readiness/monitoring/monitoring-store";
import { startMonitoringScheduler, computeNextRun, type SchedulerDeps } from "../../../src/agent-readiness/monitoring/scheduler";
import type { MonitoredProject } from "../../../src/agent-readiness/monitoring/monitoring-types";

/**
 * SLICE-99-3: Scheduler core tests — fake clock, zero real sleeps.
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "sched-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeProject(overrides?: Partial<MonitoredProject>): MonitoredProject {
  return {
    project_id: "p1",
    name: "Test",
    url: "https://api.example.com",
    schedule: { kind: "daily", hour_utc: 6 },
    enabled: true,
    channels: [{ type: "webhook", target: "https://hook.example.com" }],
    thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
    plan: "free",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
    next_run_at: "2026-09-04T06:00:00Z",
    ...overrides,
  };
}

describe("SLICE-99-3: computeNextRun — pure function", () => {
  it("daily: next occurrence of hour 6 from 04:00 → same day 06:00", () => {
    const result = computeNextRun({ kind: "daily", hour_utc: 6 }, new Date("2026-09-04T04:00:00Z"));
    expect(result.toISOString()).toBe("2026-09-04T06:00:00.000Z");
  });

  it("daily: next occurrence of hour 6 from 08:00 → next day 06:00", () => {
    const result = computeNextRun({ kind: "daily", hour_utc: 6 }, new Date("2026-09-04T08:00:00Z"));
    expect(result.toISOString()).toBe("2026-09-05T06:00:00.000Z");
  });

  it("daily: exactly at hour 6 → next day (strictly future)", () => {
    const result = computeNextRun({ kind: "daily", hour_utc: 6 }, new Date("2026-09-04T06:00:00Z"));
    expect(result.toISOString()).toBe("2026-09-05T06:00:00.000Z");
  });

  it("daily: month boundary Sep 30 23:00 → Oct 1 06:00", () => {
    const result = computeNextRun({ kind: "daily", hour_utc: 6 }, new Date("2026-09-30T23:00:00Z"));
    expect(result.toISOString()).toBe("2026-10-01T06:00:00.000Z");
  });

  it("weekly: day 1 (Monday) hour 6 from Sunday → next Monday 06:00", () => {
    // 2026-09-06 is a Sunday
    const result = computeNextRun({ kind: "weekly", hour_utc: 6, day_of_week: 1 }, new Date("2026-09-06T04:00:00Z"));
    expect(result.toISOString()).toBe("2026-09-07T06:00:00.000Z");
  });

  it("weekly: day 5 (Friday) hour 6 from Friday 08:00 → next Friday 06:00", () => {
    // 2026-09-04 is a Friday
    const result = computeNextRun({ kind: "weekly", hour_utc: 6, day_of_week: 5 }, new Date("2026-09-04T08:00:00Z"));
    expect(result.toISOString()).toBe("2026-09-11T06:00:00.000Z");
  });

  it("weekly: exactly at scheduled time → next week (strictly future)", () => {
    // 2026-09-04 is a Friday at 06:00
    const result = computeNextRun({ kind: "weekly", hour_utc: 6, day_of_week: 5 }, new Date("2026-09-04T06:00:00Z"));
    expect(result.toISOString()).toBe("2026-09-11T06:00:00.000Z");
  });
});

describe("SLICE-99-3: Scheduler — tick loop", () => {
  let store: ReturnType<typeof createMonitoringStore>;
  let now: Date;
  let runCalls: { project_id: string; trigger: string }[];
  let deps: SchedulerDeps;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "sched-loop-"));
    store = createMonitoringStore(dir);
    now = new Date("2026-09-04T06:00:00Z");
    runCalls = [];

    deps = {
      store,
      now: () => now,
      onDueProject: async (project, trigger) => {
        runCalls.push({ project_id: project.project_id, trigger });
        return { outcome: "ok" as const };
      },
      tickIntervalMs: 1, // fast for tests
    };
  });

  it("due project (next_run_at in past) fires on tick", async () => {
    store.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z" }));
    const sched = startMonitoringScheduler(deps);
    await sched.tick();
    sched.stop();
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0].project_id).toBe("p1");
    expect(runCalls[0].trigger).toBe("scheduled");
  });

  it("future project (next_run_at in future) does not fire", async () => {
    store.upsertProject(makeProject({ next_run_at: "2026-09-05T06:00:00Z" }));
    const sched = startMonitoringScheduler(deps);
    await sched.tick();
    sched.stop();
    expect(runCalls).toHaveLength(0);
  });

  it("disabled project never fires even if due", async () => {
    store.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z", enabled: false }));
    const sched = startMonitoringScheduler(deps);
    await sched.tick();
    sched.stop();
    expect(runCalls).toHaveLength(0);
  });

  it("next_run_at advances after run", async () => {
    store.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z" }));
    const sched = startMonitoringScheduler(deps);
    await sched.tick();
    sched.stop();
    const updated = store.getProject("p1");
    expect(updated?.next_run_at).toBe("2026-09-05T06:00:00.000Z");
  });

  it("lock: project already running → second tick skips", async () => {
    let resolveRun: () => void;
    const runPromise = new Promise<void>((r) => { resolveRun = r; });
    deps.onDueProject = async (project) => {
      runCalls.push({ project_id: project.project_id, trigger: "scheduled" });
      await runPromise;
      return { outcome: "ok" };
    };

    store.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z" }));
    const sched = startMonitoringScheduler(deps);

    // Start first tick (will hang on runPromise)
    const tick1 = sched.tick();
    // Start second tick immediately (should skip due to lock)
    await sched.tick();
    expect(runCalls).toHaveLength(1);

    // Release the first run
    resolveRun!();
    await tick1;
    sched.stop();
  });

  it("manual trigger fires run with trigger=manual", async () => {
    store.upsertProject(makeProject({ next_run_at: "2026-09-05T06:00:00Z" }));
    const sched = startMonitoringScheduler(deps);
    const result = await sched.triggerManualRun("p1");
    sched.stop();
    expect(result.outcome).toBe("ok");
    expect(runCalls).toHaveLength(1);
    expect(runCalls[0].trigger).toBe("manual");
  });

  it("manual trigger while scheduled run in-flight → rejected", async () => {
    let resolveRun: () => void;
    const runPromise = new Promise<void>((r) => { resolveRun = r; });
    deps.onDueProject = async () => {
      await runPromise;
      return { outcome: "ok" };
    };

    store.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z" }));
    const sched = startMonitoringScheduler(deps);

    const tick1 = sched.tick(); // starts run, hangs
    const manualResult = await sched.triggerManualRun("p1");
    expect(manualResult.outcome).toBe("error");
    expect(manualResult.error).toMatch(/already running|locked/i);

    resolveRun!();
    await tick1;
    sched.stop();
  });

  it("run failure → outcome error, next_run advances, loop alive", async () => {
    deps.onDueProject = async () => {
      throw new Error("scan failed");
    };

    store.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z" }));
    const sched = startMonitoringScheduler(deps);
    await sched.tick();
    sched.stop();

    const updated = store.getProject("p1");
    expect(updated?.next_run_at).toBe("2026-09-05T06:00:00.000Z");
    // Loop is still alive (no throw)
  });

  it("restart: recreate scheduler over same store → due project fires once", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-restart-"));
    const store1 = createMonitoringStore(dir);
    store1.upsertProject(makeProject({ next_run_at: "2026-09-04T05:00:00Z" }));

    const calls1: string[] = [];
    const deps1: SchedulerDeps = {
      store: store1,
      now: () => now,
      onDueProject: async (p) => { calls1.push(p.project_id); return { outcome: "ok" }; },
      tickIntervalMs: 1,
    };

    const sched1 = startMonitoringScheduler(deps1);
    await sched1.tick();
    sched1.stop();

    // Recreate over same store
    const store2 = createMonitoringStore(dir);
    const calls2: string[] = [];
    const deps2: SchedulerDeps = {
      store: store2,
      now: () => now,
      onDueProject: async (p) => { calls2.push(p.project_id); return { outcome: "ok" }; },
      tickIntervalMs: 1,
    };

    const sched2 = startMonitoringScheduler(deps2);
    await sched2.tick();
    sched2.stop();

    expect(calls1).toEqual(["p1"]);
    expect(calls2).toHaveLength(0); // next_run_at already advanced
  });

  it("multiple due projects fire sequentially", async () => {
    const order: string[] = [];
    deps.onDueProject = async (p) => {
      order.push(p.project_id);
      return { outcome: "ok" };
    };

    store.upsertProject(makeProject({ project_id: "a", next_run_at: "2026-09-04T05:00:00Z" }));
    store.upsertProject(makeProject({ project_id: "b", next_run_at: "2026-09-04T05:00:00Z" }));

    const sched = startMonitoringScheduler(deps);
    await sched.tick();
    sched.stop();

    expect(order).toHaveLength(2);
    expect(order).toContain("a");
    expect(order).toContain("b");
  });
});
