import { describe, it, expect } from "vitest";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

/**
 * SLICE-95-6: Critical floor e2e test
 * AB-153 (critical severity) absent → total ≤ 30 even with everything else VERIFIED.
 * Tests the engine-level critical cap end-to-end through runScoringEngine.
 */

const manifest = {
  name: "agent-readiness",
  version: "1.4.0",
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
  scoring: { pillars: { scoringModel: "v2-pillars" as const } },
};

function makeAssertion(
  ruleId: string,
  category: string,
  severity: string,
  status: "VERIFIED" | "GAP" | "INFERRED" | "CONFLICT",
): Assertion {
  return {
    rule_id: ruleId,
    status,
    evidence: [],
    category,
    severity,
  } as unknown as Assertion;
}

describe("SLICE-95-6: Critical floor e2e (AB-153 absent → total ≤ 30)", () => {
  it("AB-153 GAP (critical) caps total at 30 even with all others VERIFIED", () => {
    const assertions: Assertion[] = [
      // AB-153 critical GAP → triggers critical floor
      makeAssertion("AB-153", "bot_auth", "critical", "GAP"),
      // Everything else VERIFIED
      makeAssertion("AB-001", "discovery", "high", "VERIFIED"),
      makeAssertion("AB-002", "discovery", "high", "VERIFIED"),
      makeAssertion("AB-003", "documentation", "high", "VERIFIED"),
      makeAssertion("AB-004", "documentation", "medium", "VERIFIED"),
      makeAssertion("AB-010", "pricing", "high", "VERIFIED"),
      makeAssertion("AB-011", "rate_limits", "high", "VERIFIED"),
      makeAssertion("AB-150", "pricing", "high", "VERIFIED"),
      makeAssertion("AB-151", "rate_limits", "high", "VERIFIED"),
      makeAssertion("AB-154", "retry_semantics", "medium", "VERIFIED"),
      makeAssertion("AB-155", "versioning", "medium", "VERIFIED"),
    ];

    const result = runScoringEngine({ assertions, rulesetManifest: manifest });
    const total = result.total.score;

    expect(total).toBeLessThanOrEqual(30);
    expect(result.total.floorTriggered).toBe(true);
  });

  it("AB-153 VERIFIED (critical) does NOT trigger critical cap", () => {
    const assertions: Assertion[] = [
      makeAssertion("AB-153", "bot_auth", "critical", "VERIFIED"),
      makeAssertion("AB-001", "discovery", "high", "VERIFIED"),
      makeAssertion("AB-003", "documentation", "high", "VERIFIED"),
    ];

    const result = runScoringEngine({ assertions, rulesetManifest: manifest });
    // Without critical GAP, no critical cap — score should be above 30
    expect(result.total.score).toBeGreaterThan(30);
    expect(result.total.floorTriggered).toBe(false);
  });

  it("non-critical GAP does not trigger critical cap (only high floor at 40)", () => {
    const assertions: Assertion[] = [
      // AB-001 is high severity, discovery category → triggers high floor (cap 40), not critical
      makeAssertion("AB-001", "discovery", "high", "GAP"),
      // Many VERIFIED to push raw score above 30
      makeAssertion("AB-002", "discovery", "high", "VERIFIED"),
      makeAssertion("AB-003", "documentation", "high", "VERIFIED"),
      makeAssertion("AB-004", "documentation", "medium", "VERIFIED"),
      makeAssertion("AB-005", "documentation", "medium", "VERIFIED"),
      makeAssertion("AB-010", "pricing", "high", "VERIFIED"),
      makeAssertion("AB-011", "rate_limits", "high", "VERIFIED"),
      makeAssertion("AB-150", "pricing", "high", "VERIFIED"),
      makeAssertion("AB-151", "rate_limits", "high", "VERIFIED"),
      makeAssertion("AB-154", "retry_semantics", "medium", "VERIFIED"),
      makeAssertion("AB-155", "versioning", "medium", "VERIFIED"),
    ];

    const result = runScoringEngine({ assertions, rulesetManifest: manifest });
    // High floor caps at 40, not 30 — score should be between 30 and 40
    expect(result.total.score).toBeLessThanOrEqual(40);
    expect(result.total.score).toBeGreaterThan(30);
  });
});
