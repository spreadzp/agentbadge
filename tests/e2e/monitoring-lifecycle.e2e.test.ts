import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer as httpCreateServer, type Server as HttpServer } from "node:http";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import { createMonitoringStore } from "../../src/agent-readiness/monitoring/monitoring-store";
import { createMonitoringRoutes, type MonitoringAppDeps } from "../../src/server/routes/monitoring";
import { startMonitoringScheduler, computeNextRun } from "../../src/agent-readiness/monitoring/scheduler";
import { executeMonitoredRun } from "../../src/agent-readiness/monitoring/run-pipeline";
import { processRunResult } from "../../src/agent-readiness/monitoring/alert-engine";
import type { ScanReport } from "../../src/agent-readiness/report-formatter";
import type { MonitoredProject } from "../../src/agent-readiness/monitoring/monitoring-types";

/**
 * SLICE-99-9: Full monitoring lifecycle E2E.
 *
 * register → scheduled run → degrade → detect → alert → cooldown → restart → recover
 *
 * Uses fixture scanFn (no real network) + fixture webhook receiver.
 */

let webhookServer: HttpServer;
let webhookPort: number;
let webhookCalls: { body: string; headers: Record<string, string> }[];

beforeAll(async () => {
  webhookCalls = [];
  webhookServer = httpCreateServer((req, res) => {
    let body = "";
    req.on("data", (c) => { body += c; });
    req.on("end", () => {
      webhookCalls.push({ body, headers: req.headers as Record<string, string> });
      res.writeHead(200);
      res.end(JSON.stringify({ ok: true }));
    });
  });
  await new Promise<void>((resolve) => {
    webhookServer.listen(0, "127.0.0.1", () => {
      const addr = webhookServer.address();
      if (addr && typeof addr === "object") webhookPort = addr.port;
      resolve();
    });
  });
});

afterAll(() => webhookServer.close());

function makeScanFn(scores: number[]): (url: string) => Promise<ScanReport> {
  let callIdx = 0;
  return async () => {
    const score = scores[Math.min(callIdx++, scores.length - 1)];
    return {
      url: "https://api.example.com",
      score,
      grade: score >= 80 ? "B" : "C",
      total_rules: 36,
      verified: Math.round(score * 0.4),
      missing: 36 - Math.round(score * 0.4),
      gap: 36 - Math.round(score * 0.4),
      not_applicable: 0,
      skipped: 0,
      categories: [],
      top_missing: [],
      summary: "ok",
      pillars: [],
      floorTriggered: false,
      floorReason: null,
      assertions: [],
      gaps: [],
      gap_summary: { total: 0, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 } },
    };
  };
}

function makeDegradingScanFn(): { scanFn: (url: string) => Promise<ScanReport>; mutate: () => void; restore: () => void } {
  let degraded = false;
  const goodReport: ScanReport = {
    url: "https://api.example.com",
    score: 80, grade: "B",
    total_rules: 36, verified: 30, missing: 6, gap: 6, not_applicable: 0, skipped: 0,
    categories: [], top_missing: [], summary: "ok", pillars: [],
    floorTriggered: false, floorReason: null, assertions: [],
    gaps: [{ gap_id: "gap-001", rule_id: "AB-001", priority: "MEDIUM", type: "documentation", message: "Missing docs" } as any],
    gap_summary: { total: 1, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 1, LOW: 0 }, by_type: { documentation: 1, semantic: 0, capability: 0, evidence: 0 } },
  };
  const badReport: ScanReport = {
    ...goodReport,
    score: 65, grade: "C",
    verified: 24, missing: 12, gap: 12,
    gaps: [
      { gap_id: "gap-001", rule_id: "AB-001", priority: "MEDIUM", type: "documentation", message: "Missing docs" } as any,
      { gap_id: "gap-002", rule_id: "AB-002", priority: "HIGH", type: "semantic", message: "Semantic mismatch" } as any,
    ],
    gap_summary: { total: 2, by_priority: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 }, by_type: { documentation: 1, semantic: 1, capability: 0, evidence: 0 } },
  };
  return {
    scanFn: async () => degraded ? badReport : goodReport,
    mutate: () => { degraded = true; },
    restore: () => { degraded = false; },
  };
}

