import { describe, it, expect } from "vitest";
import { checkFloor, applyFloorToCategories, type FloorCheckResult } from "../../../src/agent-readiness/scoring/floor-enforcer";
import { DEFAULT_SCORING_CONFIG } from "../../../src/agent-readiness/scoring/scoring-types";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { CategoryScore } from "../../../src/agent-readiness/scoring/scoring-types";

function mockAssertion(
  ruleId: string,
  status: Assertion["status"],
  severity: string = "high",
  category: string = "discovery",
): Assertion & { severity: string; category: string } {
  return {
    rule_id: ruleId,
    rule_version: "1.0.0",
    status,
    evidence: [],
    confidence: 0.9,
    timestamp: new Date().toISOString(),
    reason: "test",
    source_url: null,
    severity,
    category,
  } as any;
}

describe("SLICE-35-4: Floor Enforcer", () => {
  it("all high-severity Discovery rules VERIFIED → floor not triggered", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "high", "discovery"),
      mockAssertion("AB-002", "VERIFIED", "high", "discovery"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggered).toBe(false);
    expect(result.capValue).toBeNull();
  });

  it("one high-severity Discovery rule MISSING → floor triggered, capValue=40", () => {
    const assertions = [
      mockAssertion("AB-001", "VERIFIED", "high", "discovery"),
      mockAssertion("AB-002", "MISSING", "high", "discovery"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggered).toBe(true);
    expect(result.capValue).toBe(40);
  });

  it("one high-severity Documentation rule CONFLICT → floor triggered", () => {
    const assertions = [
      mockAssertion("AB-003", "CONFLICT", "high", "documentation"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggered).toBe(true);
    expect(result.capValue).toBe(40);
  });

  it("high-severity Actionability rule MISSING → floor NOT triggered (not in floorCategories)", () => {
    const assertions = [
      mockAssertion("AB-005", "MISSING", "high", "actionability"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggered).toBe(false);
  });

  it("medium-severity Discovery rule MISSING → floor NOT triggered (not high severity)", () => {
    const assertions = [
      mockAssertion("AB-001", "MISSING", "medium", "discovery"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggered).toBe(false);
  });

  it("triggeringRules contains the correct rule_id(s)", () => {
    const assertions = [
      mockAssertion("AB-001", "MISSING", "high", "discovery"),
      mockAssertion("AB-003", "CONFLICT", "high", "documentation"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggeringRules).toContain("AB-001");
    expect(result.triggeringRules).toContain("AB-003");
    expect(result.triggeringRules).toHaveLength(2);
  });

  it("triggeringCategories contains affected categories", () => {
    const assertions = [
      mockAssertion("AB-001", "MISSING", "high", "discovery"),
      mockAssertion("AB-003", "MISSING", "high", "documentation"),
    ];
    const result = checkFloor(assertions, DEFAULT_SCORING_CONFIG);
    expect(result.triggeringCategories).toContain("discovery");
    expect(result.triggeringCategories).toContain("documentation");
  });

  it("applyFloorToCategories marks affected categories", () => {
    const floorCheck: FloorCheckResult = {
      triggered: true,
      capValue: 40,
      triggeringRules: ["AB-001"],
      triggeringCategories: ["discovery"],
    };
    const categoryScores: CategoryScore[] = [
      { category: "discovery", weight: 25, rawScore: 80, score: 80, ruleCount: 5, applicableCount: 5, floorTriggered: false },
      { category: "documentation", weight: 25, rawScore: 90, score: 90, ruleCount: 3, applicableCount: 3, floorTriggered: false },
    ];
    const result = applyFloorToCategories(categoryScores, floorCheck);
    expect(result[0].floorTriggered).toBe(true);
    expect(result[1].floorTriggered).toBe(false);
  });

  it("applyFloorToCategories does nothing when floor not triggered", () => {
    const floorCheck: FloorCheckResult = {
      triggered: false,
      capValue: null,
      triggeringRules: [],
      triggeringCategories: [],
    };
    const categoryScores: CategoryScore[] = [
      { category: "discovery", weight: 25, rawScore: 80, score: 80, ruleCount: 5, applicableCount: 5, floorTriggered: false },
    ];
    const result = applyFloorToCategories(categoryScores, floorCheck);
    expect(result[0].floorTriggered).toBe(false);
  });

  it("empty assertions → floor not triggered", () => {
    const result = checkFloor([], DEFAULT_SCORING_CONFIG);
    expect(result.triggered).toBe(false);
  });
});
