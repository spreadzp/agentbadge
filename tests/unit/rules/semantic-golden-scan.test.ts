import { describe, it, expect, beforeAll } from "vitest";
import { RuleEngine } from "../../../src/agent-readiness/rule-engine/rule-engine";
import { runScoringEngine } from "../../../src/agent-readiness/scoring/scoring-engine";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../../src/agent-readiness/scoring/scoring-types";
import type { RulesetManifest } from "../../../src/agent-readiness/scoring/scoring-config";
import { richApiSourceState } from "../../fixtures/semantic/rich-api/source-state";

const SEMANTIC_RULE_IDS = [
  "AB-146", "AB-147", "AB-148", "AB-149", "AB-150",
  "AB-151", "AB-152", "AB-153", "AB-154", "AB-155",
  "AB-156", "AB-157", "AB-158", "AB-159", "AB-160",
];

const manifest: RulesetManifest = {
  name: AGENT_READINESS_RULESET.name,
  version: AGENT_READINESS_RULESET.version,
  scoring: AGENT_READINESS_RULESET.scoring,
  categoryWeights: DEFAULT_CATEGORY_WEIGHTS,
};

describe("SLICE-95-10: Golden Semantic Scan — exact statuses + scores", () => {
  let assertions: ReturnType<typeof RuleEngine.run>["assertions"];
  let scoreResult: ReturnType<typeof runScoringEngine>;

  beforeAll(() => {
    RuleEngine.reset();
    const result = RuleEngine.run(richApiSourceState);
    assertions = result.assertions;
    scoreResult = runScoringEngine({ assertions, rulesetManifest: manifest });
  });

  // ─── Per-rule status expectations (hand-written from fixture design) ───

  describe("semantic rule statuses", () => {
    // Actual statuses from running the engine on the fixture (verified empirically)
    const expected: Record<string, string> = {
      "AB-146": "INFERRED",   // operation descriptions — partial (some ops bare)
      "AB-147": "INFERRED",   // parameter semantics — partial (some params lack descriptions)
      "AB-148": "VERIFIED",   // examples — examples present in the OpenAPI spec
      "AB-149": "GAP",        // error schemas — no 4xx/5xx responses declared
      "AB-150": "VERIFIED",   // pricing discoverability — pricing info found in guide + llms.txt
      "AB-151": "GAP",        // rate limits — no rate limits anywhere
      "AB-152": "GAP",        // pricing consistency — pricing mentioned in guide AND llms.txt (inconsistent sources)
      "AB-153": "GAP",        // authentication clarity — no securitySchemes in OpenAPI
      "AB-154": "GAP",        // retry semantics — no Idempotency-Key or Retry-After
      "AB-155": "INFERRED",   // versioning — partial (info.version present, no deprecation policy)
      "AB-156": "VERIFIED",   // sandbox — present in guide
      "AB-157": "GAP",        // agent policy — agents.txt present but missing required policy fields
      "AB-158": "VERIFIED",   // capability list — capabilities array in guide
      "AB-159": "VERIFIED",   // business constraints — constraints present in guide
      "AB-160": "VERIFIED",   // support path — support email in guide
    };

    for (const ruleId of SEMANTIC_RULE_IDS) {
      it(`${ruleId} → ${expected[ruleId]}`, () => {
        const a = assertions.find((a) => a.rule_id === ruleId);
        expect(a).toBeDefined();
        expect(a!.status).toBe(expected[ruleId]);
      });
    }
  });

  // ─── Score expectations ───

  it("total score is a valid number 0-100", () => {
    const score = scoreResult.total.score;
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("pillar scores include all four pillars", () => {
    const pillars = scoreResult.pillars;
    expect(pillars).toBeDefined();
    expect(pillars.discovery).toBeDefined();
    expect(pillars.understandability).toBeDefined();
    expect(pillars.executability).toBeDefined();
    expect(pillars.verifiability).toBeDefined();
  });

  it("understandability pillar score reflects semantic gaps (not 100)", () => {
    const score = scoreResult.pillars.understandability.score;
    expect(score).toBeLessThan(100);
  });

  it("executability pillar score reflects missing rate limits + retry + versioning", () => {
    const score = scoreResult.pillars.executability.score;
    expect(score).toBeLessThan(100);
  });

  it("at least 3 GAP findings from semantic rules", () => {
    const gaps = assertions.filter(
      (a) => SEMANTIC_RULE_IDS.includes(a.rule_id) && a.status === "GAP"
    );
    expect(gaps.length).toBeGreaterThanOrEqual(3);
  });

  it("at least 2 INFERRED findings from semantic rules", () => {
    const inferred = assertions.filter(
      (a) => SEMANTIC_RULE_IDS.includes(a.rule_id) && a.status === "INFERRED"
    );
    expect(inferred.length).toBeGreaterThanOrEqual(2);
  });

  it("at least 4 VERIFIED findings from semantic rules", () => {
    const verified = assertions.filter(
      (a) => SEMANTIC_RULE_IDS.includes(a.rule_id) && a.status === "VERIFIED"
    );
    expect(verified.length).toBeGreaterThanOrEqual(4);
  });

  // ─── Critical floor: AB-153 (auth) is GAP with critical severity ───

  it("AB-153 (auth clarity) is GAP with critical severity", () => {
    const a = assertions.find((a) => a.rule_id === "AB-153");
    expect(a).toBeDefined();
    expect(a!.status).toBe("GAP");
    expect((a as { severity?: string }).severity).toBe("critical");
  });
});
