import { describe, it, expect } from "vitest";
import {
  RAW_FAQ_ENTRIES,
  FAQ_CATEGORIES,
  HOMEPAGE_FAQ,
  slugifyQuestion,
  getFaqEntries,
} from "../../../src/views/faq-page";

describe("SLICE-118-1: FAQ data expansion", () => {
  describe("RAW_FAQ_ENTRIES", () => {
    it("has >= 40 entries", () => {
      expect(RAW_FAQ_ENTRIES.length).toBeGreaterThanOrEqual(40);
    });

    it("has <= 100 entries", () => {
      expect(RAW_FAQ_ENTRIES.length).toBeLessThanOrEqual(100);
    });

    it("has no duplicate questions", () => {
      const questions = RAW_FAQ_ENTRIES.map((e) => e.question);
      const unique = new Set(questions);
      expect(unique.size).toBe(questions.length);
    });

    it("has no duplicate anchor slugs", () => {
      const slugs = RAW_FAQ_ENTRIES.map((e) => slugifyQuestion(e.question));
      const unique = new Set(slugs);
      expect(unique.size).toBe(slugs.length);
    });
  });

  describe("slugifyQuestion", () => {
    it('slugifies "What is Agent Readiness?" correctly', () => {
      expect(slugifyQuestion("What is Agent Readiness?")).toBe("what-is-agent-readiness");
    });

    it('slugifies "Is OpenAPI enough?" correctly', () => {
      expect(slugifyQuestion("Is OpenAPI enough?")).toBe("is-openapi-enough");
    });

    it("removes periods and question marks", () => {
      expect(slugifyQuestion("What is GEO?")).toBe("what-is-geo");
    });

    it("replaces non-alphanumeric with hyphens", () => {
      expect(slugifyQuestion("What is the A2A protocol?")).toBe("what-is-the-a2a-protocol");
    });
  });

  describe("FAQ_CATEGORIES", () => {
    it("has 8 categories", () => {
      expect(FAQ_CATEGORIES.length).toBe(8);
    });

    it("every questionSlug matches a slugified question in RAW_FAQ_ENTRIES", () => {
      const allSlugs = new Set(RAW_FAQ_ENTRIES.map((e) => slugifyQuestion(e.question)));
      for (const cat of FAQ_CATEGORIES) {
        for (const slug of cat.questionSlugs) {
          expect(allSlugs.has(slug)).toBe(true);
        }
      }
    });

    it("each category has a name and slug", () => {
      for (const cat of FAQ_CATEGORIES) {
        expect(cat.name).toBeDefined();
        expect(cat.slug).toBeDefined();
        expect(cat.questionSlugs.length).toBeGreaterThan(0);
      }
    });
  });

  describe("HOMEPAGE_FAQ", () => {
    it("has exactly 5 entries", () => {
      expect(HOMEPAGE_FAQ.length).toBe(5);
    });

    it("each item's faqAnchor matches slugifyQuestion(question)", () => {
      for (const item of HOMEPAGE_FAQ) {
        expect(item.faqAnchor).toBe(slugifyQuestion(item.question));
      }
    });

    it("each item has question, shortAnswer, faqAnchor", () => {
      for (const item of HOMEPAGE_FAQ) {
        expect(item.question).toBeDefined();
        expect(item.shortAnswer).toBeDefined();
        expect(item.faqAnchor).toBeDefined();
      }
    });
  });

  describe("getFaqEntries (chain templates applied)", () => {
    it("returns same count as RAW_FAQ_ENTRIES", () => {
      const entries = getFaqEntries();
      expect(entries.length).toBe(RAW_FAQ_ENTRIES.length);
    });
  });
});
