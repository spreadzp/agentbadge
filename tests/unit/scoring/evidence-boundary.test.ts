import { describe, it, expect } from "vitest";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";

/**
 * SLICE-94-10: §6.1 boundary — evidence fields never affect score
 * Two assertions identical except for confidence/verified_at/review_level
 * must produce identical scores/grades.
 */

const manifest = {
  name: AGENT_READINESS_RULESET.name,
  version: AGENT_READINESS_RULESET.version,
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

function makeAssertion(overrides: Partial<Assertion>): Assertion {
  return {
    rule_id: "AB-001",
    rule_version: "1.0.0",
    status: "VERIFIED",
    evidence: [],
    confidence: 0.95,
    timestamp: "2026-09-01T10:00:00Z",
    source_url: "https://example.com",
    reason: "found",
    category: "discovery",
    name: "robots.txt present",
    claim: "robots.txt present",
    verified_at: "2026-09-01T10:00:00Z",
    review_level: "automatic",
    ...overrides,
  } as Assertion;
}

function score(a: Assertion) {
  const result = runScoringEngine({ assertions: [a], rulesetManifest: manifest });
  return { score: result.total.score, grade: result.total.grade };
}

describe("SLICE-94-10: §6.1 boundary — evidence fields never affect score", () => {
  it("identical assertions except confidence produce same score", () => {
    const highConf = makeAssertion({ confidence: 0.95, review_level: "automatic" });
    const lowConf = makeAssertion({ confidence: 0.5, review_level: "assisted" });

    expect(score(highConf)).toEqual(score(lowConf));
  });

  it("identical assertions except verified_at produce same score", () => {
    const recent = makeAssertion({ verified_at: "2026-09-01T10:00:00Z" });
    const stale = makeAssertion({ verified_at: "2020-01-01T00:00:00Z" });

    expect(score(recent)).toEqual(score(stale));
  });

  it("identical assertions except review_level produce same score", () => {
    const auto = makeAssertion({ review_level: "automatic" });
    const assisted = makeAssertion({ review_level: "assisted" });

    expect(score(auto)).toEqual(score(assisted));
  });

  it("identical assertions except evidence source_class produce same score", () => {
    const withSourceClass = makeAssertion({
      evidence: [
        {
          type: "http",
          url: "https://example.com",
          status: 200,
          headers: {},
          content_hash: "abc",
          content_type: "text/html",
          resolved_ip: null,
          captured_at: "2026-09-01T10:00:00Z",
          source_class: "runtime",
        } as Assertion["evidence"][0],
      ],
    });
    const noSourceClass = makeAssertion({
      evidence: [
        {
          type: "http",
          url: "https://example.com",
          status: 200,
          headers: {},
          content_hash: "abc",
          content_type: "text/html",
          resolved_ip: null,
          captured_at: "2026-09-01T10:00:00Z",
        } as Assertion["evidence"][0],
      ],
    });

    expect(score(withSourceClass)).toEqual(score(noSourceClass));
  });

  it("GAP assertion with different confidence values produces same score", () => {
    const gapHigh = makeAssertion({ status: "GAP", confidence: 0.9, review_level: "automatic" });
    const gapLow = makeAssertion({ status: "GAP", confidence: 0.1, review_level: "assisted" });

    expect(score(gapHigh)).toEqual(score(gapLow));
  });
});
