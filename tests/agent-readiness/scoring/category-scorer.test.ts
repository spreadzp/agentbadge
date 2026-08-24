import { describe, it, expect } from "vitest";
import { scoreCategory, roundTo2 } from "../../../src/agent-readiness/scoring/category-scorer";
import { DEFAULT_SCORING_CONFIG } from "../../../src/agent-readiness/scoring/scoring-types";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

function mockAssertion(ruleId: string, status: Assertion["status"]): Assertion {
  return {
    rule_id: ruleId,
    rule_version: "1.0.0",
    status,
    evidence: [],
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    reason: "test",
    source_url: null,
  };
}

describe("SLICE-35-3: Category Scorer", () => {
  it("all VERIFIED → score 100", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "VERIFIED"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(100);
    expect(result.rawScore).toBe(100);
  });

  it("all MISSING → score 0", () => {
    const assertions = [
      mockAssertion("AB-001", "MISSING"),
      mockAssertion("AB-002", "MISSING"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(0);
  });

  it("50% VERIFIED, 50% MISSING → score 50", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "MISSING"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(50);
  });

  it("1 VERIFIED, 1 NOT_APPLICABLE → score 100 (NA excluded from denominator)", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "NOT_APPLICABLE"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(100);
    expect(result.applicableCount).toBe(1);
    expect(result.ruleCount).toBe(2);
  });

  it("1 INFERRED, 1 VERIFIED → score 85 (70+100)/2", () => {
    const assertions = [
      mockAssertion("AB-001", "INFERRED"),
      mockAssertion("AB-002", "VERIFIED"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(85);
  });

  it("empty assertions → score 0", () => {
    const result = scoreCategory("discovery", [], DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(0);
    expect(result.ruleCount).toBe(0);
    expect(result.applicableCount).toBe(0);
  });

  it("floorTriggered is always false from scoreCategory", () => {
    const assertions = [mockAssertion("AB-001", "VERIFIED")];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.floorTriggered).toBe(false);
  });

  it("weight comes from config", () => {
    const result = scoreCategory("verification", [], DEFAULT_SCORING_CONFIG);
    expect(result.weight).toBe(5);
  });

  it("score is rounded to 2 decimal places", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED"),
      mockAssertion("AB-002", "VERIFIED"),
      mockAssertion("AB-003", "INFERRED"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    // (100 + 100 + 70) / 3 = 90.0
    expect(result.score).toBe(90);
    expect(result.score.toString().split(".")[1]?.length ?? 0).toBeLessThanOrEqual(2);
  });

  it("roundTo2 helper works correctly", () => {
    expect(roundTo2(33.333)).toBe(33.33);
    expect(roundTo2(66.666)).toBe(66.67);
    expect(roundTo2(0)).toBe(0);
    expect(roundTo2(100)).toBe(100);
  });

  it("all CONFLICT → score 0", () => {
    const assertions = [
      mockAssertion("AB-001", "CONFLICT"),
      mockAssertion("AB-002", "CONFLICT"),
    ];
    const result = scoreCategory("discovery", assertions, DEFAULT_SCORING_CONFIG);
    expect(result.score).toBe(0);
  });
});
