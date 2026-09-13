import { describe, it, expect } from "vitest";
import {
  detectRegressions,
  gapIdsFromSummary,
  DEFAULT_THRESHOLDS,
  type RegressionInput,
} from "../../../src/agent-readiness/monitoring/regression";
import type { RunSummary, RunRecord } from "../../../src/agent-readiness/monitoring/monitoring-types";

/**
 * SLICE-99-9: Golden regression vectors — frozen from 99-5.
 * Zero-drift anchors: threshold constants + hand-computed vectors.
 * Any change to defaults or logic breaks these tests.
 */

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
    rule_statuses: { "AB-001": "GAP", "AB-002": "VERIFIED", "AB-003": "GAP" },
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

const baseInput: RegressionInput = {
  prev: makeRun(makeSummary()),
  now: makeRun(makeSummary()),
  history: [],
  thresholds: DEFAULT_THRESHOLDS,
};

describe("SLICE-99-9: Golden threshold constants (zero-drift)", () => {
  it("DEFAULT_THRESHOLDS.score_drop === 5 (spec §10.3)", () => {
    expect(DEFAULT_THRESHOLDS.score_drop).toBe(5);
  });

  it("DEFAULT_THRESHOLDS.asr_drop === 0.1 (spec §10.3)", () => {
    expect(DEFAULT_THRESHOLDS.asr_drop).toBe(0.1);
  });

  it("DEFAULT_THRESHOLDS.cooldown_hours === 24 (spec §10.4)", () => {
    expect(DEFAULT_THRESHOLDS.cooldown_hours).toBe(24);
  });

  it("DEFAULT_THRESHOLDS.min_severity === 'warning' (spec §10.4)", () => {
    expect(DEFAULT_THRESHOLDS.min_severity).toBe("warning");
  });
});

describe("SLICE-99-9: Golden regression vectors (frozen)", () => {
  it("G1: identical summaries → null (noop)", () => {
    expect(detectRegressions(baseInput)).toBeNull();
  });

  it("G2: score drop 7 ≥ 5 → warning", () => {
    const r = detectRegressions({ ...baseInput, now: makeRun(makeSummary({ score: 65 })) });
    const item = r!.findings.find((f) => f.rule === "score_drop");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("warning");
    expect(item!.delta).toEqual({ prev: 72, curr: 65, drop: 7 });
  });

  it("G3: score drop 4 < 5 → no item", () => {
    const r = detectRegressions({ ...baseInput, now: makeRun(makeSummary({ score: 68 })) });
    expect(r?.findings.find((f) => f.rule === "score_drop")).toBeUndefined();
  });

  it("G4: new gap (not in history) → new_gap", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001"] })),
      now: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-003"] })),
      history: ["gap-001"],
    });
    expect(r!.findings.find((f) => f.rule === "new_gap" && f.gap_id === "gap-003")).toBeDefined();
    expect(r!.findings.find((f) => f.rule === "reopened_gap" && f.gap_id === "gap-003")).toBeUndefined();
  });

  it("G5: reopened gap (in history) → reopened_gap, not new_gap", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001"] })),
      now: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-002"] })),
      history: ["gap-001", "gap-002"],
    });
    expect(r!.findings.find((f) => f.rule === "reopened_gap" && f.gap_id === "gap-002")).toBeDefined();
    expect(r!.findings.find((f) => f.rule === "new_gap" && f.gap_id === "gap-002")).toBeUndefined();
  });

  it("G6: status flip VERIFIED→GAP → warning", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ rule_statuses: { "AB-001": "VERIFIED", "AB-002": "VERIFIED" } })),
      now: makeRun(makeSummary({ rule_statuses: { "AB-001": "GAP", "AB-002": "VERIFIED" } })),
    });
    const item = r!.findings.find((f) => f.rule === "status_flip" && f.rule_id === "AB-001");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("warning");
    expect(item!.delta).toEqual({ prev: "VERIFIED", curr: "GAP" });
  });

  it("G7: new conflict → info", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ rule_statuses: { "AB-001": "VERIFIED" } })),
      now: makeRun(makeSummary({ rule_statuses: { "AB-001": "CONFLICT" } })),
    });
    const item = r!.findings.find((f) => f.rule === "new_conflict" && f.rule_id === "AB-001");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("info");
  });

  it("G8: ASR drop 0.15 ≥ 0.1 → warning", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ asr: 0.9 })),
      now: makeRun(makeSummary({ asr: 0.75 })),
    });
    const item = r!.findings.find((f) => f.rule === "asr_drop");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("warning");
  });

  it("G9: ASR drop 0.05 < 0.1 → no item", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ asr: 0.9 })),
      now: makeRun(makeSummary({ asr: 0.85 })),
    });
    expect(r?.findings.find((f) => f.rule === "asr_drop")).toBeUndefined();
  });

  it("G10: ASR absent → no asr_drop item", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ asr: null })),
      now: makeRun(makeSummary({ asr: 0.5 })),
    });
    expect(r?.findings.find((f) => f.rule === "asr_drop")).toBeUndefined();
  });

  it("G11: prev outcome=error → null", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ score: 0 }), "error"),
      now: makeRun(makeSummary({ score: 72 })),
    });
    expect(r).toBeNull();
  });

  it("G12: now outcome=error → null", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({ score: 72 })),
      now: makeRun(makeSummary({ score: 0 }), "error"),
    });
    expect(r).toBeNull();
  });

  it("G13: deterministic ordering — rule type then id", () => {
    const r = detectRegressions({
      ...baseInput,
      prev: makeRun(makeSummary({
        score: 80, gap_ids: ["gap-001"],
        rule_statuses: { "AB-001": "VERIFIED", "AB-002": "VERIFIED" },
        asr: 0.9,
      })),
      now: makeRun(makeSummary({
        score: 70, gap_ids: ["gap-001", "gap-003"],
        rule_statuses: { "AB-001": "GAP", "AB-002": "CONFLICT" },
        asr: 0.7,
      })),
      history: ["gap-001"],
    });
    const rules = r!.findings.map((f) => f.rule);
    expect(rules).toEqual([...rules].sort());
  });

  it("G14: gapIdsFromSummary extracts ids", () => {
    expect(gapIdsFromSummary(makeSummary())).toEqual(["gap-001", "gap-002"]);
  });

  it("G15: gapIdsFromSummary empty when undefined", () => {
    expect(gapIdsFromSummary(makeSummary({ gap_ids: undefined }))).toEqual([]);
  });
});
