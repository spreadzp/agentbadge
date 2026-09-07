import { describe, it, expect } from "vitest";
import { buildRuleApiResponse, buildRuleListApiResponse } from "../../src/server/lib/rule-api-builder";

describe("SLICE-115-2: Enhanced API endpoints", () => {
  describe("GET /api/rules (buildRuleListApiResponse)", () => {
    const list = buildRuleListApiResponse();

    it("returns list with total > 100", () => {
      expect(list.length).toBeGreaterThan(100);
    });

    it("each rule has severity, pillar, check_type", () => {
      for (const rule of list) {
        expect(rule.severity).toMatch(/^(high|medium|low|critical)$/);
        expect(rule.pillar).toBeDefined();
        expect(rule.check_type).toBeDefined();
      }
    });

    it("each rule has existing RuleDescription fields", () => {
      for (const rule of list) {
        expect(rule.rule_id).toBeDefined();
        expect(rule.title).toBeDefined();
        expect(rule.category).toBeDefined();
        expect(rule.icon).toBeDefined();
      }
    });
  });

  describe("GET /api/rules/:id (buildRuleApiResponse)", () => {
    it("AB-001 returns full RuleApiResponse", () => {
      const rule = buildRuleApiResponse("AB-001");
      expect(rule).not.toBeNull();
      expect(rule!.rule_id).toBe("AB-001");
      expect(rule!.severity).toBe("low");
      expect(rule!.checklist_anchor).toBe("#AB-001");
      expect(rule!.related_rules).toBeDefined();
      expect(Array.isArray(rule!.related_rules)).toBe(true);
      expect(rule!.version).toBeDefined();
      expect(rule!.check).toBeDefined();
      expect(rule!.fix).toBeDefined();
    });

    it("INVALID returns null (404)", () => {
      const rule = buildRuleApiResponse("INVALID");
      expect(rule).toBeNull();
    });
  });
});
