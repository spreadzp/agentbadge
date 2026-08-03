import { describe, it, expect } from "vitest";
import { loadGlossaryTerms } from "../src/server/services/glossary.service";
import type { GlossaryTermConfig } from "@agentgate-hedera/hedera-core";

describe("SLICE-25-6: Medical Glossary Terms", () => {
  const terms = loadGlossaryTerms();

  it("returns exactly 16 terms", () => {
    expect(terms).toHaveLength(16);
  });

  it("each term has all required fields", () => {
    for (const term of terms) {
      expect(term.id).toBeTruthy();
      expect(typeof term.id).toBe("string");
      expect(term.name).toBeTruthy();
      expect(typeof term.name).toBe("string");
      expect(term.description).toBeTruthy();
      expect(typeof term.description).toBe("string");
      expect(term.category).toBeTruthy();
      expect(typeof term.category).toBe("string");
      expect(Array.isArray(term.relatedDatasets)).toBe(true);
      expect(term.relatedDatasets.length).toBeGreaterThan(0);
    }
  });

  it("has no duplicate IDs", () => {
    const ids = terms.map((t) => t.id);
    const unique = new Set(ids);
    expect(unique.size).toBe(ids.length);
  });

  it("categories are valid", () => {
    const validCategories = ["cardiovascular", "endocrine", "general", "demographic"];
    for (const term of terms) {
      expect(validCategories).toContain(term.category);
    }
  });

  it("covers all 3 datasets in relatedDatasets", () => {
    const allDatasets = new Set<string>();
    for (const term of terms) {
      for (const ds of term.relatedDatasets) {
        allDatasets.add(ds);
      }
    }
    expect(allDatasets.has("heart_disease")).toBe(true);
    expect(allDatasets.has("pima_diabetes")).toBe(true);
    // Breast cancer dataset may use different name, check for common variants
    const hasBreastCancer = Array.from(allDatasets).some((d) =>
      d.includes("breast"),
    );
    expect(hasBreastCancer).toBe(true);
  });

  it("includes expected core terms", () => {
    const ids = terms.map((t) => t.id);
    expect(ids).toContain("hypertension");
    expect(ids).toContain("bmi");
    expect(ids).toContain("glucose");
    expect(ids).toContain("cholesterol");
    expect(ids).toContain("insulin");
  });

  it("terms are typed as GlossaryTermConfig", () => {
    const sample: GlossaryTermConfig = terms[0];
    expect(sample).toBeDefined();
    expect(sample.id).toBeTruthy();
  });
});
