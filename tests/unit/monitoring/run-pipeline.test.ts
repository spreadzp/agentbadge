import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createMonitoringStore } from "../../../src/agent-readiness/monitoring/monitoring-store";
import { executeMonitoredRun, summarizeScanResult, getTimeline } from "../../../src/agent-readiness/monitoring/run-pipeline";
import type { MonitoredProject } from "../../../src/agent-readiness/monitoring/monitoring-types";
import type { ScanReport } from "../../../src/agent-readiness/report-formatter";

/**
 * SLICE-99-4: Run pipeline + history timeline tests.
 *
 * Tests:
 * - summarizeScanResult: pure function extracts RunSummary from ScanReport
 * - executeMonitoredRun: full run with stubbed scan, record persisted
 * - Error path: unreachable target → outcome=error, record persisted
 * - Timeline: N runs → ordered series
 * - Gap-history: accumulates seen gap_ids after each ok run
 * - Scheduler integration: due project (fake clock) → real run → record exists
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "pipeline-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeProject(overrides?: Partial<MonitoredProject>): MonitoredProject {
  return {
    project_id: "p1",
    name: "Test API",
    url: "https://api.example.com",
    schedule: { kind: "daily", hour_utc: 6 },
    enabled: true,
    channels: [{ type: "webhook", target: "https://hook.example.com" }],
    thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
    plan: "free",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
    next_run_at: "2026-09-04T05:00:00Z",
    ...overrides,
  };
}

function makeFakeScanReport(overrides?: Partial<ScanReport>): ScanReport {
  return {
    url: "https://api.example.com",
    score: 72,
    grade: "C",
    total_rules: 36,
    verified: 28,
    missing: 8,
    gap: 8,
    not_applicable: 0,
    skipped: 0,
    categories: [],
    top_missing: [],
    summary: "Agent readiness: 72/100 (C)",
    pillars: [
      { pillar: "discoverability", label: "Discoverable", question: "Can agents find you?", weight: 25, score: 18, floorTriggered: false, categories: ["discoverability"] },
      { pillar: "understandability", label: "Understandable", question: "Can agents understand your API?", weight: 25, score: 20, floorTriggered: false, categories: ["docs"] },
      { pillar: "usability", label: "Usable", question: "Can agents call your API?", weight: 25, score: 19, floorTriggered: false, categories: ["auth"] },
      { pillar: "reliability", label: "Reliable", question: "Can agents trust your API?", weight: 25, score: 15, floorTriggered: false, categories: ["errors"] },
    ],
    floorTriggered: false,
    floorReason: null,
    assertions: [],
    gaps: [
      { gap_id: "gap-001", rule_id: "AB-001", type: "documentation", priority: "HIGH", title: "Missing llms.txt", hint: "Add llms.txt", status: "open", artifacts: [], fix_hint: "", effort_hint: "", estimated_cost: "" },
      { gap_id: "gap-002", rule_id: "AB-003", type: "semantic", priority: "MEDIUM", title: "Missing error codes", hint: "Document error codes", status: "open", artifacts: [], fix_hint: "", effort_hint: "", estimated_cost: "" },
    ],
    gap_summary: {
      total: 2,
      by_priority: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 },
      by_type: { documentation: 1, semantic: 1, capability: 0, evidence: 0 },
    },
    ...overrides,
  };
}

describe("SLICE-99-4: summarizeScanResult — pure function", () => {
  it("extracts RunSummary from ScanReport", () => {
    const report = makeFakeScanReport();
    const summary = summarizeScanResult(report);

    expect(summary.score).toBe(72);
    expect(summary.grade).toBe("C");
    expect(summary.pillar_scores).toEqual({
      discoverability: 18,
      understandability: 20,
      usability: 19,
      reliability: 15,
    });
    expect(summary.gap_summary.total).toBe(2);
    expect(summary.gap_summary.by_priority.HIGH).toBe(1);
    expect(summary.status_counts.verified).toBe(28);
    expect(summary.status_counts.missing).toBe(8);
    expect(summary.asr).toBeNull(); // no runtime
  });

  it("includes ASR when runtime present", () => {
    const report = makeFakeScanReport({
      runtime: {
        asr: { success: 7, partial: 1, failed: 0, rate: 0.875 },
        per_category: {},
        traces: [],
        conflicts_generated: [],
      } as never,
    });
    const summary = summarizeScanResult(report);
    expect(summary.asr).toBe(0.875);
  });
});

describe("SLICE-99-4: executeMonitoredRun — full pipeline", () => {
  let store: ReturnType<typeof createMonitoringStore>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-run-"));
    store = createMonitoringStore(dir);
  });

  it("successful run: record fields complete, summary matches scan output", async () => {
    const project = makeProject();
    store.upsertProject(project);

    const report = makeFakeScanReport();
    const record = await executeMonitoredRun(project, "scheduled", {
      store,
      now: () => new Date("2026-09-04T06:00:00Z"),
      scanFn: async () => report,
    });

    expect(record.outcome).toBe("ok");
    expect(record.project_id).toBe("p1");
    expect(record.trigger).toBe("scheduled");
    expect(record.summary.score).toBe(72);
    expect(record.summary.grade).toBe("C");
    expect(record.report_ref).toBeDefined();
    expect(record.run_id).toBeDefined();

    // Record persisted in store
    const latest = store.getLatestRun("p1");
    expect(latest?.run_id).toBe(record.run_id);
  });

  it("error path: unreachable target → outcome=error, record persisted", async () => {
    const project = makeProject();
    store.upsertProject(project);

    const record = await executeMonitoredRun(project, "scheduled", {
      store,
      now: () => new Date("2026-09-04T06:00:00Z"),
      scanFn: async () => {
        throw new Error("Connection refused");
      },
    });

    expect(record.outcome).toBe("error");
    expect(record.summary.score).toBe(0);
    expect(record.run_id).toBeDefined();

    // Error record still persisted (timeline honesty)
    const latest = store.getLatestRun("p1");
    expect(latest?.outcome).toBe("error");
  });

  it("gap-history accumulates seen gap_ids after ok run", async () => {
    const project = makeProject();
    store.upsertProject(project);

    const report = makeFakeScanReport();
    await executeMonitoredRun(project, "scheduled", {
      store,
      now: () => new Date("2026-09-04T06:00:00Z"),
      scanFn: async () => report,
    });

    const history = store.getGapHistory("p1");
    expect(history).toContain("gap-001");
    expect(history).toContain("gap-002");
  });

  it("gap-history not updated on error run", async () => {
    const project = makeProject();
    store.upsertProject(project);

    await executeMonitoredRun(project, "scheduled", {
      store,
      now: () => new Date("2026-09-04T06:00:00Z"),
      scanFn: async () => { throw new Error("fail"); },
    });

    const history = store.getGapHistory("p1");
    expect(history).toHaveLength(0);
  });

  it("manual trigger records trigger=manual", async () => {
    const project = makeProject();
    store.upsertProject(project);

    const report = makeFakeScanReport();
    const record = await executeMonitoredRun(project, "manual", {
      store,
      now: () => new Date("2026-09-04T10:00:00Z"),
      scanFn: async () => report,
    });

    expect(record.trigger).toBe("manual");
  });
});

describe("SLICE-99-4: getTimeline — ordered run history", () => {
  let store: ReturnType<typeof createMonitoringStore>;

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-timeline-"));
    store = createMonitoringStore(dir);
  });

  it("N runs → ordered series (newest first)", async () => {
    const project = makeProject();
    store.upsertProject(project);
    const report = makeFakeScanReport();

    // Run 3 times with different scores
    for (let i = 0; i < 3; i++) {
      await executeMonitoredRun(project, "scheduled", {
        store,
        now: () => new Date(`2026-09-0${i + 1}T06:00:00Z`),
        scanFn: async () => ({ ...report, score: 70 + i }),
      });
    }

    const timeline = getTimeline(store, "p1", 10);
    expect(timeline).toHaveLength(3);
    // Newest first
    expect(timeline[0].summary.score).toBe(72);
    expect(timeline[1].summary.score).toBe(71);
    expect(timeline[2].summary.score).toBe(70);
  });

  it("limit parameter respected", async () => {
    const project = makeProject();
    store.upsertProject(project);
    const report = makeFakeScanReport();

    for (let i = 0; i < 5; i++) {
      await executeMonitoredRun(project, "scheduled", {
        store,
        now: () => new Date(`2026-09-0${i + 1}T06:00:00Z`),
        scanFn: async () => report,
      });
    }

    const timeline = getTimeline(store, "p1", 2);
    expect(timeline).toHaveLength(2);
  });

  it("empty timeline for project with no runs", () => {
    const timeline = getTimeline(store, "nonexistent", 10);
    expect(timeline).toHaveLength(0);
  });
});

describe("SLICE-99-4: scheduler integration — real run via fake clock", () => {
  it("due project → real run → record exists, next_run advanced", async () => {
    const dir = mkdtempSync(join(tmpdir(), "pipeline-integ-"));
    const store = createMonitoringStore(dir);
    const project = makeProject({ next_run_at: "2026-09-04T05:00:00Z" });
    store.upsertProject(project);

    const report = makeFakeScanReport();
    const { startMonitoringScheduler } = await import("../../../src/agent-readiness/monitoring/scheduler");

    const now = new Date("2026-09-04T06:00:00Z");
    const sched = startMonitoringScheduler({
      store,
      now: () => now,
      tickIntervalMs: 1,
      onDueProject: async (p, trigger) => {
        await executeMonitoredRun(p, trigger, {
          store,
          now: () => now,
          scanFn: async () => report,
        });
        return { outcome: "ok" };
      },
    });

    await sched.tick();
    sched.stop();

    const latest = store.getLatestRun("p1");
    expect(latest).not.toBeNull();
    expect(latest?.outcome).toBe("ok");
    expect(latest?.summary.score).toBe(72);

    const updated = store.getProject("p1");
    expect(updated?.next_run_at).toBe("2026-09-05T06:00:00.000Z");
  });
});
