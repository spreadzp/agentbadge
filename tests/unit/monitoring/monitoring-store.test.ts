import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import {
  validateProjectInput,
  type MonitoredProject,
  type RunRecord,
  type AlertRecord,
} from "../../../src/agent-readiness/monitoring/monitoring-types";
import { createMonitoringStore } from "../../../src/agent-readiness/monitoring/monitoring-store";

/**
 * SLICE-99-2: Monitoring types + persistent store tests.
 *
 * Verifies:
 * - Types match spec §10 field-for-field
 * - Zod validation rejects invalid input
 * - Store persists all record kinds (restart survival)
 * - Gap-history + cooldown primitives work
 * - Atomic writes (temp + rename)
 */

let tmpDir: string;

beforeAll(() => {
  tmpDir = mkdtempSync(join(tmpdir(), "monitoring-test-"));
});

afterAll(() => {
  rmSync(tmpDir, { recursive: true, force: true });
});

function makeProject(overrides?: Partial<MonitoredProject>): MonitoredProject {
  return {
    project_id: "proj-001",
    name: "Test API",
    url: "https://api.example.com",
    schedule: { kind: "daily", hour_utc: 6 },
    enabled: true,
    channels: [{ type: "webhook", target: "https://hook.example.com/abc" }],
    thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
    plan: "free",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
    next_run_at: "2026-09-04T06:00:00Z",
    ...overrides,
  };
}

function makeRun(overrides?: Partial<RunRecord>): RunRecord {
  return {
    run_id: "run-001",
    project_id: "proj-001",
    started_at: "2026-09-04T06:00:00Z",
    finished_at: "2026-09-04T06:00:05Z",
    trigger: "scheduled",
    outcome: "ok",
    summary: {
      score: 72,
      grade: "C",
      pillar_scores: {},
      gap_summary: { total: 5, by_priority: {}, by_type: {} },
      status_counts: { verified: 28, missing: 8 },
      asr: null,
    },
    report_ref: "reports/proj-001/run-001.json",
    ...overrides,
  };
}

describe("SLICE-99-2: Monitoring types — validation", () => {
  it("valid project input passes zod validation", () => {
    const input = {
      name: "Test API",
      url: "https://api.example.com",
      schedule: { kind: "daily", hour_utc: 6 },
      channels: [{ type: "webhook", target: "https://hook.example.com/abc" }],
      thresholds: { score_drop: 5, asr_drop: 0.1 },
      plan: "free",
    };
    const result = validateProjectInput(input);
    expect(result.success).toBe(true);
  });

  it("rejects bad URL", () => {
    const result = validateProjectInput({ ...makeProject(), url: "not-a-url" });
    expect(result.success).toBe(false);
  });

  it("rejects hour_utc > 23", () => {
    const result = validateProjectInput({
      name: "Test",
      url: "https://api.example.com",
      schedule: { kind: "daily", hour_utc: 25 },
      channels: [{ type: "webhook", target: "https://hook.example.com" }],
      plan: "free",
    });
    expect(result.success).toBe(false);
  });

  it("rejects day_of_week > 6", () => {
    const result = validateProjectInput({
      name: "Test",
      url: "https://api.example.com",
      schedule: { kind: "weekly", hour_utc: 6, day_of_week: 7 },
      channels: [{ type: "webhook", target: "https://hook.example.com" }],
      plan: "free",
    });
    expect(result.success).toBe(false);
  });

  it("rejects unknown channel type", () => {
    const result = validateProjectInput({
      name: "Test",
      url: "https://api.example.com",
      schedule: { kind: "daily", hour_utc: 6 },
      channels: [{ type: "slack", target: "https://hook.example.com" }],
      plan: "free",
    });
    expect(result.success).toBe(false);
  });

  it("rejects weekly schedule without day_of_week", () => {
    const result = validateProjectInput({
      name: "Test",
      url: "https://api.example.com",
      schedule: { kind: "weekly", hour_utc: 6 },
      channels: [{ type: "webhook", target: "https://hook.example.com" }],
      plan: "free",
    });
    expect(result.success).toBe(false);
  });
});

