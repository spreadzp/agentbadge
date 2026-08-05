import { describe, it, expect } from "vitest";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import {
  allVerified,
  allMissing,
  floorTriggered,
  mixedStatus,
  deltaPrevious,
  deltaCurrent,
  emptyAssertions,
  allNotApplicable,
  singleAssertion,
} from "../../fixtures/scoring";

const mockManifest = {
  name: "agent-readiness",
  version: "1.2.0",
  categoryWeights: {
    discovery: 25,
    documentation: 25,
    actionability: 20,
    machine_readable: 20,
    verification: 10,
  },
};

describe("SLICE-35-10: Scoring Engine Integration", () => {
  describe("all-verified fixture", () => {
    it("total score = 100, no floor triggered", () => {
      const result = runScoringEngine({
        assertions: allVerified,
        rulesetManifest: mockManifest,
      });
      expect(result.total.score).toBe(100);
      expect(result.total.floorTriggered).toBe(false);
    });

    it("all categories score 100", () => {
      const result = runScoringEngine({
        assertions: allVerified,
        rulesetManifest: mockManifest,
      });
      for (const key of Object.keys(result.categories)) {
        expect(result.categories[key as keyof typeof result.categories].score).toBe(100);
      }
    });
  });

  describe("all-missing fixture", () => {
    it("total score = 0, floor not applied (0 < 40)", () => {
      const result = runScoringEngine({
        assertions: allMissing,
        rulesetManifest: mockManifest,
      });
      expect(result.total.score).toBe(0);
      expect(result.total.floorTriggered).toBe(false);
    });
  });

  describe("floor-triggered fixture", () => {
    it("total score capped at 40, floorTriggered = true", () => {
      const result = runScoringEngine({
        assertions: floorTriggered,
        rulesetManifest: mockManifest,
      });
      expect(result.total.floorTriggered).toBe(true);
      expect(result.total.score).toBe(40);
    });

    it("rawScore > 40 (pre-cap value preserved)", () => {
      const result = runScoringEngine({
        assertions: floorTriggered,
        rulesetManifest: mockManifest,
      });
      expect(result.total.rawScore).toBeGreaterThan(40);
    });
  });

  describe("mixed-status fixture", () => {
    it("produces valid category scores", () => {
      const result = runScoringEngine({
        assertions: mixedStatus,
        rulesetManifest: mockManifest,
      });
      expect(result.total.score).toBeGreaterThan(0);
      expect(result.total.score).toBeLessThan(100);
    });

    it("NOT_APPLICABLE excluded from denominator (verification category)", () => {
      const result = runScoringEngine({
        assertions: mixedStatus,
        rulesetManifest: mockManifest,
      });
      const verification = result.categories.verification;
      expect(verification).toBeDefined();
      expect(verification.applicableCount).toBeLessThan(verification.ruleCount);
    });

    it("floor not triggered (no high MISSING in discovery/documentation)", () => {
      const result = runScoringEngine({
        assertions: mixedStatus,
        rulesetManifest: mockManifest,
      });
      expect(result.total.floorTriggered).toBe(false);
    });
  });

  describe("delta computation", () => {
    it("produces correct delta items", () => {
      const previousResult = runScoringEngine({
        assertions: deltaPrevious,
        rulesetManifest: mockManifest,
      });
      const currentResult = runScoringEngine({
        assertions: deltaCurrent,
        rulesetManifest: mockManifest,
        previousResult,
        previousAssertions: deltaPrevious,
      });
      expect(currentResult.delta).not.toBeNull();
      expect(currentResult.delta!.items.length).toBeGreaterThan(0);
      expect(currentResult.delta!.totalDelta).toBeDefined();
    });

    it("delta has 3 changed rules (AB-001, AB-004, AB-009)", () => {
      const previousResult = runScoringEngine({
        assertions: deltaPrevious,
        rulesetManifest: mockManifest,
      });
      const currentResult = runScoringEngine({
        assertions: deltaCurrent,
        rulesetManifest: mockManifest,
        previousResult,
        previousAssertions: deltaPrevious,
      });
      const changedIds = currentResult.delta!.items.map((i) => i.ruleId);
      expect(changedIds).toContain("AB-001");
      expect(changedIds).toContain("AB-004");
      expect(changedIds).toContain("AB-009");
    });

    it("current result has floor triggered (AB-004 high MISSING in documentation)", () => {
      const previousResult = runScoringEngine({
        assertions: deltaPrevious,
        rulesetManifest: mockManifest,
      });
      const currentResult = runScoringEngine({
        assertions: deltaCurrent,
        rulesetManifest: mockManifest,
        previousResult,
        previousAssertions: deltaPrevious,
      });
      expect(currentResult.total.floorTriggered).toBe(true);
    });
  });

  describe("edge cases", () => {
    it("empty assertions → score 0, no crash", () => {
      const result = runScoringEngine({
        assertions: emptyAssertions,
        rulesetManifest: mockManifest,
      });
      expect(result.total.score).toBe(0);
    });

    it("all NOT_APPLICABLE → score 0, no crash", () => {
      const result = runScoringEngine({
        assertions: allNotApplicable,
        rulesetManifest: mockManifest,
      });
      expect(result.total.score).toBe(0);
    });

    it("single assertion → valid result", () => {
      const result = runScoringEngine({
        assertions: singleAssertion,
        rulesetManifest: mockManifest,
      });
      expect(result.categories.discovery).toBeDefined();
      expect(result.categories.discovery.score).toBe(100);
    });
  });
});
