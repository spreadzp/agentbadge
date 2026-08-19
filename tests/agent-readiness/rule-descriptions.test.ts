import { describe, it, expect } from "vitest";
import {
  RULE_DESCRIPTIONS,
  CATEGORY_DESCRIPTIONS,
  type RuleDescription,
} from "../../src/agent-readiness/rule-descriptions";
import { categoryEnum } from "../../src/agent-readiness/shared.schema";
import { AGENT_READINESS_RULESET } from "../../src/agent-readiness/ruleset";

describe("Rule Descriptions", () => {
  it("has descriptions for all 76 rules", () => {
    expect(RULE_DESCRIPTIONS.length).toBe(76);
  });

  it("every rule has required fields", () => {
    for (const r of RULE_DESCRIPTIONS) {
      expect(r.rule_id).toMatch(/^AB-\d{3}$/);
      expect(r.title).toBeTruthy();
      expect(r.short_description).toBeTruthy();
      expect(r.user_value).toBeTruthy();
      expect(r.wrong_example).toBeTruthy();
      expect(r.right_example).toBeTruthy();
      expect(["quick", "moderate", "complex"]).toContain(r.effort_hint);
      expect(r.estimated_cost).toBeTruthy();
      expect(r.icon).toBeTruthy();
    }
  });

  it("all categories have descriptions", () => {
    const categories = categoryEnum.options;
    for (const cat of categories) {
      expect(CATEGORY_DESCRIPTIONS[cat]).toBeDefined();
      expect(CATEGORY_DESCRIPTIONS[cat].title).toBeTruthy();
      expect(CATEGORY_DESCRIPTIONS[cat].description).toBeTruthy();
      expect(CATEGORY_DESCRIPTIONS[cat].icon).toBeTruthy();
    }
  });

  it("rule IDs are unique", () => {
    const ids = RULE_DESCRIPTIONS.map((r) => r.rule_id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("covers all 15 categories", () => {
    const cats = new Set(RULE_DESCRIPTIONS.map((r) => r.category));
    expect(cats.size).toBe(15);
  });

  it("every ruleset rule has a description", () => {
    const descIds = new Set(RULE_DESCRIPTIONS.map((r) => r.rule_id));
    for (const rule of AGENT_READINESS_RULESET.rules) {
      expect(descIds.has(rule.rule_id), `${rule.rule_id} should have a description`).toBe(true);
    }
  });

  it("no description contains technical implementation details", () => {
    const forbidden = [
      "Content-Type:",
      "application/json",
      "RFC 7033",
      "RFC 8288",
      "RFC 9727",
      "RFC 9728",
      "RFC 9309",
      "endpoint path",
      "JSON Schema",
      "zod",
      "200 OK",
      "402 Payment",
      "navigator.modelContext",
      "SVCB",
      "HTTPS record",
      "macaroon",
    ];
    for (const r of RULE_DESCRIPTIONS) {
      const text = `${r.title} ${r.short_description} ${r.wrong_example} ${r.right_example}`;
      for (const f of forbidden) {
        expect(text).not.toContain(f);
      }
    }
  });

  it("every rule category matches a valid category enum value", () => {
    const validCategories = categoryEnum.options;
    for (const r of RULE_DESCRIPTIONS) {
      expect(validCategories).toContain(r.category);
    }
  });

  it("effort hints are distributed across all three levels", () => {
    const hints = RULE_DESCRIPTIONS.map((r) => r.effort_hint);
    expect(new Set(hints).size).toBe(3);
  });
});
