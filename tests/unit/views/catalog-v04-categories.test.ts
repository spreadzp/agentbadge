import { describe, it, expect } from "vitest";
import { RulesCatalogPage } from "../../../src/views/rules-catalog-page";
import { CATEGORY_DESCRIPTIONS } from "../../../src/agent-readiness/rule-descriptions";
import { CATEGORY_TO_PILLAR, PILLAR_LABELS } from "../../../src/agent-readiness/scoring/pillar-map";

/**
 * SLICE-95-11: Catalog view tests for v0.4 semantic categories
 * Verifies the 7 new categories render in the catalog with descriptions and pillar mapping.
 */

const NEW_CATEGORIES = [
  "pricing",
  "rate_limits",
  "error_semantics",
  "retry_semantics",
  "sandbox",
  "versioning",
  "agent_policy",
] as const;

describe("SLICE-95-11: Rules catalog — v0.4 category legend entries", () => {
  const html = RulesCatalogPage().toString();

  for (const cat of NEW_CATEGORIES) {
    it(`${cat}: title appears in catalog HTML`, () => {
      const desc = CATEGORY_DESCRIPTIONS[cat];
      expect(desc).toBeDefined();
      expect(html).toContain(desc.title);
    });

    it(`${cat}: description appears in catalog HTML`, () => {
      const desc = CATEGORY_DESCRIPTIONS[cat];
      expect(html).toContain(desc.description);
    });

    it(`${cat}: icon appears in catalog HTML`, () => {
      const desc = CATEGORY_DESCRIPTIONS[cat];
      expect(html).toContain(desc.icon);
    });

    it(`${cat}: maps to correct pillar label in catalog`, () => {
      const pillar = CATEGORY_TO_PILLAR[cat];
      const label = PILLAR_LABELS[pillar];
      expect(html).toContain(label);
    });
  }

  it("all 7 new category titles are present", () => {
    for (const cat of NEW_CATEGORIES) {
      expect(html).toContain(CATEGORY_DESCRIPTIONS[cat].title);
    }
  });
});
