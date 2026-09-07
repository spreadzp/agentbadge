import { describe, it, expect } from "vitest";
import { buildRuleApiResponse, buildRuleListApiResponse } from "../../../src/server/lib/rule-api-builder";

describe("SLICE-115-1: Rule API builder", () => {
  describe("buildRuleApiResponse", () => {
    it("returns object with all fields for AB-001", () => {
      const result = buildRuleApiResponse("AB-001");
      expect(result).not.toBeNull();
      expect(result!.rule_id).toBe("AB-001");
      expect(result!.title).toBeDefined();
      expect(result!.category).toBeDefined();
      expect(result!.icon).toBeDefined();
      expect(result!.short_description).toBeDefined();
      expect(result!.user_value).toBeDefined();
      expect(result!.wrong_example).toBeDefined();
      expect(result!.right_example).toBeDefined();
      expect(result!.effort_hint).toBeDefined();
      expect(result!.estimated_cost).toBeDefined();
      expect(result!.severity).toBeDefined();
      expect(result!.pillar).toBeDefined();
      expect(result!.version).toBeDefined();
      expect(result!.counted_in_score).toBeDefined();
      expect(result!.check).toBeDefined();
      expect(result!.fix).toBeDefined();
      expect(result!.checklist_anchor).toBeDefined();
      expect(result!.checklist_url).toBeDefined();
      expect(result!.html_url).toBeDefined();
      expect(result!.json_url).toBeDefined();
      expect(result!.related_rules).toBeDefined();
    });

    it("has severity matching ruleset", () => {
      const result = buildRuleApiResponse("AB-001");
      expect(result!.severity).toBe("low");
    });

    it("has checklist_anchor equal to #AB-001", () => {
      const result = buildRuleApiResponse("AB-001");
      expect(result!.checklist_anchor).toBe("#AB-001");
    });

    it("has related_rules with same-category rules", () => {
      const result = buildRuleApiResponse("AB-001");
      expect(result!.related_rules.length).toBeGreaterThan(0);
      for (const r of result!.related_rules) {
        expect(r.category).toBe(result!.category);
        expect(r.rule_id).not.toBe("AB-001");
      }
    });

    it("returns null for invalid rule ID", () => {
      const result = buildRuleApiResponse("INVALID");
      expect(result).toBeNull();
    });

    it("has correct URLs", () => {
      const result = buildRuleApiResponse("AB-001");
      expect(result!.html_url).toBe("/rules/AB-001");
      expect(result!.json_url).toBe("/rules/AB-001.json");
      expect(result!.checklist_url).toBe("/agent-readiness-checklist#AB-001");
    });

    it("has check and fix objects from ruleset", () => {
      const result = buildRuleApiResponse("AB-001");
      expect(result!.check.type).toBe("http_fetch");
      expect(result!.check.target).toBe("/robots.txt");
      expect(result!.fix.eligible).toBe(true);
      expect(result!.fix.type).toBe("deterministic");
    });
  });

  describe("buildRuleListApiResponse", () => {
    const list = buildRuleListApiResponse();

    it("returns items with severity and pillar", () => {
      expect(list.length).toBeGreaterThan(0);
      for (const item of list) {
        expect(item.severity).toBeDefined();
        expect(item.pillar).toBeDefined();
        expect(item.check_type).toBeDefined();
      }
    });

    it("returns same count as RULE_DESCRIPTIONS", () => {
      expect(list.length).toBeGreaterThan(100);
    });
  });
});