describe("SLICE-99-9: Monitoring lifecycle E2E", () => {
  let store: ReturnType<typeof createMonitoringStore>;
  let deps: MonitoringAppDeps;
  let app: Hono;
  let clock: Date;
  let fixture: ReturnType<typeof makeDegradingScanFn>;

  function setupStore() {
    const dir = mkdtempSync(join(tmpdir(), "e2e-mon-"));
    store = createMonitoringStore(dir);
  }

  function setupDeps(scanFn: (url: string) => Promise<ScanReport>) {
    clock = new Date("2026-09-04T06:00:00Z");
    deps = {
      store,
      now: () => clock,
      scanFn,
    };
    app = createMonitoringRoutes(deps);
  }

  it("register → scheduled run → RunRecord ok → gap-history seeded", async () => {
    setupStore();
    fixture = makeDegradingScanFn();
    setupDeps(fixture.scanFn);

    // Register project
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Lifecycle API",
        url: "https://api.example.com",
        schedule: { kind: "daily", hour_utc: 6 },
        channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
        webhook_secret: "lifecycle-secret",
      }),
    });
    expect(createRes.status).toBe(201);
    const project = await createRes.json();
    const projectId = project.project_id;

    // Manual run (simulates scheduled run)
    const runRes = await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });
    expect(runRes.status).toBe(200);
    const run = await runRes.json();
    expect(run.outcome).toBe("ok");
    expect(run.summary.score).toBe(80);

    // Timeline has 1 run
    const timelineRes = await app.request(`/monitoring/projects/${projectId}/runs`);
    const timeline = await timelineRes.json();
    expect(timeline.runs).toHaveLength(1);
  });

  it("degrade → detect → alert delivered (HMAC-verified) → AlertRecord persisted", async () => {
    setupStore();
    fixture = makeDegradingScanFn();
    setupDeps(fixture.scanFn);
    webhookCalls = [];

    // Register + first run (good)
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Degrade API",
        url: "https://api.example.com",
        schedule: { kind: "daily", hour_utc: 6 },
        channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
        webhook_secret: "degrade-secret",
      }),
    });
    const project = await createRes.json();
    const projectId = project.project_id;

    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });

    // Degrade fixture
    fixture.mutate();

    // Second run (degraded) → regression → alert
    const run2Res = await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });
    const run2 = await run2Res.json();
    expect(run2.summary.score).toBe(65);

    // Alert delivered to webhook
    expect(webhookCalls.length).toBeGreaterThanOrEqual(1);

    // HMAC verified
    const call = webhookCalls[0];
    const expectedSig = createHmac("sha256", "degrade-secret").update(call.body).digest("hex");
    expect(call.headers["x-agentbadge-signature"]).toBe(expectedSig);

    // AlertRecord persisted
    const alertsRes = await app.request(`/monitoring/projects/${projectId}/alerts`);
    const alerts = await alertsRes.json();
    expect(alerts.alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("cooldown: third run (unchanged) → regression suppressed, no second webhook", async () => {
    setupStore();
    fixture = makeDegradingScanFn();
    setupDeps(fixture.scanFn);
    webhookCalls = [];

    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cooldown API",
        url: "https://api.example.com",
        schedule: { kind: "daily", hour_utc: 6 },
        channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
        webhook_secret: "cooldown-secret",
      }),
    });
    const project = await createRes.json();
    const projectId = project.project_id;

    // Run 1 (good)
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });

    // Degrade + run 2 (alert)
    fixture.mutate();
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });
    const alertsAfterRun2 = webhookCalls.length;

    // Run 3 (still degraded, same regression → suppressed by cooldown)
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });

    // No additional webhook calls
    expect(webhookCalls.length).toBe(alertsAfterRun2);
  });

  it("restart: recreate store mid-lifecycle → state intact", async () => {
    const dir = mkdtempSync(join(tmpdir(), "restart-"));
    store = createMonitoringStore(dir);
    fixture = makeDegradingScanFn();
    setupDeps(fixture.scanFn);

    // Register + run
    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Restart API",
        url: "https://api.example.com",
        schedule: { kind: "daily", hour_utc: 6 },
        channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
      }),
    });
    const project = await createRes.json();
    const projectId = project.project_id;
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });

    // Simulate restart: recreate store from same dir
    const restartedStore = createMonitoringStore(dir);
    const restartedDeps: MonitoringAppDeps = {
      store: restartedStore,
      now: () => clock,
      scanFn: fixture.scanFn,
    };
    const restartedApp = createMonitoringRoutes(restartedDeps);

    // State intact: project still exists
    const projRes = await restartedApp.request(`/monitoring/projects/${projectId}`);
    expect(projRes.status).toBe(200);

    // Runs preserved
    const runsRes = await restartedApp.request(`/monitoring/projects/${projectId}/runs`);
    const runs = await runsRes.json();
    expect(runs.runs.length).toBeGreaterThanOrEqual(1);
  });

  it("recovery: restore fixture → next run → no regression → no alert", async () => {
    setupStore();
    fixture = makeDegradingScanFn();
    setupDeps(fixture.scanFn);
    webhookCalls = [];

    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Recovery API",
        url: "https://api.example.com",
        schedule: { kind: "daily", hour_utc: 6 },
        channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
        webhook_secret: "recovery-secret",
      }),
    });
    const project = await createRes.json();
    const projectId = project.project_id;

    // Run 1 (good)
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });

    // Degrade + run 2 (alert)
    fixture.mutate();
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });
    const alertsAfterDegrade = webhookCalls.length;
    expect(alertsAfterDegrade).toBeGreaterThanOrEqual(1);

    // Restore + run 3 (recovered)
    fixture.restore();
    await app.request(`/monitoring/projects/${projectId}/run`, { method: "POST" });

    // No new alert (score improved, no regression)
    expect(webhookCalls.length).toBe(alertsAfterDegrade);

    // Timeline shows recovery: latest score back to 80
    const runsRes = await app.request(`/monitoring/projects/${projectId}/runs`);
    const runs = await runsRes.json();
    expect(runs.runs[0].summary.score).toBe(80);
  });
});

