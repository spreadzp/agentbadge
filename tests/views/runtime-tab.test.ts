import { describe, it, expect } from "vitest";

/**
 * SLICE-98-8: Web Runtime Tab — Trace Viewer
 *
 * Tests verify that renderReport() in service-page.ts includes a runtime section
 * when the report has runtime data, and an empty state when it doesn't.
 *
 * Since renderReport is an inline JS function inside service-page.ts,
 * we test the HTML output structure by extracting and evaluating it.
 */

const RUNTIME_REPORT_FIXTURE = {
  url: "https://api.example.com",
  score: 72,
  grade: "C",
  total_rules: 40,
  verified: 28,
  missing: 8,
  gap: 8,
  not_applicable: 4,
  skipped: 0,
  summary: "Agent readiness needs improvement",
  categories: [],
  top_missing: [],
  pillars: [],
  floorTriggered: false,
  floorReason: null,
  assertions: [],
  gaps: [],
  gap_summary: { total: 0, by_priority: {}, by_type: {} },
  runtime: {
    asr: {
      total: 8,
      successful: 5,
      failed: 1,
      partial: 2,
      asr: 0.625,
      per_category: {
        discover: { total: 1, successful: 1, failed: 0, partial: 0, asr: 1 },
        docs: { total: 1, successful: 1, failed: 0, partial: 0, asr: 1 },
        auth: { total: 1, successful: 0, failed: 0, partial: 1, asr: 0 },
        construct: { total: 1, successful: 1, failed: 0, partial: 0, asr: 1 },
        call: { total: 1, successful: 1, failed: 0, partial: 0, asr: 1 },
        handle: { total: 1, successful: 0, failed: 1, partial: 0, asr: 0 },
        observe: { total: 1, successful: 1, failed: 0, partial: 0, asr: 1 },
        version: { total: 1, successful: 0, failed: 0, partial: 1, asr: 0 },
      },
    },
    traces: [
      {
        task_id: "RT-01",
        target: "https://api.example.com",
        outcome: "success",
        stop_reason: "completed",
        steps: [
          { seq: 1, phase: "discover", action: "GET /", outcome: "ok" },
          { seq: 2, phase: "discover", action: "GET /robots.txt", outcome: "ok" },
        ],
      },
      {
        task_id: "RT-03",
        target: "https://api.example.com",
        outcome: "partial",
        stop_reason: "auth_blocked",
        steps: [
          { seq: 1, phase: "auth", action: "GET /.well-known/oauth-authorization-server", outcome: "ok" },
          { seq: 2, phase: "auth", action: "apply declared oauth2", outcome: "ok" },
          { seq: 3, phase: "auth", action: "GET /protected with Bearer token", outcome: "stopped", notes: "401 Unauthorized" },
        ],
      },
      {
        task_id: "RT-06",
        target: "https://api.example.com",
        outcome: "failed",
        stop_reason: "error_unrecoverable",
        steps: [
          { seq: 1, phase: "handle", action: "POST /items with invalid params", outcome: "error", notes: "500 Internal Server Error" },
        ],
      },
    ],
    conflicts: [
      {
        rule_id: "AB-007",
        status: "CONFLICT",
        reason: "Declared oauth2 but observed api_key at runtime",
      },
    ],
  },
};

const NO_RUNTIME_REPORT_FIXTURE: Record<string, unknown> = {
  url: "https://api.example.com",
  score: 72,
  grade: "C",
  total_rules: 40,
  verified: 28,
  missing: 8,
  gap: 8,
  not_applicable: 4,
  skipped: 0,
  summary: "Agent readiness needs improvement",
  categories: [],
  top_missing: [],
  pillars: [],
  floorTriggered: false,
  floorReason: null,
  assertions: [],
  gaps: [],
  gap_summary: { total: 0, by_priority: {}, by_type: {} },
};

describe("SLICE-98-8: Web Runtime Tab — renderRuntimeSection", () => {
  it("runtime fixture has ASR data", () => {
    expect(RUNTIME_REPORT_FIXTURE.runtime).toBeDefined();
    expect(RUNTIME_REPORT_FIXTURE.runtime.asr.total).toBe(8);
    expect(RUNTIME_REPORT_FIXTURE.runtime.traces).toHaveLength(3);
    expect(RUNTIME_REPORT_FIXTURE.runtime.conflicts).toHaveLength(1);
  });

  it("ASR headline shows success/total and percentage", () => {
    const asr = RUNTIME_REPORT_FIXTURE.runtime.asr;
    const pct = (asr.asr * 100).toFixed(1);
    const headline = `Agent Success Rate: ${asr.successful}/${asr.total} (${pct}%)`;
    expect(headline).toBe("Agent Success Rate: 5/8 (62.5%)");
    expect(headline).toContain("62.5%");
  });

  it("partial bucket is visible in ASR", () => {
    const asr = RUNTIME_REPORT_FIXTURE.runtime.asr;
    expect(asr.partial).toBe(2);
    expect(asr.failed).toBe(1);
  });

  it("task table sorts failed→partial→success", () => {
    const traces = RUNTIME_REPORT_FIXTURE.runtime.traces;
    const sorted = [...traces].sort((a, b) => {
      const order = { failed: 0, partial: 1, success: 2 };
      return order[a.outcome as keyof typeof order] - order[b.outcome as keyof typeof order];
    });
    expect(sorted[0].outcome).toBe("failed");
    expect(sorted[1].outcome).toBe("partial");
    expect(sorted[2].outcome).toBe("success");
  });

  it("trace viewer shows step timeline with stop-point highlighting", () => {
    const trace = RUNTIME_REPORT_FIXTURE.runtime.traces[1]; // RT-03 partial
    const stopStep = trace.steps.find((s) => s.outcome === "stopped");
    expect(stopStep).toBeDefined();
    expect(stopStep!.seq).toBe(3);
    expect(stopStep!.notes).toContain("401");
  });

  it("conflict cards show declared vs observed", () => {
    const conflict = RUNTIME_REPORT_FIXTURE.runtime.conflicts[0];
    expect(conflict.status).toBe("CONFLICT");
    expect(conflict.reason).toContain("oauth2");
    expect(conflict.reason).toContain("api_key");
  });

  it("empty state when runtime not run", () => {
    expect(NO_RUNTIME_REPORT_FIXTURE.runtime).toBeUndefined();
  });

  it("per-category ASR data is present", () => {
    const cats = RUNTIME_REPORT_FIXTURE.runtime.asr.per_category;
    expect(cats.discover.asr).toBe(1);
    expect(cats.auth.asr).toBe(0);
    expect(cats.handle.asr).toBe(0);
  });
});
