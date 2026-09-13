import { describe, it, expect, beforeAll, afterAll, beforeEach } from "vitest";
import { mkdtempSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createServer as httpCreateServer, type Server as HttpServer } from "node:http";
import { createHmac } from "node:crypto";
import { createMonitoringStore } from "../../../src/agent-readiness/monitoring/monitoring-store";
import { processRunResult, formatRegressionAlert, makeDedupeKey } from "../../../src/agent-readiness/monitoring/alert-engine";
import { sendWebhook } from "../../../src/agent-readiness/monitoring/channels/webhook";
import type { MonitoredProject, RunRecord, RunSummary, RegressionReport } from "../../../src/agent-readiness/monitoring/monitoring-types";

/**
 * SLICE-99-6: Alert engine + channels tests.
 */

function makeProject(overrides?: Partial<MonitoredProject>): MonitoredProject {
  return {
    project_id: "p1",
    name: "Test API",
    url: "https://api.example.com",
    schedule: { kind: "daily", hour_utc: 6 },
    enabled: true,
    channels: [{ type: "webhook", target: "http://localhost:0/hook" }],
    thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
    plan: "free",
    created_at: "2026-09-04T00:00:00Z",
    updated_at: "2026-09-04T00:00:00Z",
    next_run_at: "2026-09-04T05:00:00Z",
    webhook_secret: "test-secret",
    ...overrides,
  };
}

function makeSummary(overrides?: Partial<RunSummary>): RunSummary {
  return {
    score: 72,
    grade: "C",
    pillar_scores: {},
    gap_summary: {
      total: 2,
      by_priority: { CRITICAL: 0, HIGH: 1, MEDIUM: 1, LOW: 0 },
      by_type: { documentation: 1, semantic: 1, capability: 0, evidence: 0 },
    },
    status_counts: { verified: 28, missing: 8 },
    asr: null,
    gap_ids: ["gap-001", "gap-002"],
    rule_statuses: {},
    ...overrides,
  };
}

function makeRun(summary: RunSummary, outcome: "ok" | "error" = "ok"): RunRecord {
  return {
    run_id: "run-" + Math.random().toString(36).slice(2, 8),
    project_id: "p1",
    started_at: "2026-09-04T06:00:00Z",
    finished_at: "2026-09-04T06:00:05Z",
    trigger: "scheduled",
    outcome,
    summary,
    report_ref: "p1/run-1",
  };
}

describe("SLICE-99-6: makeDedupeKey", () => {
  it("generates key from project + rule + gap_id", () => {
    const key = makeDedupeKey("p1", "new_gap", "gap-003");
    expect(key).toBe("p1|new_gap|gap-003");
  });

  it("generates key from project + rule + rule_id", () => {
    const key = makeDedupeKey("p1", "status_flip", undefined, "AB-001");
    expect(key).toBe("p1|status_flip|AB-001");
  });
});

describe("SLICE-99-6: formatRegressionAlert", () => {
  it("produces deterministic content with ids, deltas, links", () => {
    const project = makeProject();
    const prev = makeRun(makeSummary({ score: 80 }));
    const now = makeRun(makeSummary({ score: 70 }));
    const report: RegressionReport = {
      project_id: "p1",
      run_id: now.run_id,
      findings: [
        { rule: "score_drop", severity: "warning", delta: { prev: 80, curr: 70, drop: 10 } },
      ],
    };
    const text = formatRegressionAlert(project, report, prev, now);
    expect(text).toContain("Test API");
    expect(text).toContain("80");
    expect(text).toContain("70");
    expect(text).toContain("score_drop");
  });
});

