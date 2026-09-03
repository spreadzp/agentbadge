import { describe, it, expect } from "vitest";
import { RuleDetailPage, getRuleDescription } from "../../../src/views/rule-detail-page";
import { RulesCatalogPage } from "../../../src/views/rules-catalog-page";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";

describe("SLICE-94-11: RuleDetailPage — evidence expected line", () => {
  it("getRuleDescription returns a rule by id", () => {
    const rule = getRuleDescription("AB-001");
    expect(rule).toBeDefined();
    expect(rule?.rule_id).toBe("AB-001");
  });

  it("renders 'Evidence expected' section heading", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    expect(html).toContain("Evidence expected");
  });

  it("renders evidence type badges", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    expect(html).toContain("http");
  });

  it("renders source class label from hierarchy", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    expect(html).toContain("Source:");
  });

  it("renders evidence section between 'Why it matters' and 'What's wrong'", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    const whyIdx = html.indexOf("Why it matters");
    const evidenceIdx = html.indexOf("Evidence expected");
    const wrongIdx = html.indexOf("<h3 class=\"font-semibold text-rose-300\">What's wrong</h3>");
    expect(whyIdx).toBeGreaterThan(-1);
    expect(evidenceIdx).toBeGreaterThan(-1);
    expect(wrongIdx).toBeGreaterThan(-1);
    expect(whyIdx).toBeLessThan(evidenceIdx);
    expect(evidenceIdx).toBeLessThan(wrongIdx);
  });
});

describe("SLICE-96-9: RuleDetailPage — gap type + fix hint display", () => {
  it("renders gap type badge for every rule", () => {
    for (const rule of RULE_DESCRIPTIONS) {
      const html = RuleDetailPage(rule).toString();
      expect(html).toContain("Gap:");
    }
  });

  it("renders fix hint badge for every rule", () => {
    for (const rule of RULE_DESCRIPTIONS) {
      const html = RuleDetailPage(rule).toString();
      expect(html).toContain("Fix:");
    }
  });

  it("shows default gap type (no asterisk) for rules without override", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    // AB-001 is discovery category → default gap type is "documentation"
    expect(html).toContain("Gap: documentation");
    // No asterisk means no override
    expect(html).not.toContain("Gap: documentation *");
  });

  it("shows default fix hint based on gap type", () => {
    const rule = RULE_DESCRIPTIONS[0];
    const html = RuleDetailPage(rule).toString();
    // documentation → deterministic
    expect(html).toContain("Fix: deterministic");
  });
});

describe("SLICE-96-9: RulesCatalogPage — gap type legend", () => {
  it("renders gap type legend with all 4 types", () => {
    const html = RulesCatalogPage().toString();
    expect(html).toContain("Gap types:");
    expect(html).toContain("Documentation");
    expect(html).toContain("Semantic");
    expect(html).toContain("Capability");
    expect(html).toContain("Evidence");
  });

  it("renders gap type badge on rule cards", () => {
    const html = RulesCatalogPage().toString();
    // At least one rule card should show a gap type label
    expect(html).toContain("Documentation");
  });
});
