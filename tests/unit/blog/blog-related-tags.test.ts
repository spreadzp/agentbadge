import { describe, it, expect } from "vitest";
import {
  BLOG_ARTICLES,
  getRelatedArticles,
  getTagCounts,
  filterByTag,
  type BlogArticle,
} from "../../../src/server/lib/blog-data";

describe("SLICE-113-2: Blog data helpers", () => {
  const mockArticles: BlogArticle[] = [
    {
      slug: "article-a",
      title: "Article A",
      description: "About MCP",
      author: "Test",
      authorRole: "Tester",
      date: "2025-01-01",
      tags: ["mcp", "agents", "api"],
      readingTime: "5 min",
      content: "",
    } as BlogArticle,
    {
      slug: "article-b",
      title: "Article B",
      description: "About agents",
      author: "Test",
      authorRole: "Tester",
      date: "2025-02-01",
      tags: ["mcp", "agents"],
      readingTime: "3 min",
      content: "",
    } as BlogArticle,
    {
      slug: "article-c",
      title: "Article C",
      description: "About payments",
      author: "Test",
      authorRole: "Tester",
      date: "2025-03-01",
      tags: ["payments", "x402"],
      readingTime: "7 min",
      content: "",
    } as BlogArticle,
  ];

  it("getRelatedArticles returns articles with most shared tags, excludes current", () => {
    const related = getRelatedArticles(mockArticles[0], mockArticles);
    expect(related).toHaveLength(1);
    expect(related[0].slug).toBe("article-b");
    expect(related.find((a) => a.slug === "article-a")).toBeUndefined();
  });

  it("getRelatedArticles returns empty when no shared tags", () => {
    const related = getRelatedArticles(mockArticles[2], mockArticles);
    expect(related).toHaveLength(0);
  });

  it("getTagCounts returns correct counts sorted by frequency", () => {
    const counts = getTagCounts(mockArticles);
    expect(counts).toContainEqual({ tag: "mcp", count: 2 });
    expect(counts).toContainEqual({ tag: "agents", count: 2 });
    expect(counts).toContainEqual({ tag: "payments", count: 1 });
    expect(counts[0].count).toBeGreaterThanOrEqual(counts[2].count);
  });

  it("filterByTag filters correctly", () => {
    const filtered = filterByTag(mockArticles, "mcp");
    expect(filtered).toHaveLength(2);
    expect(filtered.map((a) => a.slug)).toContain("article-a");
    expect(filtered.map((a) => a.slug)).toContain("article-b");
    expect(filtered.find((a) => a.slug === "article-c")).toBeUndefined();
  });

  it("filterByTag returns empty for non-existent tag", () => {
    const filtered = filterByTag(mockArticles, "nonexistent");
    expect(filtered).toHaveLength(0);
  });

  it("getRelatedArticles with real BLOG_ARTICLES does not throw", () => {
    if (BLOG_ARTICLES.length > 0) {
      const related = getRelatedArticles(BLOG_ARTICLES[0], BLOG_ARTICLES);
      expect(related.length).toBeLessThanOrEqual(3);
      expect(related.find((a) => a.slug === BLOG_ARTICLES[0].slug)).toBeUndefined();
    }
  });
});
