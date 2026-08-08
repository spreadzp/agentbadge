import { describe, it, expect } from "vitest";
import { agentReadinessRuleSchema } from "../src/agent-readiness/rule.schema";
import { AB001 } from "./fixtures/agent-readiness-rules/AB-001";
import { AB002 } from "./fixtures/agent-readiness-rules/AB-002";
import { AB003 } from "./fixtures/agent-readiness-rules/AB-003";
import { AB004 } from "./fixtures/agent-readiness-rules/AB-004";
import { AB005 } from "./fixtures/agent-readiness-rules/AB-005";
import { AB006 } from "./fixtures/agent-readiness-rules/AB-006";
import { AB007 } from "./fixtures/agent-readiness-rules/AB-007";
import { AB008 } from "./fixtures/agent-readiness-rules/AB-008";
import { AB009 } from "./fixtures/agent-readiness-rules/AB-009";
import { AB010 } from "./fixtures/agent-readiness-rules/AB-010";
import { AB011 } from "./fixtures/agent-readiness-rules/AB-011";
import { AB012 } from "./fixtures/agent-readiness-rules/AB-012";
import { AB013 } from "./fixtures/agent-readiness-rules/AB-013";

const allRules = [AB001, AB002, AB003, AB004, AB005, AB006, AB007, AB008, AB009, AB010, AB011, AB012, AB013];

describe("agentReadinessRuleSchema — all 13 MVP rules", () => {
  it("validates all 13 fixtures", () => {
    for (const rule of allRules) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should parse`).toBe(true);
    }
  });

  it("has exactly 13 rules", () => {
    expect(allRules).toHaveLength(13);
  });

  it("AB-005 has applicability referencing AB-003", () => {
    expect(AB005.applicability).toBeDefined();
    expect(AB005.applicability!.condition).toContain("AB-003");
  });

  it("AB-006 fix.type is 'none' and eligible is false", () => {
    expect(AB006.fix.type).toBe("none");
    expect(AB006.fix.eligible).toBe(false);
  });

  it("AB-007 check.type is 'cross_evidence' with correct sources and match_keys", () => {
    expect(AB007.check.type).toBe("cross_evidence");
    expect(AB007.check.sources).toEqual(["openapi", "guide"]);
    expect(AB007.check.match_keys).toEqual(["method", "path"]);
  });

  it("AB-007 has applicability referencing both AB-003 and AB-004", () => {
    expect(AB007.applicability).toBeDefined();
    expect(AB007.applicability!.condition).toContain("AB-003");
    expect(AB007.applicability!.condition).toContain("AB-004");
  });

  it("AB-013 fix.type is 'none' and eligible is false", () => {
    expect(AB013.fix.type).toBe("none");
    expect(AB013.fix.eligible).toBe(false);
  });

  it("rejects invalid rule_id format", () => {
    const bad = { ...AB001, rule_id: "XY-001" };
    const result = agentReadinessRuleSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects invalid check.type", () => {
    const bad = { ...AB001, check: { ...AB001.check, type: "unknown" } };
    const result = agentReadinessRuleSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });

  it("rejects invalid fix.type", () => {
    const bad = { ...AB001, fix: { ...AB001.fix, type: "automatic" } };
    const result = agentReadinessRuleSchema.safeParse(bad);
    expect(result.success).toBe(false);
  });
});
