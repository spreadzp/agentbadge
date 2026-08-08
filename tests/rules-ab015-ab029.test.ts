import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../src/agent-readiness/rule.schema";

const newRuleIds = [
  "AB-015",
  "AB-016",
  "AB-017",
  "AB-018",
  "AB-019",
  "AB-020",
  "AB-021",
  "AB-022",
  "AB-023",
  "AB-024",
  "AB-025",
  "AB-026",
  "AB-027",
  "AB-028",
  "AB-029",
];

describe("Rules AB-015 through AB-029", () => {
  it("ruleset has 29 total rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBe(29);
  });

  for (const ruleId of newRuleIds) {
    it(`${ruleId} is registered in ruleset`, () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
      expect(rule).toBeTruthy();
    });

    it(`${ruleId} validates against schema`, () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
      expect(rule).toBeTruthy();
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success).toBe(true);
    });

    it(`${ruleId} has correct category`, () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
      expect(rule).toBeTruthy();
      expect(rule!.category).toBeTruthy();
    });

    it(`${ruleId} has fix definition`, () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
      expect(rule).toBeTruthy();
      expect(rule!.fix).toBeTruthy();
      expect(rule!.fix.eligible).toBeDefined();
      expect(rule!.fix.type).toBeDefined();
    });
  }

  it("AB-015 is about content negotiation (agent UA non-HTML)", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-015");
    expect(rule).toBeTruthy();
    expect(rule!.category).toBe("content_negotiation");
  });

  it("AB-020 is about MCP tools/list", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-020");
    expect(rule).toBeTruthy();
    expect(rule!.category).toBe("machine_readable");
  });

  it("AB-024 is about llms-full.txt", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-024");
    expect(rule).toBeTruthy();
    expect(rule!.name.toLowerCase()).toContain("llms");
  });

  it("AB-026 is about skill file", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-026");
    expect(rule).toBeTruthy();
    expect(rule!.name.toLowerCase()).toContain("skill");
  });
});
