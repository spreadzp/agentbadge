import { describe, it, expect } from "vitest";
import { buildRuleApiResponse, buildRuleListApiResponse } from "../../../src/server/lib/rule-api-builder";

describe("SLICE-115-2: Enhanced API endpoints", () => {
  describe("GET /api/rules (list)", () => {
    const list = buildRuleListApiResponse();

    it("returns total > 100 rules", () => {
      expect(list.length).toBeGreaterThan(100);
    });

    it("each rule has severity, pillar, check_type", () => {
      for (const rule of list) {
        expect(rule.severity).toMatch(/^(high|medium|low)$/);
        expect(rule.pillar).toBeDefined();
        expect(rule.check_type).toBeDefined();
      }
    });

    it("includes existing fields (rule_id, title, category)", () => {
      expect(list[0].rule_id).toMatch(/^AB-\d+$/);
      expect(list[0].title).toBeDefined();
      expect(list[0].category).toBeDefined();
    });
  });

  describe("GET /api/rules/:id (single)", () => {
    const rule = buildRuleApiResponse("AB-001");

    it("returns 200 equivalent with full RuleApiResponse", () => {
      expect(rule).not.toBeNull();
      expect(rule!.rule_id).toBe("AB-001");
    });

    it("includes checklist_anchor: #AB-001", () => {
      expect(rule!.checklist_anchor).toBe("#AB-001");
    });

    it("includes related_rules array", () => {
      expect(Array.isArray(rule!.related_rules)).toBe(true);
      expect(rule!.related_rules.length).toBeGreaterThan(0);
    });

    it("includes severity, version, check, fix", () => {
      expect(rule!.severity).toBeDefined();
      expect(rule!.version).toBeDefined();
      expect(rule!.check).toBeDefined();
      expect(rule!.fix).toBeDefined();
    });

    it("returns null for INVALID rule (404 equivalent)", () => {
      const invalid = buildRuleApiResponse("INVALID");
      expect(invalid).toBeNull();
    });
  });
});
