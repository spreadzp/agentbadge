import { describe, it, expect } from "vitest";
import { buildRuleApiResponse } from "../../src/server/lib/rule-api-builder";
import { getRuleDescription } from "../../src/views/rule-detail-page";
import { RuleDetailPage } from "../../src/views/rule-detail-page";

describe("SLICE-115-3: /rules/:id.json content-negotiated route", () => {
  it("buildRuleApiResponse returns same data as /api/rules/:id", () => {
    const rule = buildRuleApiResponse("AB-001");
    expect(rule).not.toBeNull();
    expect(rule!.rule_id).toBe("AB-001");
    expect(rule!.checklist_anchor).toBe("#AB-001");
    expect(rule!.json_url).toBe("/rules/AB-001.json");
  });

  it("buildRuleApiResponse returns null for invalid rule (404)", () => {
    const rule = buildRuleApiResponse("INVALID");
    expect(rule).toBeNull();
  });

  it("HTML route still works — RuleDetailPage renders HTML", () => {
    const desc = getRuleDescription("AB-001");
    expect(desc).toBeDefined();
    const html = RuleDetailPage(desc!).toString();
    expect(html).toContain("AB-001");
    expect(html).toContain("<!DOCTYPE html>");
  });

  it("JSON response includes fields not in HTML: severity, check, fix, related_rules", () => {
    const json = buildRuleApiResponse("AB-001")!;
    expect(json.severity).toBeDefined();
    expect(json.check).toBeDefined();
    expect(json.fix).toBeDefined();
    expect(json.related_rules).toBeDefined();
    expect(json.version).toBeDefined();
    expect(json.counted_in_score).toBeDefined();
  });
});
