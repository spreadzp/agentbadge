import { describe, it, expect } from "vitest";
import { computeTotalScore } from "../../../src/agent-readiness/scoring/total-scorer";
import type { CategoryScore } from "../../../src/agent-readiness/scoring/scoring-types";
import type { FloorCheckResult } from "../../../src/agent-readiness/scoring/floor-enforcer";

function mockCategoryScore(category: string, score: number, weight: number): CategoryScore {
  return {
    category: category as any,
    weight,
    rawScore: score,
    score,
    ruleCount: 5,
    applicableCount: 5,
    floorTriggered: false,
  };
}

const noFloor: FloorCheckResult = {
  triggered: false,
  capValue: null,
  triggeringRules: [],
  triggeringCategories: [],
};

const floor40: FloorCheckResult = {
  triggered: true,
  capValue: 40,
  triggeringRules: ["AB-001"],
  triggeringCategories: ["discovery"],
};

describe("SLICE-35-5: Total Scorer", () => {
  it("all categories at 100, weights sum to 100 → rawScore = 100, score = 100", () => {
    const cats = [
      mockCategoryScore("discovery", 100, 25),
      mockCategoryScore("documentation", 100, 25),
      mockCategoryScore("actionability", 100, 20),
      mockCategoryScore("machine_readable", 100, 20),
      mockCategoryScore("verification", 100, 10),
    ];
    const result = computeTotalScore(cats, noFloor);
    expect(result.rawScore).toBe(100);
    expect(result.score).toBe(100);
  });

  it("floor triggered, rawScore = 85, capValue = 40 → score = 40, floorTriggered = true", () => {
    const cats = [
      mockCategoryScore("discovery", 80, 25),
      mockCategoryScore("documentation", 90, 25),
      mockCategoryScore("actionability", 80, 20),
      mockCategoryScore("machine_readable", 90, 20),
      mockCategoryScore("verification", 80, 10),
    ];
    const result = computeTotalScore(cats, floor40);
    expect(result.rawScore).toBe(84.5);
    expect(result.score).toBe(40);
    expect(result.floorTriggered).toBe(true);
  });

  it("floor triggered, rawScore = 30, capValue = 40 → score = 30, floorTriggered = false", () => {
    const cats = [
      mockCategoryScore("discovery", 30, 25),
      mockCategoryScore("documentation", 30, 25),
      mockCategoryScore("actionability", 30, 20),
      mockCategoryScore("machine_readable", 30, 20),
      mockCategoryScore("verification", 30, 10),
    ];
    const result = computeTotalScore(cats, floor40);
    expect(result.rawScore).toBe(30);
    expect(result.score).toBe(30);
    expect(result.floorTriggered).toBe(false);
  });

  it("floor not triggered, rawScore = 75 → score = 75, floorTriggered = false", () => {
    const cats = [
      mockCategoryScore("discovery", 80, 25),
      mockCategoryScore("documentation", 80, 25),
      mockCategoryScore("actionability", 70, 20),
      mockCategoryScore("machine_readable", 70, 20),
      mockCategoryScore("verification", 70, 10),
    ];
    const result = computeTotalScore(cats, noFloor);
    expect(result.rawScore).toBe(75);
    expect(result.score).toBe(75);
    expect(result.floorTriggered).toBe(false);
  });

  it("empty categories → rawScore = 0, score = 0", () => {
    const result = computeTotalScore([], noFloor);
    expect(result.rawScore).toBe(0);
    expect(result.score).toBe(0);
  });

  it("rawScore is always the pre-cap value", () => {
    const cats = [
      mockCategoryScore("discovery", 80, 25),
      mockCategoryScore("documentation", 90, 25),
    ];
    const result = computeTotalScore(cats, floor40);
    expect(result.rawScore).toBeGreaterThan(result.score);
    expect(result.rawScore).toBe(42.5);
  });

  it("floorReason is set when floor cap applied", () => {
    const cats = [
      mockCategoryScore("discovery", 80, 25),
      mockCategoryScore("documentation", 90, 25),
    ];
    const result = computeTotalScore(cats, floor40);
    expect(result.floorReason).toBeTruthy();
    expect(result.floorReason).toContain("AB-001");
  });

  it("floorReason is null when no floor", () => {
    const cats = [mockCategoryScore("discovery", 80, 25)];
    const result = computeTotalScore(cats, noFloor);
    expect(result.floorReason).toBeNull();
  });
});
