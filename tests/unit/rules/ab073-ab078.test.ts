import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB073 } from "../../../src/agent-readiness/rules/AB073";
import { AB076 } from "../../../src/agent-readiness/rules/AB076";
import { AB077 } from "../../../src/agent-readiness/rules/AB077";
import { AB078 } from "../../../src/agent-readiness/rules/AB078";

describe("SLICE-69-1: AB-073..AB-078 infrastructure & OpenAPI gap rules", () => {
  it("AB-073: HTTPS redirect", () => {
    expect(AB073.rule_id).toBe("AB-073");
    expect(AB073.name).toContain("HTTPS redirect");
    expect(AB073.category).toBe("infrastructure");
    expect(AB073.severity).toBe("high");
    expect(AB073.counted_in_score).toBe(true);
    expect(AB073.check.type).toBe("http_probe");
    expect(AB073.check.sources).toEqual(["infrastructure"]);
    expect(AB073.fix.eligible).toBe(true);
    expect(AB073.fix.type).toBe("deterministic");
  });

  it("AB-076: OpenAPI paths reachable (50% threshold)", () => {
    expect(AB076.rule_id).toBe("AB-076");
    expect(AB076.name).toContain("OpenAPI paths reachable");
    expect(AB076.category).toBe("openapi");
    expect(AB076.severity).toBe("medium");
    expect(AB076.counted_in_score).toBe(true);
    expect(AB076.check.type).toBe("http_probe");
    expect(AB076.check.sources).toEqual(["openapi_standard"]);
    expect(AB076.fix.eligible).toBe(false);
    expect(AB076.fix.type).toBe("assisted");
  });

  it("AB-077: OpenAPI response matches spec", () => {
    expect(AB077.rule_id).toBe("AB-077");
    expect(AB077.name).toContain("response matches");
    expect(AB077.category).toBe("openapi");
    expect(AB077.severity).toBe("medium");
    expect(AB077.counted_in_score).toBe(true);
    expect(AB077.check.type).toBe("cross_evidence");
    expect(AB077.check.sources).toEqual(["openapi_standard"]);
    expect(AB077.fix.eligible).toBe(false);
    expect(AB077.fix.type).toBe("assisted");
  });

  it("AB-078: OpenAPI x-payment-info declared", () => {
    expect(AB078.rule_id).toBe("AB-078");
    expect(AB078.name).toContain("x-payment-info");
    expect(AB078.category).toBe("openapi");
    expect(AB078.severity).toBe("medium");
    expect(AB078.counted_in_score).toBe(true);
    expect(AB078.check.type).toBe("content_parse");
    expect(AB078.check.target).toBe("/openapi.json");
    expect(AB078.check.sources).toEqual(["openapi_standard"]);
    expect(AB078.fix.eligible).toBe(true);
    expect(AB078.fix.type).toBe("assisted");
  });

  it("all 4 rules pass agentReadinessRuleSchema.safeParse()", () => {
    for (const rule of [AB073, AB076, AB077, AB078]) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should parse`).toBe(true);
    }
  });

  it("all 4 rules registered in ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(ids).toContain("AB-073");
    expect(ids).toContain("AB-076");
    expect(ids).toContain("AB-077");
    expect(ids).toContain("AB-078");
  });

  it("ruleset has 82 rules total", () => {
    expect(AGENT_READINESS_RULESET.rules).toHaveLength(82);
  });

  it("ruleset version is 1.7.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("1.7.0");
  });

  it("no duplicate rule IDs in ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
