import { describe, it, expect, beforeEach } from "vitest";
import { RuleLoader, RuleLoaderClass } from "../../../src/agent-readiness/rule-engine/rule-loader";
import { AGENT_READINESS_RULESET } from "../../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema, type AgentReadinessRule } from "../../../src/agent-readiness/rule.schema";

beforeEach(() => {
  RuleLoader.clearCache();
});

describe("RuleLoader", () => {
  it("loads all rules from manifest", () => {
    const result = RuleLoader.loadFromManifest();

    expect(result.rules.length).toBeGreaterThanOrEqual(13);
    expect(result.manifestVersion).toBe(AGENT_READINESS_RULESET.version);
    expect(result.loadedAt).toBeTruthy();
  });

  it("each rule has valid rule_id matching AB-XXX pattern", () => {
    const result = RuleLoader.loadFromManifest();

    for (const rule of result.rules) {
      expect(rule.rule_id).toMatch(/^AB-[0-9]{3}$/);
    }
  });

  it("each rule passes Zod validation", () => {
    const result = RuleLoader.loadFromManifest();

    for (const rule of result.rules) {
      const parsed = agentReadinessRuleSchema.safeParse(rule);
      expect(parsed.success).toBe(true);
    }
  });

  it("returns cached result on second call", () => {
    const first = RuleLoader.loadFromManifest();
    const second = RuleLoader.loadFromManifest();

    expect(second.loadedAt).toBe(first.loadedAt);
    expect(second.rules).toBe(first.rules);
  });

  it("clearCache forces re-load", async () => {
    const first = RuleLoader.loadFromManifest();
    RuleLoader.clearCache();
    await new Promise((r) => setTimeout(r, 5));
    const second = RuleLoader.loadFromManifest();

    expect(second.loadedAt).not.toBe(first.loadedAt);
    expect(second.rules).toEqual(first.rules);
  });

  it("validateRule accepts a valid rule", () => {
    const validRule: AgentReadinessRule = {
      rule_id: "AB-999",
      version: "1.0.0",
      name: "Test rule",
      category: "discovery",
      severity: "low",
      counted_in_score: true,
      check: { type: "http_fetch", target: "/test" },
      fix: { eligible: false, type: "none" },
    };

    const result = RuleLoader.validateRule(validRule);
    expect(result.rule_id).toBe("AB-999");
  });

  it("validateRule throws on invalid rule", () => {
    const invalidRule = {
      rule_id: "INVALID",
      version: "not-semver",
      name: "",
      category: "invalid_category",
      severity: "critical",
      counted_in_score: "yes",
      check: { type: "unknown_type" },
      fix: { eligible: "maybe", type: "maybe" },
    };

    expect(() => RuleLoader.validateRule(invalidRule)).toThrow();
  });

  it("validateRule throws on missing required fields", () => {
    expect(() => RuleLoader.validateRule({})).toThrow();
  });

  it("getRuleIds returns all rule IDs", () => {
    const ids = RuleLoader.getRuleIds();
    expect(ids.length).toBeGreaterThanOrEqual(13);
    expect(ids).toContain("AB-001");
    expect(ids).toContain("AB-013");
  });

  it("findRule returns rule by ID", () => {
    const rule = RuleLoader.findRule("AB-001");
    expect(rule).toBeDefined();
    expect(rule!.rule_id).toBe("AB-001");
    expect(rule!.name).toBe("robots.txt present");
  });

  it("findRule returns undefined for unknown ID", () => {
    expect(RuleLoader.findRule("AB-999")).toBeUndefined();
  });

  it("new RuleLoaderClass instance has independent cache", async () => {
    const loader1 = new RuleLoaderClass();
    const r1 = loader1.loadFromManifest();
    await new Promise((r) => setTimeout(r, 5));
    const loader2 = new RuleLoaderClass();
    const r2 = loader2.loadFromManifest();

    expect(r1.rules).toEqual(r2.rules);
    expect(r1.loadedAt).not.toBe(r2.loadedAt);
  });

  it("rules cover all 5 categories", () => {
    const result = RuleLoader.loadFromManifest();
    const categories = new Set(result.rules.map((r) => r.category));

    expect(categories.has("discovery")).toBe(true);
    expect(categories.has("documentation")).toBe(true);
    expect(categories.has("actionability")).toBe(true);
    expect(categories.has("machine_readable")).toBe(true);
    expect(categories.has("verification")).toBe(true);
  });

  it("rules cover all 3 severities", () => {
    const result = RuleLoader.loadFromManifest();
    const severities = new Set(result.rules.map((r) => r.severity));

    expect(severities.has("high")).toBe(true);
    expect(severities.has("medium")).toBe(true);
    expect(severities.has("low")).toBe(true);
  });

  it("every rule has a fix definition", () => {
    const result = RuleLoader.loadFromManifest();

    for (const rule of result.rules) {
      expect(rule.fix).toBeDefined();
      expect(typeof rule.fix.eligible).toBe("boolean");
      expect(rule.fix.type).toMatch(/^(deterministic|assisted|none)$/);
    }
  });
});