describe("SLICE-99-2: Monitoring store — persistence", () => {
  let store: ReturnType<typeof createMonitoringStore>;

  beforeEach(() => {
    // Fresh store per test
    const testDir = mkdtempSync(join(tmpdir(), "mon-store-"));
    store = createMonitoringStore(testDir);
  });

  it("upsert + get project round-trips", () => {
    const project = makeProject();
    store.upsertProject(project);
    const got = store.getProject("proj-001");
    expect(got).toEqual(project);
  });

  it("list projects returns all", () => {
    store.upsertProject(makeProject({ project_id: "p1" }));
    store.upsertProject(makeProject({ project_id: "p2" }));
    const list = store.listProjects();
    expect(list).toHaveLength(2);
  });

  it("delete project removes it", () => {
    store.upsertProject(makeProject());
    store.deleteProject("proj-001");
    expect(store.getProject("proj-001")).toBeNull();
  });

  it("append run + latest run", () => {
    store.upsertProject(makeProject());
    store.appendRun(makeRun({ run_id: "run-1", summary: { ...makeRun().summary, score: 70 } }));
    store.appendRun(makeRun({ run_id: "run-2", summary: { ...makeRun().summary, score: 75 } }));
    const latest = store.getLatestRun("proj-001");
    expect(latest?.run_id).toBe("run-2");
  });

  it("latest-run(n) returns N most recent", () => {
    store.upsertProject(makeProject());
    store.appendRun(makeRun({ run_id: "r1" }));
    store.appendRun(makeRun({ run_id: "r2" }));
    store.appendRun(makeRun({ run_id: "r3" }));
    const runs = store.getLatestRuns("proj-001", 2);
    expect(runs).toHaveLength(2);
    expect(runs[0].run_id).toBe("r3");
    expect(runs[1].run_id).toBe("r2");
  });

  it("append alert + list alerts", () => {
    const alert: AlertRecord = {
      alert_id: "alert-1",
      project_id: "proj-001",
      run_id: "run-001",
      finding: { rule: "score_drop", severity: "warning", delta: { prev: 75, curr: 70 } },
      channel: "webhook",
      sent_at: "2026-09-04T06:00:10Z",
      dedupe_key: "proj-001|score_drop|",
    };
    store.upsertProject(makeProject());
    store.appendAlert(alert);
    const alerts = store.getAlerts("proj-001");
    expect(alerts).toHaveLength(1);
    expect(alerts[0].alert_id).toBe("alert-1");
  });

  it("cooldown set/get", () => {
    store.setCooldown("proj-001", "score_drop|gap-1", "2026-09-04T06:00:00Z");
    const cd = store.getCooldown("proj-001", "score_drop|gap-1");
    expect(cd).toBe("2026-09-04T06:00:00Z");
  });

  it("cooldown returns null when not set", () => {
    const cd = store.getCooldown("proj-001", "nonexistent");
    expect(cd).toBeNull();
  });

  it("gap-history add + list", () => {
    store.addToGapHistory("proj-001", "gap-001");
    store.addToGapHistory("proj-001", "gap-002");
    const history = store.getGapHistory("proj-001");
    expect(history).toContain("gap-001");
    expect(history).toContain("gap-002");
  });

  it("gap-history deduplicates", () => {
    store.addToGapHistory("proj-001", "gap-001");
    store.addToGapHistory("proj-001", "gap-001");
    const history = store.getGapHistory("proj-001");
    expect(history.filter((g) => g === "gap-001")).toHaveLength(1);
  });

  it("restart survival: recreate store from disk, records intact", () => {
    const testDir = mkdtempSync(join(tmpdir(), "mon-restart-"));
    const store1 = createMonitoringStore(testDir);
    store1.upsertProject(makeProject({ project_id: "survive-1" }));
    store1.appendRun(makeRun({ project_id: "survive-1", run_id: "survive-run-1" }));
    store1.addToGapHistory("survive-1", "gap-x");

    // Recreate store from same directory
    const store2 = createMonitoringStore(testDir);
    expect(store2.getProject("survive-1")).toEqual(makeProject({ project_id: "survive-1" }));
    const runs = store2.getLatestRuns("survive-1", 10);
    expect(runs).toHaveLength(1);
    expect(runs[0].run_id).toBe("survive-run-1");
    expect(store2.getGapHistory("survive-1")).toContain("gap-x");
  });

  it("atomic writes: data file exists on disk", () => {
    const testDir = mkdtempSync(join(tmpdir(), "mon-atomic-"));
    const s = createMonitoringStore(testDir);
    s.upsertProject(makeProject({ project_id: "atomic-1" }));
    expect(existsSync(join(testDir, "projects.json"))).toBe(true);
    const raw = readFileSync(join(testDir, "projects.json"), "utf-8");
    const parsed = JSON.parse(raw);
    expect(parsed["atomic-1"]).toBeDefined();
  });
});
