import { describe, it, expect } from "vitest";
import { getFaqEntries } from "../../src/views/faq-page";
import { getHomepageFaqJsonLd } from "../../src/views/landing/readiness-landing-page";
import { faqPageLd, pageCoreSchemas } from "../../src/server/lib/json-ld";

describe("SLICE-118-4: JSON-LD — All Entries FAQPage + Homepage FAQPage", () => {
  describe("/faq page JSON-LD", () => {
    const allEntries = getFaqEntries();
    const faqLd = faqPageLd(allEntries) as Record<string, unknown>;
    const mainEntity = faqLd["mainEntity"] as Array<Record<string, unknown>>;

    it("contains FAQPage type", () => {
      expect(faqLd["@type"]).toBe("FAQPage");
    });

    it("mainEntity has >= 40 entries", () => {
      expect(mainEntity.length).toBeGreaterThanOrEqual(40);
    });

    it("mainEntity has <= 100 entries", () => {
      expect(mainEntity.length).toBeLessThanOrEqual(100);
    });

    it("each entry has @type: Question", () => {
      for (const entry of mainEntity) {
        expect(entry["@type"]).toBe("Question");
      }
    });

    it("each entry has acceptedAnswer with @type: Answer", () => {
      for (const entry of mainEntity) {
        const answer = entry["acceptedAnswer"] as Record<string, unknown>;
        expect(answer).toBeDefined();
        expect(answer["@type"]).toBe("Answer");
        expect(answer["text"]).toBeDefined();
      }
    });

    it("no duplicate questions in mainEntity", () => {
      const names = mainEntity.map((e) => e["name"]);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });
  });

  describe("Homepage JSON-LD", () => {
    const homepageFaqLd = getHomepageFaqJsonLd() as Record<string, unknown>;
    const mainEntity = homepageFaqLd["mainEntity"] as Array<Record<string, unknown>>;

    it("contains FAQPage type", () => {
      expect(homepageFaqLd["@type"]).toBe("FAQPage");
    });

    it("mainEntity has exactly 5 entries", () => {
      expect(mainEntity).toHaveLength(5);
    });

    it('contains "What is Agent Readiness?" question', () => {
      const names = mainEntity.map((e) => e["name"] as string);
      expect(names).toContain("What is Agent Readiness?");
    });

    it('contains "Is OpenAPI enough?" question', () => {
      const names = mainEntity.map((e) => e["name"] as string);
      expect(names).toContain("Is OpenAPI enough?");
    });
  });

  describe("Both pages have core schemas", () => {
    it("pageCoreSchemas returns Organization and WebSite", () => {
      const schemas = pageCoreSchemas();
      const types = schemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("Organization");
      expect(types).toContain("WebSite");
    });
  });
});
