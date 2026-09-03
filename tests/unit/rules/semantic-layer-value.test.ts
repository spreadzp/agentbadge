import { describe, it, expect, beforeAll } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import type { Assertion } from "../../../src/agent-readiness/rule-engine/assertion-builder";
import { richApiSourceState } from "../../fixtures/semantic/rich-api/source-state";

const SEMANTIC_RULE_IDS = new Set([
  "AB-146", "AB-147", "AB-148", "AB-149", "AB-150",
  "AB-151", "AB-152", "AB-153", "AB-154", "AB-155",
  "AB-156", "AB-157", "AB-158", "AB-159", "AB-160",
]);

const manifest: RulesetManifest = {
  name: AGENT_READINESS_RULESET.name,
  version: AGENT_READINESS_RULESET.version,
  scoring: AGENT_READINESS_RULESET.scoring,
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

describe("SLICE-95-10: V1-vs-V2 Delta — semantic layer proves its value", () => {
  let v1Assertions: Assertion[];
  let v2Assertions: Assertion[];
  let v1Score: ReturnType<typeof runScoringEngine>;
  let v2Score: ReturnType<typeof runScoringEngine>;

  beforeAll(() => {
    RuleEngine.reset();
    const fullResult = RuleEngine.run(richApiSourceState);
    v2Assertions = fullResult.assertions;

    // V1: filter out all semantic rules (AB-146+)
    v1Assertions = v2Assertions.filter((a) => !SEMANTIC_RULE_IDS.has(a.rule_id));

    v1Score = runScoringEngine({ assertions: v1Assertions, rulesetManifest: manifest });
    v2Score = runScoringEngine({ assertions: v2Assertions, rulesetManifest: manifest });
  });

  it("V2 surfaces ≥3 GAP/INFERRED findings invisible to V1", () => {
    const semanticFindings = v2Assertions.filter(
      (a) =>
        SEMANTIC_RULE_IDS.has(a.rule_id) &&
        (a.status === "GAP" || a.status === "INFERRED")
    );
    expect(semanticFindings.length).toBeGreaterThanOrEqual(3);
  });

  it("V1 has zero findings in semantic categories", () => {
    const v1SemanticFindings = v1Assertions.filter(
      (a) =>
        SEMANTIC_RULE_IDS.has(a.rule_id) &&
        (a.status === "GAP" || a.status === "INFERRED")
    );
    expect(v1SemanticFindings.length).toBe(0);
  });

  it("V2 understandability pillar score differs from V1", () => {
    const v1U = v1Score.pillars.understandability.score;
    const v2U = v2Score.pillars.understandability.score;
    expect(v2U).not.toBe(v1U);
  });

  it("V2 executability pillar score differs from V1", () => {
    const v1E = v1Score.pillars.executability.score;
    const v2E = v2Score.pillars.executability.score;
    expect(v2E).not.toBe(v1E);
  });

  it("V2 total score is lower than V1 (semantic gaps reduce score)", () => {
    const v1Total = v1Score.total.score;
    const v2Total = v2Score.total.score;
    expect(v2Total).toBeLessThan(v1Total);
  });

  it("V2 surfaces findings in categories V1 cannot see", () => {
    const semanticCategories = new Set(
      v2Assertions
        .filter((a) => SEMANTIC_RULE_IDS.has(a.rule_id) && (a.status === "GAP" || a.status === "INFERRED"))
        .map((a) => a.category)
    );
    // Should include at least pricing, rate_limits, or error_semantics
    expect(semanticCategories.size).toBeGreaterThanOrEqual(3);
  });
});
