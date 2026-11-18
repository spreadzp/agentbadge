import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES } from "../../../src/server/lib/blog-data";
import { existsSync } from "fs";
import { join } from "path";

// agentGuideSlug is opt-in: articles may omit it; when set it must point to a
// real agent-guide markdown file and be unique across BLOG_ARTICLES.
describe("SLICE-119-2: Blog → Agent Guide mapping", () => {
  describe("Unit: agentGuideSlug validity", () => {
    const withSlug = BLOG_ARTICLES.filter((a) => a.agentGuideSlug !== undefined);

    it("at least one article maps to an agent guide", () => {
      expect(withSlug.length).toBeGreaterThan(0);
    });

    for (const article of withSlug) {
      it(`${article.slug} has non-empty agentGuideSlug`, () => {
        expect(typeof article.agentGuideSlug).toBe("string");
        expect(article.agentGuideSlug!.length).toBeGreaterThan(0);
      });
    }

    it("no duplicate agentGuideSlug values", () => {
      const slugs = withSlug.map((a) => a.agentGuideSlug);
      const unique = new Set(slugs);
      expect(unique.size).toBe(slugs.length);
    });
  });

  describe("Unit: agent-guide article files exist", () => {
    for (const article of BLOG_ARTICLES.filter((a) => a.agentGuideSlug)) {
      it(`file exists for ${article.agentGuideSlug}`, () => {
        const path = join(
          "src/server/agent-knowledge/articles",
          `${article.agentGuideSlug}.md`,
        );
        expect(existsSync(path)).toBe(true);
      });
    }
  });
});
