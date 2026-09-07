import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES } from "../../../src/server/lib/blog-data";
import { BlogArticlePage } from "../../../src/views/blog-article";

describe("SLICE-113-3: Blog article contextual links", () => {
  it("first article has relatedLinks populated", () => {
    const article = BLOG_ARTICLES.find((a) => a.slug === "what-is-agent-readiness");
    expect(article).toBeDefined();
    expect(article!.relatedLinks).toBeDefined();
    expect(article!.relatedLinks!.length).toBeGreaterThan(0);
  });

  it("second article has relatedLinks populated", () => {
    const article = BLOG_ARTICLES.find((a) => a.slug === "api-has-seo-agent-readiness");
    expect(article).toBeDefined();
    expect(article!.relatedLinks).toBeDefined();
    expect(article!.relatedLinks!.length).toBeGreaterThan(0);
  });

  it("BlogArticlePage renders 'Learn More' section when relatedLinks present", () => {
    const article = BLOG_ARTICLES.find((a) => a.slug === "what-is-agent-readiness")!;
    const html = BlogArticlePage(article).toString();
    expect(html).toContain("Learn More");
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/services/scanner"');
  });

  it("BlogArticlePage does not render 'Learn More' when relatedLinks absent", () => {
    const article = BLOG_ARTICLES.find((a) => !a.relatedLinks || a.relatedLinks.length === 0);
    if (article) {
      const html = BlogArticlePage(article).toString();
      expect(html).not.toContain("Learn More");
    }
  });
});
