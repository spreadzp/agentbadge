import { describe, it, expect } from "vitest";
import { buildRuleApiResponse, buildRuleListApiResponse } from "../../src/server/lib/rule-api-builder";
import { getRuleDescription, RuleDetailPage } from "../../src/views/rule-detail-page";
import { RULE_DESCRIPTIONS } from "../../src/agent-readiness/rule-descriptions";
import { categoryEnum } from "../../src/agent-readiness/shared.schema";

describe("SLICE-115-5: Rule API E2E tests", () => {
  describe("API List Endpoint", () => {
    const list = buildRuleListApiResponse();

    it("returns list with total matching RULE_DESCRIPTIONS", () => {
      expect(list.length).toBe(RULE_DESCRIPTIONS.length);
    });

    it("each rule has severity field", () => {
      for (const rule of list) {
        expect(rule.severity).toMatch(/^(critical|high|medium|low)$/);
      }
    });

    it("each rule has pillar field", () => {
      for (const rule of list) {
        expect(rule.pillar).toBeDefined();
        expect(rule.pillar.length).toBeGreaterThan(0);
      }
    });

    it("each rule has check_type field", () => {
      for (const rule of list) {
        expect(rule.check_type).toBeDefined();
      }
    });

    it("each rule has existing fields (rule_id, title, category)", () => {
      for (const rule of list) {
        expect(rule.rule_id).toBeDefined();
        expect(rule.title).toBeDefined();
        expect(rule.category).toBeDefined();
      }
    });

    it("categories array has expected count", () => {
      const categories = categoryEnum.options;
      expect(categories.length).toBeGreaterThanOrEqual(15);
    });
  });

  describe("API Single Rule Endpoint", () => {
    const rule = buildRuleApiResponse("AB-001");

    it("returns rule_id AB-001", () => {
      expect(rule!.rule_id).toBe("AB-001");
    });

    it("has severity field", () => {
      expect(rule!.severity).toMatch(/^(critical|high|medium|low)$/);
    });

    it("has pillar field", () => {
      expect(rule!.pillar).toBeDefined();
    });

    it("has version field (semver)", () => {
      expect(rule!.version).toMatch(/^\d+\.\d+\.\d+$/);
    });

    it("has counted_in_score boolean", () => {
      expect(typeof rule!.counted_in_score).toBe("boolean");
    });

    it("has check object with type", () => {
      expect(rule!.check).toBeDefined();
      expect(rule!.check.type).toBeDefined();
    });

    it("has fix object with eligible and type", () => {
      expect(rule!.fix).toBeDefined();
      expect(typeof rule!.fix.eligible).toBe("boolean");
      expect(rule!.fix.type).toBeDefined();
    });

    it("has checklist_anchor #AB-001", () => {
      expect(rule!.checklist_anchor).toBe("#AB-001");
    });

    it("has checklist_url with /agent-readiness-checklist#AB-001", () => {
      expect(rule!.checklist_url).toContain("/agent-readiness-checklist");
      expect(rule!.checklist_url).toContain("#AB-001");
    });

    it("has html_url /rules/AB-001", () => {
      expect(rule!.html_url).toBe("/rules/AB-001");
    });

    it("has json_url /rules/AB-001.json", () => {
      expect(rule!.json_url).toBe("/rules/AB-001.json");
    });

    it("has related_rules array with same-category rules", () => {
      expect(Array.isArray(rule!.related_rules)).toBe(true);
      for (const r of rule!.related_rules) {
        expect(r.category).toBe(rule!.category);
        expect(r.rule_id).not.toBe("AB-001");
      }
    });

    it("INVALID returns null (404)", () => {
      expect(buildRuleApiResponse("INVALID")).toBeNull();
    });
  });

  describe("JSON Content-Negotiated Route", () => {
    it("buildRuleApiResponse matches /api/rules/:id response", () => {
      const json = buildRuleApiResponse("AB-001");
      expect(json).not.toBeNull();
      expect(json!.rule_id).toBe("AB-001");
    });

    it("INVALID returns null (404 for .json route)", () => {
      expect(buildRuleApiResponse("INVALID")).toBeNull();
    });

    it("HTML route still renders — RuleDetailPage returns HTML", () => {
      const desc = getRuleDescription("AB-001")!;
      const html = RuleDetailPage(desc).toString();
      expect(html).toContain("<!DOCTYPE html>");
      expect(html).toContain("AB-001");
    });
  });

  describe("HTML Page Enhancements", () => {
    const desc = getRuleDescription("AB-001")!;
    const html = RuleDetailPage(desc).toString();

    it("contains severity badge", () => {
      expect(html).toContain("Severity:");
    });

    it("contains alternate JSON link", () => {
      expect(html).toContain('rel="alternate"');
      expect(html).toContain('type="application/json"');
      expect(html).toContain("/rules/AB-001.json");
    });

    it("contains Machine-Readable section with .json link", () => {
      expect(html).toContain("Machine-Readable");
      expect(html).toContain("/rules/AB-001.json");
    });
  });

  describe("Backward Compatibility", () => {
    const rule = buildRuleApiResponse("AB-001");

    it("existing RuleDescription fields still present", () => {
      expect(rule!.title).toBeDefined();
      expect(rule!.short_description).toBeDefined();
      expect(rule!.user_value).toBeDefined();
      expect(rule!.wrong_example).toBeDefined();
      expect(rule!.right_example).toBeDefined();
      expect(rule!.effort_hint).toBeDefined();
      expect(rule!.estimated_cost).toBeDefined();
      expect(rule!.icon).toBeDefined();
    });

    it("HTML page still renders all existing sections", () => {
      const desc = getRuleDescription("AB-001")!;
      const html = RuleDetailPage(desc).toString();
      expect(html).toContain("What it means");
      expect(html).toContain("Why it matters");
      expect(html).toContain("What's wrong");
      expect(html).toContain("What's right");
    });
  });
});
