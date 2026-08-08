import { describe, it, expect } from "vitest";
import { checkTypeEnum, categoryEnum } from "../../src/agent-readiness/shared.schema";
import { agentReadinessRuleSchema } from "../../src/agent-readiness/rule.schema";

describe("SLICE-48-1: Schema extensions", () => {
  it("checkTypeEnum includes http_probe", () => {
    expect(checkTypeEnum.options).toContain("http_probe");
  });

  it("checkTypeEnum includes content_parse", () => {
    expect(checkTypeEnum.options).toContain("content_parse");
  });

  it("checkTypeEnum includes json_rpc", () => {
    expect(checkTypeEnum.options).toContain("json_rpc");
  });

  it("checkTypeEnum includes header_check", () => {
    expect(checkTypeEnum.options).toContain("header_check");
  });

  it("categoryEnum includes payments", () => {
    expect(categoryEnum.options).toContain("payments");
  });

  it("categoryEnum includes identity", () => {
    expect(categoryEnum.options).toContain("identity");
  });

  it("categoryEnum includes infrastructure", () => {
    expect(categoryEnum.options).toContain("infrastructure");
  });

  it("categoryEnum includes bazaar", () => {
    expect(categoryEnum.options).toContain("bazaar");
  });

  it("categoryEnum includes webmcp", () => {
    expect(categoryEnum.options).toContain("webmcp");
  });

  it("categoryEnum includes bot_auth", () => {
    expect(categoryEnum.options).toContain("bot_auth");
  });

  it("ruleSchema accepts applicability field", () => {
    const rule = agentReadinessRuleSchema.parse({
      rule_id: "AB-043",
      version: "1.0.0",
      name: "Live 402 response",
      category: "payments",
      severity: "high",
      counted_in_score: true,
      check: { type: "http_fetch" },
      applicability: {
        condition: "x402Json exists",
        description: "Only applies if /.well-known/x402.json is found",
      },
      fix: { eligible: false, type: "none" },
    });
    expect(rule.applicability).toBeDefined();
    expect(rule.applicability?.condition).toBe("x402Json exists");
  });

  it("ruleSchema accepts counted_in_score = false", () => {
    const rule = agentReadinessRuleSchema.parse({
      rule_id: "AB-051",
      version: "1.0.0",
      name: "agents.txt found",
      category: "discovery",
      severity: "low",
      counted_in_score: false,
      check: { type: "http_fetch" },
      fix: { eligible: true, type: "deterministic" },
    });
    expect(rule.counted_in_score).toBe(false);
  });

  it("ruleSchema works without applicability (optional)", () => {
    const rule = agentReadinessRuleSchema.parse({
      rule_id: "AB-001",
      version: "1.0.0",
      name: "OpenAPI spec found",
      category: "openapi",
      severity: "high",
      counted_in_score: true,
      check: { type: "http_fetch", target: "/openapi.json" },
      fix: { eligible: false, type: "none" },
    });
    expect(rule.applicability).toBeUndefined();
  });
});
