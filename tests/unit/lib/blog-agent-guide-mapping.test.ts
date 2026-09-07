import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES } from "../../../src/server/lib/blog-data";
import { existsSync } from "fs";
import { join } from "path";

describe("SLICE-119-2: Blog → Agent Guide mapping", () => {
  describe("Unit: every BLOG_ARTICLES entry has agentGuideSlug", () => {
    for (const article of BLOG_ARTICLES) {
      it(`${article.slug} has agentGuideSlug set (non-empty string)`, () => {
        expect(article.agentGuideSlug).toBeDefined();
        expect(typeof article.agentGuideSlug).toBe("string");
        expect(article.agentGuideSlug!.length).toBeGreaterThan(0);
      });
    }

    it("no duplicate agentGuideSlug values", () => {
      const slugs = BLOG_ARTICLES.map((a) => a.agentGuideSlug);
      const unique = new Set(slugs);
      expect(unique.size).toBe(slugs.length);
    });
  });

  describe("Unit: agent-guide article files exist", () => {
    for (const article of BLOG_ARTICLES) {
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
