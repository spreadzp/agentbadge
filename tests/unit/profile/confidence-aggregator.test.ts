import { describe, it, expect } from "vitest";
import { aggregateConfidence } from "../../../src/agent-readiness/profile/confidence-aggregator";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";

function makeAssertion(status: Assertion["status"], confidence: number): Assertion {
  return {
    rule_id: "AB-001", rule_version: "1.0", status, evidence: [], confidence,
    timestamp: "2026-09-01T10:00:00Z", source_url: null, reason: "ok",
    category: "test", name: "test", claim: "claim", verified_at: "2026-09-01T10:00:00Z",
    review_level: "automatic",
  };
}

describe("SLICE-101-6: aggregateConfidence", () => {
  it("returns correct range for all VERIFIED", () => {
    const assertions = [
      makeAssertion("VERIFIED", 0.9),
      makeAssertion("VERIFIED", 0.95),
      makeAssertion("VERIFIED", 0.85),
    ];
    const range = aggregateConfidence(assertions);
    expect(range.min).toBe(0.85);
    expect(range.max).toBe(0.95);
    expect(range.mean).toBeCloseTo(0.9, 5);
  });

  it("includes INFERRED assertions", () => {
    const assertions = [
      makeAssertion("VERIFIED", 0.9),
      makeAssertion("INFERRED", 0.7),
    ];
    const range = aggregateConfidence(assertions);
    expect(range.min).toBe(0.7);
    expect(range.max).toBe(0.9);
    expect(range.mean).toBeCloseTo(0.8, 5);
  });

  it("excludes GAP and CONFLICT", () => {
    const assertions = [
      makeAssertion("VERIFIED", 0.9),
      makeAssertion("GAP", 0.0),
      makeAssertion("CONFLICT", 0.5),
    ];
    const range = aggregateConfidence(assertions);
    expect(range.min).toBe(0.9);
    expect(range.max).toBe(0.9);
    expect(range.mean).toBe(0.9);
  });

  it("returns zeros for empty array", () => {
    const range = aggregateConfidence([]);
    expect(range).toEqual({ min: 0, max: 0, mean: 0 });
  });

  it("returns zeros when only GAP/CONFLICT", () => {
    const assertions = [
      makeAssertion("GAP", 0),
      makeAssertion("CONFLICT", 0.5),
    ];
    const range = aggregateConfidence(assertions);
    expect(range).toEqual({ min: 0, max: 0, mean: 0 });
  });

  it("filters out zero-confidence assertions", () => {
    const assertions = [
      makeAssertion("VERIFIED", 0.9),
      makeAssertion("VERIFIED", 0.0),
    ];
    const range = aggregateConfidence(assertions);
    expect(range.min).toBe(0.9);
    expect(range.mean).toBe(0.9);
  });
});
