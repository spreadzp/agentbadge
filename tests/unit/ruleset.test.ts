import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { agentReadinessRuleSchema } from "../../src/agent-readiness/rule.schema";
import { RULE_DESCRIPTIONS } from "../../src/agent-readiness/rule-descriptions";
import { RULE_CHECKERS } from "../../src/agent-readiness/rule-engine/rule-checkers";

const NEW_RULE_IDS = [
  "AB-104", "AB-105", "AB-106", "AB-107", "AB-108",
  "AB-109", "AB-110", "AB-111", "AB-112", "AB-113", "AB-114",
  "AB-115", "AB-116",
  "AB-117", "AB-118",
  "AB-098", "AB-099",
  "AB-100", "AB-101", "AB-102", "AB-103",
];

const NEW_CATEGORIES = ["seo_aeo", "accessibility"];

describe("SLICE-75-7: Ruleset version 2.0.0 and integrity", () => {
  it("ruleset version is 2.0.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("2.0.0");
  });

  it("ruleset name is agent-readiness", () => {
    expect(AGENT_READINESS_RULESET.name).toBe("agent-readiness");
  });

  it("has at least 100 rules", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBeGreaterThanOrEqual(100);
  });

  it("has no duplicate rule IDs", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it("all rules validate against schema", () => {
    for (const rule of AGENT_READINESS_RULESET.rules) {
      const result = agentReadinessRuleSchema.safeParse(rule);
      expect(result.success, `Rule ${rule.rule_id} failed schema validation`).toBe(true);
    }
  });

  it("all 25 new rules are registered", () => {
    const registeredIds = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    for (const id of NEW_RULE_IDS) {
      expect(registeredIds).toContain(id);
    }
  });

  it("all 25 new rules have descriptions", () => {
    const descIds = RULE_DESCRIPTIONS.map((d) => d.rule_id);
    for (const id of NEW_RULE_IDS) {
      expect(descIds).toContain(id);
    }
  });

  it("all 25 new rules have checker functions", () => {
    for (const id of NEW_RULE_IDS) {
      expect(RULE_CHECKERS[id]).toBeDefined();
    }
  });

  it("new categories (seo_aeo, accessibility) are present in ruleset", () => {
    const categories = new Set(AGENT_READINESS_RULESET.rules.map((r) => r.category));
    for (const cat of NEW_CATEGORIES) {
      expect(categories.has(cat as any)).toBe(true);
    }
  });

  it("seo_aeo category has at least 7 rules", () => {
    const seoAeoRules = AGENT_READINESS_RULESET.rules.filter((r) => r.category === "seo_aeo");
    expect(seoAeoRules.length).toBeGreaterThanOrEqual(7);
  });

  it("accessibility category has at least 2 rules", () => {
    const accessibilityRules = AGENT_READINESS_RULESET.rules.filter((r) => r.category === "accessibility");
    expect(accessibilityRules.length).toBeGreaterThanOrEqual(2);
  });

  it("webmcp category has at least 5 rules (includes AB-115, AB-116, AB-102, AB-103)", () => {
    const webmcpRules = AGENT_READINESS_RULESET.rules.filter((r) => r.category === "webmcp");
    expect(webmcpRules.length).toBeGreaterThanOrEqual(5);
  });
});
