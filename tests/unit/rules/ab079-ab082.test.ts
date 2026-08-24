import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB079 } from "../../../src/agent-readiness/rules/AB079";
import { AB080 } from "../../../src/agent-readiness/rules/AB080";
import { AB081 } from "../../../src/agent-readiness/rules/AB081";
import { AB082 } from "../../../src/agent-readiness/rules/AB082";

describe("SLICE-69-4: llms.txt Deep Validation Rules", () => {
  it("AB-079: llms.txt markdown structure valid", () => {
    expect(AB079.rule_id).toBe("AB-079");
    expect(AB079.name).toBe("llms.txt markdown structure valid");
    expect(AB079.category).toBe("discovery");
    expect(AB079.severity).toBe("medium");
    expect(AB079.counted_in_score).toBe(true);
    expect(AB079.check.type).toBe("content_parse");
    expect(AB079.check.target).toBe("/llms.txt");
    expect(AB079.check.sources).toContain("llms");
    expect(AB079.fix.eligible).toBe(true);
    expect(AB079.fix.type).toBe("deterministic");
  });

  it("AB-080: llms-full.txt exists", () => {
    expect(AB080.rule_id).toBe("AB-080");
    expect(AB080.name).toBe("llms-full.txt exists");
    expect(AB080.category).toBe("discovery");
    expect(AB080.severity).toBe("medium");
    expect(AB080.counted_in_score).toBe(true);
    expect(AB080.check.type).toBe("http_fetch");
    expect(AB080.check.target).toBe("/llms-full.txt");
    expect(AB080.check.sources).toContain("llms_full");
    expect(AB080.fix.eligible).toBe(true);
    expect(AB080.fix.type).toBe("deterministic");
  });

  it("AB-081: llms-full.txt linked from HTML", () => {
    expect(AB081.rule_id).toBe("AB-081");
    expect(AB081.name).toBe("llms-full.txt linked from HTML");
    expect(AB081.category).toBe("discovery");
    expect(AB081.severity).toBe("medium");
    expect(AB081.counted_in_score).toBe(true);
    expect(AB081.check.type).toBe("content_parse");
    expect(AB081.check.target).toBe("/");
    expect(AB081.check.sources).toContain("homepage_meta");
    expect(AB081.fix.eligible).toBe(true);
    expect(AB081.fix.type).toBe("deterministic");
  });

  it("AB-082: llms.txt linked from HTML", () => {
    expect(AB082.rule_id).toBe("AB-082");
    expect(AB082.name).toBe("llms.txt linked from HTML");
    expect(AB082.category).toBe("discovery");
    expect(AB082.severity).toBe("medium");
    expect(AB082.counted_in_score).toBe(true);
    expect(AB082.check.type).toBe("content_parse");
    expect(AB082.check.target).toBe("/");
    expect(AB082.check.sources).toContain("homepage_meta");
    expect(AB082.fix.eligible).toBe(true);
    expect(AB082.fix.type).toBe("deterministic");
  });

  it("all 4 rules validate against schema", () => {
    for (const rule of [AB079, AB080, AB081, AB082]) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should validate`).toBe(true);
    }
  });

  it("all 4 rules have valid rule definitions", () => {
    const ids = [AB079.rule_id, AB080.rule_id, AB081.rule_id, AB082.rule_id];
    expect(ids).toEqual(["AB-079", "AB-080", "AB-081", "AB-082"]);
  });

  it("ruleset has at least 100 total rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(100);
  });

  it("ruleset version is 2.0.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("2.0.0");
  });
});
