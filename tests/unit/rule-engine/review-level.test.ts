import { describe, it, expect } from "vitest";
import {
  REVIEW_CONFIDENCE_THRESHOLD,
  computeReviewLevel,
} from "../../../src/agent-readiness/rule-engine/review-level";
import {
  AssertionBuilder,
  type Assertion,
} from "../../../src/agent-readiness/rule-engine/assertion-builder";
import type { AssertionStatus } from "../../../src/agent-readiness/rule-engine/status-determinator";
import type { AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import { DEFAULT_CATEGORY_WEIGHTS, DEFAULT_PILLAR_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function makeRule(overrides: Record<string, unknown> = {}): AgentReadinessRule {
  return {
    rule_id: "AB-TEST",
    version: "1.0.0",
    name: "Test Rule",
    category: "discovery",
    severity: "medium",
    check: {
      type: "http_fetch",
      target: "/test",
      sources: ["homepage"],
    },
    ...overrides,
  } as AgentReadinessRule;
}

function makeAssertion(
  status: AssertionStatus,
  confidence: number,
  ruleId = "AB-TEST",
): Assertion {
  return AssertionBuilder.build({
    rule: makeRule({ rule_id: ruleId }),
    evidence: [],
    status,
    confidence,
    reason: "test reason",
  });
}

const testManifest: RulesetManifest = {
  name: "test-ruleset",
  version: "1.0.0",
  categoryWeights: { ...DEFAULT_CATEGORY_WEIGHTS },
  scoringModel: "v2-pillars",
  pillarWeights: { ...DEFAULT_PILLAR_WEIGHTS },
};

// ─── Tests ─────────────────────────────────────────────────────────────────────

describe("SLICE-94-5: Review Level Policy", () => {
  // ─── Boundary tests ────────────────────────────────────────────────────────

  describe("computeReviewLevel — boundary at 0.80", () => {
    it("0.79 → assisted", () => {
      expect(computeReviewLevel({ confidence: 0.79, status: "VERIFIED" })).toBe("assisted");
    });

    it("0.80 → automatic (inclusive)", () => {
      expect(computeReviewLevel({ confidence: 0.80, status: "VERIFIED" })).toBe("automatic");
    });

    it("0.81 → automatic", () => {
      expect(computeReviewLevel({ confidence: 0.81, status: "VERIFIED" })).toBe("automatic");
    });

    it("1.0 → automatic", () => {
      expect(computeReviewLevel({ confidence: 1.0, status: "VERIFIED" })).toBe("automatic");
    });

    it("0.0 → assisted", () => {
      expect(computeReviewLevel({ confidence: 0.0, status: "GAP" })).toBe("assisted");
    });
  });

  // ─── Status-based tests ────────────────────────────────────────────────────

  describe("computeReviewLevel — by status", () => {
    it("VERIFIED 0.9 → automatic", () => {
      expect(computeReviewLevel({ confidence: 0.9, status: "VERIFIED" })).toBe("automatic");
    });

    it("INFERRED 0.7 → assisted", () => {
      expect(computeReviewLevel({ confidence: 0.7, status: "INFERRED" })).toBe("assisted");
    });

    it("GAP 0 → assisted", () => {
      expect(computeReviewLevel({ confidence: 0, status: "GAP" })).toBe("assisted");
    });

    it("CONFLICT 0.3 → assisted", () => {
      expect(computeReviewLevel({ confidence: 0.3, status: "CONFLICT" })).toBe("assisted");
    });

    it("NOT_APPLICABLE → null (confidence null)", () => {
      expect(computeReviewLevel({ confidence: null, status: "NOT_APPLICABLE" })).toBe(null);
    });
  });

  // ─── Threshold constant ────────────────────────────────────────────────────

  it("REVIEW_CONFIDENCE_THRESHOLD is 0.80", () => {
    expect(REVIEW_CONFIDENCE_THRESHOLD).toBe(0.80);
  });

  // ─── Builder integration ───────────────────────────────────────────────────

  describe("AssertionBuilder.build — review_level", () => {
    it("confidence 0.95 → review_level: automatic", () => {
      const assertion = makeAssertion("VERIFIED", 0.95);
      expect(assertion.review_level).toBe("automatic");
    });

    it("confidence 0.5 → review_level: assisted", () => {
      const assertion = makeAssertion("INFERRED", 0.5);
      expect(assertion.review_level).toBe("assisted");
    });

    it("NOT_APPLICABLE → review_level: null", () => {
      const assertion = makeAssertion("NOT_APPLICABLE", 0);
      expect(assertion.review_level).toBe(null);
    });
  });

  // ─── Deserialize legacy (no review_level) ──────────────────────────────────

  describe("deserialize — legacy fallback", () => {
    it("recomputes review_level from confidence + status when missing", () => {
      const legacyJson = JSON.stringify({
        rule_id: "AB-LEGACY",
        rule_version: "1.0.0",
        status: "VERIFIED",
        evidence: [],
        confidence: 0.85,
        timestamp: "2025-01-01T00:00:00Z",
        source_url: null,
        reason: "legacy",
        category: "discovery",
        name: "Legacy Rule",
        claim: "Legacy claim",
        verified_at: "2025-01-01T00:00:00Z",
        // NOTE: no review_level field
      });
      const assertion = AssertionBuilder.deserialize(legacyJson);
      expect(assertion.review_level).toBe("automatic");
    });

    it("recomputes assisted when confidence is low", () => {
      const legacyJson = JSON.stringify({
        rule_id: "AB-LEGACY",
        rule_version: "1.0.0",
        status: "INFERRED",
        evidence: [],
        confidence: 0.4,
        timestamp: "2025-01-01T00:00:00Z",
        source_url: null,
        reason: "legacy",
        category: "discovery",
        name: "Legacy Rule",
        claim: "Legacy claim",
        verified_at: "2025-01-01T00:00:00Z",
      });
      const assertion = AssertionBuilder.deserialize(legacyJson);
      expect(assertion.review_level).toBe("assisted");
    });

    it("recomputes null for NOT_APPLICABLE", () => {
      const legacyJson = JSON.stringify({
        rule_id: "AB-LEGACY",
        rule_version: "1.0.0",
        status: "NOT_APPLICABLE",
        evidence: [],
        confidence: 0,
        timestamp: "2025-01-01T00:00:00Z",
        source_url: null,
        reason: "legacy",
        category: "discovery",
        name: "Legacy Rule",
        claim: "Legacy claim",
        verified_at: "2025-01-01T00:00:00Z",
      });
      const assertion = AssertionBuilder.deserialize(legacyJson);
      expect(assertion.review_level).toBe(null);
    });
  });

  // ─── Scoring isolation guard ───────────────────────────────────────────────

  describe("Scoring isolation guard — confidence/review_level never move the score", () => {
    it("two assertion sets differing ONLY in confidence/review_level → identical scores", () => {
      // Set A: high confidence (automatic)
      const setA: Assertion[] = [
        makeAssertion("VERIFIED", 0.95, "AB-001"),
        makeAssertion("INFERRED", 0.65, "AB-002"),
        makeAssertion("GAP", 0.0, "AB-003"),
      ];

      // Set B: same statuses, different confidence (but still same status contributions)
      const setB: Assertion[] = [
        makeAssertion("VERIFIED", 0.80, "AB-001"),
        makeAssertion("INFERRED", 0.50, "AB-002"),
        makeAssertion("GAP", 0.0, "AB-003"),
      ];

      const resultA = runScoringEngine({
        assertions: setA,
        rulesetManifest: testManifest,
      });
      const resultB = runScoringEngine({
        assertions: setB,
        rulesetManifest: testManifest,
      });

      // Total scores must be identical — confidence/review_level don't affect scoring
      expect(resultA.total.score).toBe(resultB.total.score);
      expect(resultA.total.rawScore).toBe(resultB.total.rawScore);
    });
  });
});
