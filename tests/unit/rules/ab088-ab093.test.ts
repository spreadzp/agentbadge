import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../../src/agent-readiness/rule.schema";
import { AB088 } from "../../../src/agent-readiness/rules/AB088";
import { AB093 } from "../../../src/agent-readiness/rules/AB093";

describe("SLICE-69-3: Payments Gap Rules (MPP, SPT)", () => {
  it("AB-088: MPP support", () => {
    expect(AB088.rule_id).toBe("AB-088");
    expect(AB088.name).toBe("MPP (Machine Payments Protocol) support");
    expect(AB088.category).toBe("payments");
    expect(AB088.severity).toBe("medium");
    expect(AB088.counted_in_score).toBe(true);
    expect(AB088.check.type).toBe("http_probe");
    expect(AB088.check.target).toBe("/.well-known/mpp.json");
    expect(AB088.check.sources).toContain("x402");
    expect(AB088.fix.eligible).toBe(true);
    expect(AB088.fix.type).toBe("assisted");
  });

  it("AB-093: SPT support", () => {
    expect(AB093.rule_id).toBe("AB-093");
    expect(AB093.name).toBe("SPT (Stripe Payment Terms) support");
    expect(AB093.category).toBe("payments");
    expect(AB093.severity).toBe("low");
    expect(AB093.counted_in_score).toBe(true);
    expect(AB093.check.type).toBe("http_probe");
    expect(AB093.check.target).toBe("/.well-known/spt.json");
    expect(AB093.check.sources).toContain("x402");
    expect(AB093.fix.eligible).toBe(true);
    expect(AB093.fix.type).toBe("assisted");
  });

  it("both rules validate against schema", () => {
    for (const rule of [AB088, AB093]) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should validate`).toBe(true);
    }
  });

  it("both rules registered in ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(ids).toContain("AB-088");
    expect(ids).toContain("AB-093");
  });

  it("ruleset has at least 100 total rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(100);
  });

  it("ruleset version is 2.1.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("2.1.0");
  });
});