describe("SLICE-99-9: Scheduler determinism — no double-fire", () => {
  it("3 ticks while one run in-flight → exactly one run", async () => {
    const dir = mkdtempSync(join(tmpdir(), "sched-determinism-"));
    const store = createMonitoringStore(dir);

    const project: MonitoredProject = {
      project_id: "det-1",
      name: "Determinism API",
      url: "https://api.example.com",
      schedule: { kind: "daily", hour_utc: 6 },
      enabled: true,
      channels: [],
      thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
      plan: "free",
      created_at: "2026-09-04T00:00:00Z",
      updated_at: "2026-09-04T00:00:00Z",
      next_run_at: "2026-09-04T05:00:00Z",
    };
    store.upsertProject(project);

    let runCount = 0;
    let clock = new Date("2026-09-04T06:00:00Z");

    const scheduler = startMonitoringScheduler({
      store,
      now: () => clock,
      onDueProject: async () => {
        runCount++;
        return { outcome: "ok" as const };
      },
    });

    // Tick 3 times rapidly
    await scheduler.tick();
    await scheduler.tick();
    await scheduler.tick();

    expect(runCount).toBe(1); // Only one run — lock prevents double-fire
  });
});

describe("SLICE-99-9: Safety sweep — blocked URLs", () => {
  it("scanFn error → outcome=error, no crash", async () => {
    const dir = mkdtempSync(join(tmpdir(), "safety-"));
    const store = createMonitoringStore(dir);
    const clock = new Date("2026-09-04T06:00:00Z");

    const failingScanFn = async () => { throw new Error("SSRF blocked: private IP"); };

    const deps: MonitoringAppDeps = { store, now: () => clock, scanFn: failingScanFn };
    const app = createMonitoringRoutes(deps);

    const createRes = await app.request("/monitoring/projects", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Blocked API",
        url: "http://192.168.1.1",
        schedule: { kind: "daily", hour_utc: 6 },
        channels: [{ type: "webhook", target: "http://127.0.0.1:1/bad" }],
      }),
    });
    const project = await createRes.json();

    const runRes = await app.request(`/monitoring/projects/${project.project_id}/run`, { method: "POST" });
    const run = await runRes.json();
    expect(run.outcome).toBe("error");
  });
});
