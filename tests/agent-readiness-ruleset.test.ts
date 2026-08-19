import { describe, it, expect } from "vitest";
import { agentReadinessRuleSchema } from "../src/agent-readiness/rule.schema";
import { AGENT_READINESS_RULESET } from "../src/agent-readiness/ruleset";

const MVP_RULE_IDS = [
  "AB-001",
  "AB-002",
  "AB-003",
  "AB-004",
  "AB-005",
  "AB-006",
  "AB-007",
  "AB-008",
  "AB-009",
  "AB-010",
  "AB-011",
  "AB-012",
  "AB-013",
];

describe("AGENT_READINESS_RULESET manifest", () => {
  it("has name 'agent-readiness' and version '1.7.0'", () => {
    expect(AGENT_READINESS_RULESET.name).toBe("agent-readiness");
    expect(AGENT_READINESS_RULESET.version).toBe("1.7.0");
  });

  it("has exactly 82 rules", () => {
    expect(AGENT_READINESS_RULESET.rules).toHaveLength(82);
  });

  it("first 13 rule IDs match MVP-RULES.md 1:1", () => {
    const fixtureIds = AGENT_READINESS_RULESET.rules.slice(0, 13).map((r) => r.rule_id);
    expect(fixtureIds).toEqual(MVP_RULE_IDS);
  });

  it("all 82 rules pass agentReadinessRuleSchema.safeParse()", () => {
    for (const rule of AGENT_READINESS_RULESET.rules) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `${rule.rule_id} should parse`).toBe(true);
    }
  });

  it("no duplicate rule IDs", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
