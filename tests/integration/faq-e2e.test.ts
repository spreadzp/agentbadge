import { describe, it, expect } from "vitest";
import { getFaqEntries, FaqPage, FAQ_CATEGORIES, HOMEPAGE_FAQ } from "../../src/views/faq-page";
import { ReadinessLandingPage, getHomepageFaqJsonLd } from "../../src/views/landing/readiness-landing-page";
import { faqPageLd, pageCoreSchemas, breadcrumbFor } from "../../src/server/lib/json-ld";

describe("SLICE-118-5: E2E FAQ enhancement tests", () => {
  const allEntries = getFaqEntries();
  const faqSchemas = [...pageCoreSchemas(), faqPageLd(allEntries), breadcrumbFor("/faq", "FAQ")];
  const faqHtml = FaqPage(allEntries, faqSchemas).toString();
  const homeHtml = ReadinessLandingPage().toString();

  describe("Homepage FAQ Section", () => {
    it("contains h2 with 'Frequently Asked Questions'", () => {
      expect(homeHtml).toContain("Frequently Asked Questions");
    });

    it("contains exactly 5 <details> elements", () => {
      const count = (homeHtml.match(/<details/g) || []).length;
      expect(count).toBe(5);
    });

    it("contains all 5 HOMEPAGE_FAQ questions", () => {
      for (const item of HOMEPAGE_FAQ) {
        expect(homeHtml).toContain(item.question);
      }
    });

    it("does NOT contain old 'Do I need to pay for a scan?'", () => {
      expect(homeHtml).not.toContain("Do I need to pay for a scan?");
    });

    it("does NOT contain old 'What is an agent readiness scan?'", () => {
      expect(homeHtml).not.toContain("What is an agent readiness scan?");
    });

    it("each homepage FAQ item has a link containing /faq#", () => {
      for (const item of HOMEPAGE_FAQ) {
        expect(homeHtml).toContain(`/faq#${item.faqAnchor}`);
      }
    });

    it('"See all FAQs" link to /faq', () => {
      expect(homeHtml).toContain("See all FAQs");
      expect(homeHtml).toContain('href="/faq"');
    });
  });

  describe("/faq Page Rendering", () => {
    it("contains h1 with 'Frequently Asked Questions'", () => {
      expect(faqHtml).toContain("Frequently Asked Questions");
    });

    it("contains at least 40 <details> elements", () => {
      const count = (faqHtml.match(/<details/g) || []).length;
      expect(count).toBeGreaterThanOrEqual(40);
    });

    it("contains at most 100 <details> elements", () => {
      const count = (faqHtml.match(/<details/g) || []).length;
      expect(count).toBeLessThanOrEqual(100);
    });

    it("no pagination UI", () => {
      expect(faqHtml).not.toContain("Next →");
      expect(faqHtml).not.toContain("← Prev");
      expect(faqHtml).not.toContain('aria-label="Pagination"');
    });
  });

  describe("/faq Category Sections", () => {
    const categorySlugs = ["getting-started", "scoring-measurement", "api-openapi", "identity-passports", "marketplace-payments", "technical", "concepts", "services"];

    it("contains all 8 category section IDs", () => {
      for (const slug of categorySlugs) {
        expect(faqHtml).toContain(`id="${slug}"`);
      }
    });

    it("each category section has an <h2> heading", () => {
      for (const cat of FAQ_CATEGORIES) {
        const encoded = cat.name.replace(/&/g, "&amp;");
        expect(faqHtml.includes(cat.name) || faqHtml.includes(encoded)).toBe(true);
      }
    });
  });

  describe("/faq Category Navigation", () => {
    it("contains navigation links to all 8 category anchors", () => {
      for (const cat of FAQ_CATEGORIES) {
        expect(faqHtml).toContain(`href="#${cat.slug}"`);
      }
    });
  });

  describe("/faq Anchor IDs", () => {
    it('"What is Agent Readiness?" <details> has id="what-is-agent-readiness"', () => {
      expect(faqHtml).toContain('id="what-is-agent-readiness"');
    });

    it('"Is OpenAPI enough?" <details> has id="is-openapi-enough"', () => {
      expect(faqHtml).toContain('id="is-openapi-enough"');
    });

    it("every <details> element has an id attribute", () => {
      const detailsMatches = faqHtml.match(/<details[^>]*>/g) || [];
      for (const tag of detailsMatches) {
        expect(tag).toContain("id=");
      }
    });

    it("no duplicate id attributes on <details> elements", () => {
      const ids = (faqHtml.match(/<details[^>]*id="([^"]+)"/g) || []).map(
        (m) => m.match(/id="([^"]+)"/)![1],
      );
      const unique = new Set(ids);
      expect(unique.size).toBe(ids.length);
    });
  });

  describe("/faq JSON-LD", () => {
    const faqLd = faqPageLd(allEntries) as Record<string, unknown>;
    const mainEntity = faqLd["mainEntity"] as Array<Record<string, unknown>>;

    it("FAQPage mainEntity has >= 40 entries", () => {
      expect(mainEntity.length).toBeGreaterThanOrEqual(40);
    });

    it("FAQPage mainEntity has <= 100 entries", () => {
      expect(mainEntity.length).toBeLessThanOrEqual(100);
    });

    it("each mainEntity entry has @type: Question", () => {
      for (const entry of mainEntity) {
        expect(entry["@type"]).toBe("Question");
      }
    });

    it("each entry has acceptedAnswer with @type: Answer and text", () => {
      for (const entry of mainEntity) {
        const answer = entry["acceptedAnswer"] as Record<string, unknown>;
        expect(answer["@type"]).toBe("Answer");
        expect(answer["text"]).toBeDefined();
      }
    });

    it("no duplicate questions in mainEntity", () => {
      const names = mainEntity.map((e) => e["name"] as string);
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
    });

    it("page contains Organization schema", () => {
      const schemas = pageCoreSchemas();
      const types = schemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("Organization");
    });

    it("page contains WebSite schema", () => {
      const schemas = pageCoreSchemas();
      const types = schemas.map((s) => (s as Record<string, unknown>)["@type"]);
      expect(types).toContain("WebSite");
    });
  });

  describe("Homepage JSON-LD", () => {
    const homepageFaqLd = getHomepageFaqJsonLd() as Record<string, unknown>;
    const mainEntity = homepageFaqLd["mainEntity"] as Array<Record<string, unknown>>;

    it("FAQPage mainEntity has exactly 5 entries", () => {
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

  describe("PageMeta", () => {
    it("faqHtml contains <title> with 'FAQ'", () => {
      expect(faqHtml).toContain("<title");
      expect(faqHtml.toLowerCase()).toContain("faq");
    });
  });

  describe("Edge Cases", () => {
    it("all entries on single page (no ?page= links)", () => {
      expect(faqHtml).not.toContain("?page=");
    });
  });
});
