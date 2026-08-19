import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../src/agent-readiness/rule.schema";

const newRuleIds = [
  "AB-030", "AB-031", "AB-032", "AB-033", "AB-034", "AB-035",
  "AB-036", "AB-037", "AB-038",
  "AB-039", "AB-040", "AB-041", "AB-042", "AB-043", "AB-044",
  "AB-045", "AB-046", "AB-047",
  "AB-048", "AB-049", "AB-050", "AB-051", "AB-052", "AB-053", "AB-054", "AB-055",
];

describe("Rules AB-030 through AB-055", () => {
  it("ruleset has 82 total rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBe(82);
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

    it(`${ruleId} has fix definition`, () => {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === ruleId);
      expect(rule).toBeTruthy();
      expect(rule!.fix).toBeTruthy();
      expect(rule!.fix.eligible).toBeDefined();
      expect(rule!.fix.type).toBeDefined();
    });
  }

  // Category checks for key rules
  it("AB-030 is about payments (live 402)", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-030");
    expect(rule!.category).toBe("payments");
  });

  it("AB-035 is about x402.json discovery", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-035");
    expect(rule!.category).toBe("payments");
  });

  it("AB-036 is about Bazaar", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-036");
    expect(rule!.category).toBe("bazaar");
  });

  it("AB-039 is about OpenAPI", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-039");
    expect(rule!.category).toBe("openapi");
  });

  it("AB-045 is about infrastructure (cache headers)", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-045");
    expect(rule!.category).toBe("infrastructure");
  });

  it("AB-048 is about agents.txt", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-048");
    expect(rule!.category).toBe("agents_txt");
  });

  it("AB-049 is about RSS feed", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-049");
    expect(rule!.name.toLowerCase()).toContain("rss");
  });

  it("AB-050 is about WebMCP", () => {
    const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === "AB-050");
    expect(rule!.category).toBe("webmcp");
  });
});
