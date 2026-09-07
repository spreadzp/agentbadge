import { describe, it, expect } from "vitest";
import { getFaqEntries, FaqPage, FAQ_CATEGORIES } from "../../src/views/faq-page";
import { faqPageLd, pageCoreSchemas, breadcrumbFor } from "../../src/server/lib/json-ld";

describe("SLICE-118-2: FAQ page category layout", () => {
  const entries = getFaqEntries();
  const schemas = [...pageCoreSchemas(), faqPageLd(entries), breadcrumbFor("/faq", "FAQ")];
  const html = FaqPage(entries, schemas).toString();

  it("returns a string (HTML)", () => {
    expect(typeof html).toBe("string");
  });

  it("contains h1 with 'Frequently Asked Questions'", () => {
    expect(html).toContain("Frequently Asked Questions");
  });

  it("contains all 8 category section headings", () => {
    for (const cat of FAQ_CATEGORIES) {
      // & may be HTML-encoded as &amp; in the output
      const encoded = cat.name.replace(/&/g, "&amp;");
      expect(html.includes(cat.name) || html.includes(encoded)).toBe(true);
    }
  });

  it('contains id="getting-started" section', () => {
    expect(html).toContain('id="getting-started"');
  });

  it('contains id="scoring-measurement" section', () => {
    expect(html).toContain('id="scoring-measurement"');
  });

  it("each FAQ entry has scroll-mt-8 class and id attribute", () => {
    expect(html).toContain("scroll-mt-8");
    expect(html).toContain('id="what-is-agentbadge"');
  });

  it("category navigation sidebar contains links to all category anchors", () => {
    for (const cat of FAQ_CATEGORIES) {
      expect(html).toContain(`href="#${cat.slug}"`);
    }
  });

  it("no pagination UI (no 'Next page' / 'Previous page' links)", () => {
    expect(html).not.toContain("Next →");
    expect(html).not.toContain("← Prev");
    expect(html).not.toContain("aria-label=\"Pagination\"");
  });

  it("all entries on single page (no ?page= links)", () => {
    expect(html).not.toContain("?page=");
  });

  it("at least 40 <details> elements on the page", () => {
    const count = (html.match(/<details/g) || []).length;
    expect(count).toBeGreaterThanOrEqual(40);
  });
});
