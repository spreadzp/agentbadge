import { describe, it, expect } from "vitest";
import { computeDelta } from "../../../src/agent-readiness/scoring/delta-computer";
import { DEFAULT_SCORING_CONFIG } from "../../../src/agent-readiness/scoring/scoring-types";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { ScoreResult } from "../../../src/agent-readiness/scoring/scoring-types";

function mockAssertion(
  ruleId: string,
  status: Assertion["status"],
  category: string = "discovery",
): Assertion & { category: string } {
  return {
    rule_id: ruleId,
    rule_version: "1.0.0",
    status,
    evidence: [],
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    reason: "test",
    source_url: null,
    category,
  } as any;
}

function mockScoreResult(score: number): ScoreResult {
  return {
    total: { rawScore: score, score, floorTriggered: false, floorReason: null },
    categories: {} as any,
    delta: null,
    config: DEFAULT_SCORING_CONFIG,
    computedAt: new Date().toISOString(),
  };
}

describe("SLICE-35-6: Delta Computer", () => {
  it("same assertions → totalDelta = 0, items = []", () => {
    const assertions = [mockAssertion("AB-001", "VERIFIED")];
    const result = computeDelta(
      assertions,
      assertions,
      mockScoreResult(80),
      mockScoreResult(80),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.totalDelta).toBe(0);
    expect(result.items).toHaveLength(0);
  });

  it("one rule VERIFIED→MISSING → negative scoreImpact, totalDelta < 0", () => {
    const current = [mockAssertion("AB-001", "MISSING")];
    const previous = [mockAssertion("AB-001", "VERIFIED")];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(60),
      mockScoreResult(80),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.totalDelta).toBe(-20);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].scoreImpact).toBeLessThan(0);
    expect(result.items[0].previousStatus).toBe("VERIFIED");
    expect(result.items[0].currentStatus).toBe("MISSING");
  });

  it("one rule MISSING→VERIFIED → positive scoreImpact, totalDelta > 0", () => {
    const current = [mockAssertion("AB-001", "VERIFIED")];
    const previous = [mockAssertion("AB-001", "MISSING")];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(80),
      mockScoreResult(60),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.totalDelta).toBe(20);
    expect(result.items).toHaveLength(1);
    expect(result.items[0].scoreImpact).toBeGreaterThan(0);
  });

  it("new rule in current (not in previous) → no delta item for that rule", () => {
    const current = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "VERIFIED"),
    ];
    const previous = [mockAssertion("AB-001", "VERIFIED")];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(80),
      mockScoreResult(80),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.items).toHaveLength(0);
  });

  it("rule removed from current (in previous) → no delta item", () => {
    const current = [mockAssertion("AB-001", "VERIFIED")];
    const previous = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "VERIFIED"),
    ];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(80),
      mockScoreResult(80),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.items).toHaveLength(0);
  });

  it("NOT_APPLICABLE→VERIFIED → positive impact", () => {
    const current = [mockAssertion("AB-001", "VERIFIED")];
    const previous = [mockAssertion("AB-001", "NOT_APPLICABLE")];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(80),
      mockScoreResult(60),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.items).toHaveLength(1);
    expect(result.items[0].scoreImpact).toBeGreaterThan(0);
  });

  it("statusChanges array is populated from items", () => {
    const current = [mockAssertion("AB-001", "VERIFIED")];
    const previous = [mockAssertion("AB-001", "MISSING")];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(80),
      mockScoreResult(60),
      DEFAULT_SCORING_CONFIG,
    );
    expect(result.statusChanges).toHaveLength(1);
    expect(result.statusChanges[0].ruleId).toBe("AB-001");
    expect(result.statusChanges[0].from).toBe("MISSING");
    expect(result.statusChanges[0].to).toBe("VERIFIED");
  });

  it("scoreImpact is rounded to 2 decimal places", () => {
    const current = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "VERIFIED"),
      mockAssertion("AB-003", "VERIFIED"),
    ];
    const previous = [
      mockAssertion("AB-001", "MISSING"),
      mockAssertion("AB-002", "MISSING"),
      mockAssertion("AB-003", "MISSING"),
    ];
    const result = computeDelta(
      current,
      previous,
      mockScoreResult(80),
      mockScoreResult(60),
      DEFAULT_SCORING_CONFIG,
    );
    for (const item of result.items) {
      const decimals = item.scoreImpact.toString().split(".")[1]?.length ?? 0;
      expect(decimals).toBeLessThanOrEqual(2);
    }
  });
});
