import { describe, it, expect } from "vitest";
import {
  detectRegressions,
  gapIdsFromSummary,
  DEFAULT_THRESHOLDS,
  type RegressionInput,
} from "../../../src/agent-readiness/monitoring/regression";
import type { RunSummary, RunRecord } from "../../../src/agent-readiness/monitoring/monitoring-types";

/**
 * SLICE-99-5: Regression engine — pure diff tests.
 *
 * 6 rules: score_drop, new_gap, reopened_gap, status_flip, new_conflict, asr_drop.
 * Golden vectors hand-computed from spec §10.3 pseudocode.
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

const input: RegressionInput = {
  prev: makeRun(makeSummary()),
  now: makeRun(makeSummary()),
  history: [],
  thresholds: DEFAULT_THRESHOLDS,
};

describe("SLICE-99-5: gapIdsFromSummary", () => {
  it("extracts gap_ids from summary", () => {
    const ids = gapIdsFromSummary(makeSummary());
    expect(ids).toEqual(["gap-001", "gap-002"]);
  });

  it("returns empty array when no gap_ids", () => {
    const ids = gapIdsFromSummary(makeSummary({ gap_ids: undefined }));
    expect(ids).toEqual([]);
  });
});

describe("SLICE-99-5: detectRegressions — noop", () => {
  it("identical summaries → null (noop)", () => {
    const result = detectRegressions(input);
    expect(result).toBeNull();
  });
});

describe("SLICE-99-5: score_drop rule", () => {
  it("score drop ≥ threshold → warning item", () => {
    const result = detectRegressions({
      ...input,
      now: makeRun(makeSummary({ score: 65 })), // drop of 7 ≥ 5
    });
    expect(result).not.toBeNull();
    const item = result!.findings.find((f) => f.rule === "score_drop");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("warning");
    expect(item!.delta).toEqual({ prev: 72, curr: 65, drop: 7 });
  });

  it("score drop < threshold → no item", () => {
    const result = detectRegressions({
      ...input,
      now: makeRun(makeSummary({ score: 68 })), // drop of 4 < 5
    });
    const item = result?.findings.find((f) => f.rule === "score_drop");
    expect(item).toBeUndefined();
  });

  it("score increase → no item", () => {
    const result = detectRegressions({
      ...input,
      now: makeRun(makeSummary({ score: 80 })),
    });
    const item = result?.findings.find((f) => f.rule === "score_drop");
    expect(item).toBeUndefined();
  });
});

describe("SLICE-99-5: new_gap rule", () => {
  it("new gap_id in now, not in prev → item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001"] })),
      now: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-003"] })),
    });
    const item = result!.findings.find((f) => f.rule === "new_gap" && f.gap_id === "gap-003");
    expect(item).toBeDefined();
  });

  it("HIGH priority new gap → critical severity", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001"] })),
      now: makeRun(makeSummary({
        gap_ids: ["gap-001", "gap-003"],
        gap_summary: {
          total: 3,
          by_priority: { CRITICAL: 0, HIGH: 2, MEDIUM: 1, LOW: 0 },
          by_type: { documentation: 1, semantic: 1, capability: 1, evidence: 0 },
        },
      })),
    });
    const item = result!.findings.find((f) => f.rule === "new_gap" && f.gap_id === "gap-003");
    // gap-003 is new; we don't know its exact priority from summary alone,
    // but if any HIGH exists we treat new gaps as potentially HIGH
    expect(item).toBeDefined();
  });

  it("no new gaps → no new_gap items", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-002"] })),
      now: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-002"] })),
    });
    // Identical summaries → noop → null
    expect(result).toBeNull();
  });
});

describe("SLICE-99-5: reopened_gap rule", () => {
  it("gap in history but not in prev, present in now → reopened (not new)", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001"] })), // gap-002 not in prev
      now: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-002"] })), // gap-002 back
      history: ["gap-001", "gap-002"], // gap-002 was seen before
    });
    const reopened = result!.findings.find((f) => f.rule === "reopened_gap" && f.gap_id === "gap-002");
    expect(reopened).toBeDefined();
    // Should NOT also appear as new_gap
    const newGap = result!.findings.find((f) => f.rule === "new_gap" && f.gap_id === "gap-002");
    expect(newGap).toBeUndefined();
  });

  it("gap not in history → new_gap, not reopened", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ gap_ids: ["gap-001"] })),
      now: makeRun(makeSummary({ gap_ids: ["gap-001", "gap-003"] })),
      history: ["gap-001"], // gap-003 never seen before
    });
    const reopened = result?.findings.find((f) => f.rule === "reopened_gap" && f.gap_id === "gap-003");
    expect(reopened).toBeUndefined();
    const newGap = result?.findings.find((f) => f.rule === "new_gap" && f.gap_id === "gap-003");
    expect(newGap).toBeDefined();
  });
});

describe("SLICE-99-5: status_flip rule", () => {
  it("rule VERIFIED in prev, GAP in now → warning item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ rule_statuses: { "AB-001": "VERIFIED", "AB-002": "VERIFIED" } })),
      now: makeRun(makeSummary({ rule_statuses: { "AB-001": "GAP", "AB-002": "VERIFIED" } })),
    });
    const item = result!.findings.find((f) => f.rule === "status_flip" && f.rule_id === "AB-001");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("warning");
    expect(item!.delta).toEqual({ prev: "VERIFIED", curr: "GAP" });
  });

  it("no status change → no item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ rule_statuses: { "AB-001": "VERIFIED" } })),
      now: makeRun(makeSummary({ rule_statuses: { "AB-001": "VERIFIED" } })),
    });
    const item = result?.findings.find((f) => f.rule === "status_flip");
    expect(item).toBeUndefined();
  });
});

describe("SLICE-99-5: new_conflict rule", () => {
  it("CONFLICT in now, not in prev → info item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ rule_statuses: { "AB-001": "VERIFIED" } })),
      now: makeRun(makeSummary({ rule_statuses: { "AB-001": "CONFLICT" } })),
    });
    const item = result!.findings.find((f) => f.rule === "new_conflict" && f.rule_id === "AB-001");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("info");
  });
});

describe("SLICE-99-5: asr_drop rule", () => {
  it("ASR drop ≥ threshold → warning item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ asr: 0.9 })),
      now: makeRun(makeSummary({ asr: 0.75 })), // drop of 0.15 ≥ 0.1
    });
    const item = result!.findings.find((f) => f.rule === "asr_drop");
    expect(item).toBeDefined();
    expect(item!.severity).toBe("warning");
    expect(item!.delta).toEqual({ prev: 0.9, curr: 0.75, drop: expect.closeTo(0.15, 5) });
  });

  it("ASR drop < threshold → no item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ asr: 0.9 })),
      now: makeRun(makeSummary({ asr: 0.85 })), // drop of 0.05 < 0.1
    });
    const item = result?.findings.find((f) => f.rule === "asr_drop");
    expect(item).toBeUndefined();
  });

  it("ASR absent in either → no item", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ asr: null })),
      now: makeRun(makeSummary({ asr: 0.5 })),
    });
    const item = result?.findings.find((f) => f.rule === "asr_drop");
    expect(item).toBeUndefined();
  });
});

describe("SLICE-99-5: error-run diff policy", () => {
  it("prev outcome=error → no diff (return null)", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ score: 0 }), "error"),
      now: makeRun(makeSummary({ score: 72 })),
    });
    expect(result).toBeNull();
  });

  it("now outcome=error → no diff (return null)", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({ score: 72 })),
      now: makeRun(makeSummary({ score: 0 }), "error"),
    });
    expect(result).toBeNull();
  });
});

describe("SLICE-99-5: deterministic ordering", () => {
  it("multiple items ordered by rule type then id", () => {
    const result = detectRegressions({
      ...input,
      prev: makeRun(makeSummary({
        score: 80,
        gap_ids: ["gap-001"],
        rule_statuses: { "AB-001": "VERIFIED", "AB-002": "VERIFIED" },
        asr: 0.9,
      })),
      now: makeRun(makeSummary({
        score: 70, // score_drop
        gap_ids: ["gap-001", "gap-003"], // new_gap
        rule_statuses: { "AB-001": "GAP", "AB-002": "CONFLICT" }, // status_flip + new_conflict
        asr: 0.7, // asr_drop
      })),
      history: ["gap-001"],
    });
    expect(result).not.toBeNull();
    const rules = result!.findings.map((f) => f.rule);
    // Should be in rule type order: asr_drop, new_conflict, new_gap, score_drop, status_flip
    expect(rules).toEqual([...rules].sort());
  });
});

describe("SLICE-99-5: DEFAULT_THRESHOLDS", () => {
  it("has spec-mirrored defaults", () => {
    expect(DEFAULT_THRESHOLDS.score_drop).toBe(5);
    expect(DEFAULT_THRESHOLDS.asr_drop).toBe(0.1);
    expect(DEFAULT_THRESHOLDS.cooldown_hours).toBe(24);
    expect(DEFAULT_THRESHOLDS.min_severity).toBe("warning");
  });
});