describe("SLICE-99-6: processRunResult — full flow", () => {
  let store: ReturnType<typeof createMonitoringStore>;
  let webhookCalls: { body: string; headers: Record<string, string> }[];
  let webhookServer: HttpServer;
  let webhookPort: number;

  beforeAll(async () => {
    // Start a local webhook receiver
    webhookCalls = [];
    webhookServer = httpCreateServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        webhookCalls.push({ body, headers: req.headers as Record<string, string> });
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => {
      webhookServer.listen(0, "127.0.0.1", () => {
        const addr = webhookServer.address();
        if (addr && typeof addr === "object") {
          webhookPort = addr.port;
          resolve();
        }
      });
    });
  });

  afterAll(() => {
    webhookServer.close();
  });

  beforeEach(() => {
    const dir = mkdtempSync(join(tmpdir(), "alert-"));
    store = createMonitoringStore(dir);
    webhookCalls = [];
  });

  it("regression → alert delivered to webhook + AlertRecord persisted", async () => {
    const project = makeProject({
      channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
      webhook_secret: "secret-123",
    });
    store.upsertProject(project);

    // Seed prev run
    const prevSummary = makeSummary({ score: 80, gap_ids: ["gap-001"] });
    store.appendRun(makeRun(prevSummary));

    // Now run with regression
    const nowSummary = makeSummary({ score: 70, gap_ids: ["gap-001", "gap-003"] });
    const nowRun = makeRun(nowSummary);
    store.appendRun(nowRun);

    const result = await processRunResult(project, nowRun, {
      store,
      now: () => new Date("2026-09-04T06:00:10Z"),
      prevRun: store.getLatestRuns("p1", 2)[1], // the prev run
      history: ["gap-001"],
    });

    expect(result.alerted).toBe(true);
    expect(webhookCalls).toHaveLength(1);
    expect(result.alertRecords).toHaveLength(1);

    // AlertRecord persisted
    const alerts = store.getAlerts("p1");
    expect(alerts.length).toBeGreaterThanOrEqual(1);
  });

  it("noop run → no alert, no AlertRecord", async () => {
    const project = makeProject({
      channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
    });
    store.upsertProject(project);

    const summary = makeSummary({ score: 72 });
    const prevRun = makeRun(summary);
    store.appendRun(prevRun);
    const nowRun = makeRun(summary);
    store.appendRun(nowRun);

    const result = await processRunResult(project, nowRun, {
      store,
      now: () => new Date("2026-09-04T06:00:10Z"),
      prevRun,
      history: ["gap-001", "gap-002"],
    });

    expect(result.alerted).toBe(false);
    expect(webhookCalls).toHaveLength(0);
    expect(result.alertRecords).toHaveLength(0);
  });

  it("dedupe: same key within cooldown → suppressed", async () => {
    const project = makeProject({
      channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
      webhook_secret: "secret-123",
    });
    store.upsertProject(project);

    // Set cooldown for the score_drop key
    const key = makeDedupeKey("p1", "score_drop");
    store.setCooldown("p1", key, "2026-09-05T06:00:00Z"); // future

    const prevSummary = makeSummary({ score: 80 });
    const nowSummary = makeSummary({ score: 70 });
    const prevRun = makeRun(prevSummary);
    const nowRun = makeRun(nowSummary);
    store.appendRun(prevRun);
    store.appendRun(nowRun);

    const result = await processRunResult(project, nowRun, {
      store,
      now: () => new Date("2026-09-04T06:00:10Z"),
      prevRun,
      history: [],
    });

    expect(result.alerted).toBe(false);
    expect(result.suppressed).toContainEqual(expect.objectContaining({ rule: "score_drop" }));
    expect(webhookCalls).toHaveLength(0);
  });

  it("severity filter: info-only report below min_severity → no alert", async () => {
    const project = makeProject({
      channels: [{ type: "webhook", target: `http://127.0.0.1:${webhookPort}/hook` }],
      thresholds: { score_drop: 5, asr_drop: 0.1, cooldown_hours: 24, min_severity: "warning" },
    });
    store.upsertProject(project);

    // new_conflict is info severity
    const prevSummary = makeSummary({ score: 72, rule_statuses: { "AB-001": "VERIFIED" } });
    const nowSummary = makeSummary({ score: 72, rule_statuses: { "AB-001": "CONFLICT" } });
    const prevRun = makeRun(prevSummary);
    const nowRun = makeRun(nowSummary);
    store.appendRun(prevRun);
    store.appendRun(nowRun);

    const result = await processRunResult(project, nowRun, {
      store,
      now: () => new Date("2026-09-04T06:00:10Z"),
      prevRun,
      history: [],
    });

    // new_conflict is info, below min_severity=warning
    expect(result.alerted).toBe(false);
    expect(webhookCalls).toHaveLength(0);
  });

  it("channel isolation: failing webhook → others still delivered", async () => {
    const project = makeProject({
      channels: [
        { type: "webhook", target: "http://127.0.0.1:1/bad" }, // port 1 = connection refused
        { type: "webhook", target: `http://127.0.0.1:${webhookPort}/good` },
      ],
      webhook_secret: "secret-123",
    });
    store.upsertProject(project);

    const prevSummary = makeSummary({ score: 80 });
    const nowSummary = makeSummary({ score: 70 });
    const prevRun = makeRun(prevSummary);
    const nowRun = makeRun(nowSummary);
    store.appendRun(prevRun);
    store.appendRun(nowRun);

    const result = await processRunResult(project, nowRun, {
      store,
      now: () => new Date("2026-09-04T06:00:10Z"),
      prevRun,
      history: [],
    });

    expect(result.alerted).toBe(true);
    // Good webhook still received
    expect(webhookCalls.some((c) => c.headers["host"]?.includes(`${webhookPort}`))).toBe(true);
    // Bad channel failure recorded
    expect(result.channelFailures.length).toBeGreaterThanOrEqual(1);
  });
});

describe("SLICE-99-6: webhook channel — HMAC signature", () => {
  let webhookServer: HttpServer;
  let webhookPort: number;
  let receivedSignature: string | undefined;
  let receivedBody: string;

  beforeAll(async () => {
    webhookServer = httpCreateServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => { body += chunk; });
      req.on("end", () => {
        receivedBody = body;
        receivedSignature = req.headers["x-agentbadge-signature"] as string;
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
    });
    await new Promise<void>((resolve) => {
      webhookServer.listen(0, "127.0.0.1", () => {
        const addr = webhookServer.address();
        if (addr && typeof addr === "object") {
          webhookPort = addr.port;
          resolve();
        }
      });
    });
  });

  afterAll(() => {
    webhookServer.close();
  });

  it("webhook sends HMAC-SHA256 signature header", async () => {
    const payload = { project: "p1", severity: "warning", items: [] };
    const secret = "my-secret";
    const result = await sendWebhook(
      `http://127.0.0.1:${webhookPort}/hook`,
      payload,
      secret,
    );

    expect(result.ok).toBe(true);
    expect(receivedSignature).toBeDefined();

    // Verify signature
    const expected = createHmac("sha256", secret).update(receivedBody).digest("hex");
    expect(receivedSignature).toBe(expected);
  });

  it("webhook without secret → no signature header", async () => {
    const payload = { project: "p1" };
    const result = await sendWebhook(
      `http://127.0.0.1:${webhookPort}/hook`,
      payload,
      undefined,
    );

    expect(result.ok).toBe(true);
    expect(receivedSignature).toBeUndefined();
  });

  it("connection refused → ok=false with error", async () => {
    const result = await sendWebhook(
      "http://127.0.0.1:1/bad",
      { project: "p1" },
      "secret",
    );
    expect(result.ok).toBe(false);
    expect(result.error).toBeDefined();
  });
});
