import { describe, it, expect } from "vitest";
import type { ScanReport, RuntimeReportData } from "../../../src/agent-readiness/report-formatter";

/**
 * SLICE-98-9: Runtime payload contract — validates against spec v0.6 A.7.
 *
 * Verifies that RuntimeReportData shape is schema-stable:
 * - asr block: total, successful, failed, partial, asr (0..1), per_category
 * - traces: task_id, target, outcome, stop_reason, steps[]
 * - conflicts: rule_id, status, reason
 */

const VALID_RUNTIME: RuntimeReportData = {
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
        { seq: 1, phase: "discover", action: "GET /llms.txt", outcome: "ok" },
      ],
    },
  ],
  conflicts: [
    { rule_id: "AB-007", status: "CONFLICT", reason: "Declared oauth2 but observed api_key" },
  ],
};

describe("SLICE-98-9: Runtime payload contract (spec v0.6 A.7)", () => {
  it("asr block has required fields with correct types", () => {
    const asr = VALID_RUNTIME.asr;
    expect(typeof asr.total).toBe("number");
    expect(typeof asr.successful).toBe("number");
    expect(typeof asr.failed).toBe("number");
    expect(typeof asr.partial).toBe("number");
    expect(typeof asr.asr).toBe("number");
    expect(asr.asr).toBeGreaterThanOrEqual(0);
    expect(asr.asr).toBeLessThanOrEqual(1);
  });

  it("asr counts are consistent: successful + failed + partial = total", () => {
    const asr = VALID_RUNTIME.asr;
    expect(asr.successful + asr.failed + asr.partial).toBe(asr.total);
  });

  it("per_category has 8 categories", () => {
    const cats = VALID_RUNTIME.asr.per_category;
    const expected = ["discover", "docs", "auth", "construct", "call", "handle", "observe", "version"];
    for (const cat of expected) {
      expect(cats[cat]).toBeDefined();
      expect(cats[cat].total).toBe(1);
      expect(cats[cat].successful + cats[cat].failed + cats[cat].partial).toBe(cats[cat].total);
    }
  });

  it("traces have required fields", () => {
    for (const trace of VALID_RUNTIME.traces) {
      expect(typeof trace.task_id).toBe("string");
      expect(typeof trace.target).toBe("string");
      expect(typeof trace.outcome).toBe("string");
      expect(typeof trace.stop_reason).toBe("string");
      expect(Array.isArray(trace.steps)).toBe(true);
    }
  });

  it("trace steps have required fields", () => {
    for (const trace of VALID_RUNTIME.traces) {
      for (const step of trace.steps) {
        expect(typeof step.seq).toBe("number");
        expect(typeof step.phase).toBe("string");
        expect(typeof step.action).toBe("string");
        expect(typeof step.outcome).toBe("string");
      }
    }
  });

  it("conflicts have required fields", () => {
    for (const conflict of VALID_RUNTIME.conflicts) {
      expect(typeof conflict.rule_id).toBe("string");
      expect(typeof conflict.status).toBe("string");
      expect(typeof conflict.reason).toBe("string");
    }
  });

  it("ScanReport.runtime is optional", () => {
    const reportWithoutRuntime: ScanReport = {
      url: "https://example.com",
      score: 50,
      grade: "D",
      total_rules: 10,
      verified: 5,
      missing: 5,
      gap: 5,
      not_applicable: 0,
      skipped: 0,
      categories: [],
      top_missing: [],
      summary: "test",
      pillars: [],
      floorTriggered: false,
      floorReason: null,
      assertions: [],
      gaps: [],
      gap_summary: { total: 0, by_priority: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 }, by_type: { documentation: 0, semantic: 0, capability: 0, evidence: 0 } },
    };
    expect(reportWithoutRuntime.runtime).toBeUndefined();

    const reportWithRuntime: ScanReport = { ...reportWithoutRuntime, runtime: VALID_RUNTIME };
    expect(reportWithRuntime.runtime).toBeDefined();
    expect(reportWithRuntime.runtime!.asr.total).toBe(8);
  });
});
