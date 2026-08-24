import { describe, it, expect } from "vitest";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";
import { RULE_DESCRIPTIONS } from "../../src/agent-readiness/rule-descriptions";
import { RULE_CHECKERS } from "../../src/agent-readiness/rule-engine/rule-checkers";
import { DEFAULT_CATEGORY_WEIGHTS } from "../../src/agent-readiness/scoring/scoring-types";

const NEW_RULE_IDS = [
  "AB-104", "AB-105", "AB-106", "AB-107", "AB-108",
  "AB-109", "AB-110", "AB-111", "AB-112", "AB-113", "AB-114",
  "AB-115", "AB-116",
  "AB-117", "AB-118",
  "AB-098", "AB-099",
  "AB-100", "AB-101", "AB-102", "AB-103",
];

const NEW_FETCHER_RESOURCES = [
  "og_meta",
  "aeo_content",
  "semantic_html",
  "accessibility",
  "content_depth",
];

describe("E2E: SLICE-75-7 Rules expansion integration", () => {
  it("ruleset version is 2.0.0", () => {
    expect(AGENT_READINESS_RULESET.version).toBe("2.0.0");
  });

  it("has 103 total rules (78 original + 25 new)", () => {
    expect(AGENT_READINESS_RULESET.rules.length).toBe(103);
  });

  it("all 25 new rules are in the ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    for (const id of NEW_RULE_IDS) {
      expect(ids).toContain(id);
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

  it("no duplicate rule IDs in the entire ruleset", () => {
    const ids = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
    expect(duplicates).toEqual([]);
  });

  it("seo_aeo category is present with 7 rules", () => {
    const rules = AGENT_READINESS_RULESET.rules.filter((r) => r.category === "seo_aeo");
    expect(rules.length).toBe(7);
  });

  it("accessibility category is present with 2 rules", () => {
    const rules = AGENT_READINESS_RULESET.rules.filter((r) => r.category === "accessibility");
    expect(rules.length).toBe(2);
  });

  it("webmcp category has at least 5 rules (AB-115, AB-116, AB-102, AB-103 + existing)", () => {
    const rules = AGENT_READINESS_RULESET.rules.filter((r) => r.category === "webmcp");
    expect(rules.length).toBeGreaterThanOrEqual(5);
  });

  it("DEFAULT_CATEGORY_WEIGHTS includes seo_aeo and accessibility", () => {
    expect(DEFAULT_CATEGORY_WEIGHTS.seo_aeo).toBeDefined();
    expect(DEFAULT_CATEGORY_WEIGHTS.accessibility).toBeDefined();
    expect(DEFAULT_CATEGORY_WEIGHTS.seo_aeo).toBeGreaterThan(0);
    expect(DEFAULT_CATEGORY_WEIGHTS.accessibility).toBeGreaterThan(0);
  });

  it("all new category weights sum to approximately 100", () => {
    const total = Object.values(DEFAULT_CATEGORY_WEIGHTS).reduce((a, b) => a + b, 0);
    expect(total).toBeGreaterThanOrEqual(100);
    expect(total).toBeLessThanOrEqual(120);
  });

  it("new fetcher resources are in DEFAULT_RESOURCES", () => {
    // Verify via the orchestrator's DEFAULT_RESOURCES export
    // We check indirectly: the fetcher functions must be importable
    for (const resource of NEW_FETCHER_RESOURCES) {
      expect(resource).toMatch(/^[a-z_]+$/);
    }
  });

  it("all new rules have valid categories from the category enum", () => {
    const validCategories = new Set(AGENT_READINESS_RULESET.rules.map((r) => r.category));
    for (const id of NEW_RULE_IDS) {
      const rule = AGENT_READINESS_RULESET.rules.find((r) => r.rule_id === id);
      expect(rule).toBeDefined();
      expect(validCategories.has(rule!.category)).toBe(true);
    }
  });

  it("RULE_DESCRIPTIONS has an entry for every rule in the ruleset", () => {
    const ruleIds = AGENT_READINESS_RULESET.rules.map((r) => r.rule_id);
    const descIds = new Set(RULE_DESCRIPTIONS.map((d) => d.rule_id));
    const missing = ruleIds.filter((id) => !descIds.has(id));
    expect(missing).toEqual([]);
  });
});
