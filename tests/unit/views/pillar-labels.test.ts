import { describe, it, expect } from "vitest";
import { RulesCatalogPage } from "../../../src/views/rules-catalog-page";
import { RuleDetailPage } from "../../../src/views/rule-detail-page";
import { PILLAR_LABELS, PILLAR_QUESTIONS, CATEGORY_TO_PILLAR } from "../../../src/agent-readiness/scoring/pillar-map";
import { RULE_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";

/**
 * SLICE-93-12: View tests for pillar labels
 * Catalog groups by pillar with labels + questions + weights.
 * Rule detail shows the derived pillar next to category.
 */

describe("SLICE-93-12: Rules catalog has pillar grouping", () => {
  const html = RulesCatalogPage().toString();

  it("contains all 4 pillar labels", () => {
    for (const label of Object.values(PILLAR_LABELS)) {
      expect(html).toContain(label);
    }
  });

  it("contains all 4 pillar questions", () => {
    for (const question of Object.values(PILLAR_QUESTIONS)) {
      expect(html).toContain(question);
    }
  });

  it("contains pillar weight numbers (20, 25, 30)", () => {
    expect(html).toContain("20");
    expect(html).toContain("25");
    expect(html).toContain("30");
  });

  it("contains pillar section headers", () => {
    expect(html).toContain("Discovery");
    expect(html).toContain("Understandability");
    expect(html).toContain("Executability");
    expect(html).toContain("Verifiability");
  });
});

describe("SLICE-93-12: Rule detail page shows pillar", () => {
  const firstRule = RULE_DESCRIPTIONS[0];
  const html = RuleDetailPage(firstRule).toString();

  it("contains 'Pillar:' label", () => {
    expect(html).toContain("Pillar:");
  });

  it("shows the derived pillar label for the rule's category", () => {
    const expectedPillar = CATEGORY_TO_PILLAR[firstRule.category];
    const expectedLabel = PILLAR_LABELS[expectedPillar];
    expect(html).toContain(expectedLabel);
  });

  it("shows pillar for multiple rules across different pillars", () => {
    const openapiRule = RULE_DESCRIPTIONS.find((r) => r.category === "openapi");
    const docsRule = RULE_DESCRIPTIONS.find((r) => r.category === "documentation");
    const paymentsRule = RULE_DESCRIPTIONS.find((r) => r.category === "payments");
    const verificationRule = RULE_DESCRIPTIONS.find((r) => r.category === "verification");

    if (openapiRule) {
      const h = RuleDetailPage(openapiRule).toString();
      expect(h).toContain("Pillar:");
      expect(h).toContain("Discovery");
    }
    if (docsRule) {
      const h = RuleDetailPage(docsRule).toString();
      expect(h).toContain("Pillar:");
      expect(h).toContain("Understandability");
    }
    if (paymentsRule) {
      const h = RuleDetailPage(paymentsRule).toString();
      expect(h).toContain("Pillar:");
      expect(h).toContain("Executability");
    }
    if (verificationRule) {
      const h = RuleDetailPage(verificationRule).toString();
      expect(h).toContain("Pillar:");
      expect(h).toContain("Verifiability");
    }
  });
});
