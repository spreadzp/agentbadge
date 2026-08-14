import { describe, it, expect } from "vitest";
import {
  paginateArticles,
  ARTICLES_PER_PAGE,
  type BlogArticle,
} from "../../src/server/lib/blog-data";

function makeArticles(n: number): BlogArticle[] {
  return Array.from({ length: n }, (_, i) => ({
    slug: `article-${i + 1}`,
    title: `Article ${i + 1}`,
    description: `Description ${i + 1}`,
    author: "Test",
    authorRole: "Tester",
    date: "2026-08-14",
    tags: ["test"],
    readingTime: "5 min",
    content: `<p>Content ${i + 1}</p>`,
  }));
}

describe("paginateArticles", () => {
  it("returns at most ARTICLES_PER_PAGE (9) items for page 1", () => {
    const articles = makeArticles(20);
    const { items, meta } = paginateArticles(articles, 1);
    expect(items.length).toBeLessThanOrEqual(ARTICLES_PER_PAGE);
    expect(items.length).toBe(9);
    expect(meta.currentPage).toBe(1);
  });

  it("returns correct slice for page 2", () => {
    const articles = makeArticles(20);
    const page1 = paginateArticles(articles, 1);
    const page2 = paginateArticles(articles, 2);
    expect(page2.items[0].slug).not.toBe(page1.items[0].slug);
    expect(page2.items.length).toBe(9);
    expect(page2.items[0].slug).toBe("article-10");
  });

  it("returns remaining items on last page", () => {
    const articles = makeArticles(11);
    const { items, meta } = paginateArticles(articles, 2);
    expect(meta.totalPages).toBe(2);
    expect(items.length).toBe(2);
    expect(items[0].slug).toBe("article-10");
    expect(items[1].slug).toBe("article-11");
  });

  it("clamps page > totalPages to last page", () => {
    const articles = makeArticles(20);
    const { meta, items } = paginateArticles(articles, 999);
    expect(meta.currentPage).toBe(meta.totalPages);
    expect(meta.currentPage).toBe(3);
    expect(items.length).toBe(2);
  });

  it("clamps page < 1 to page 1", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, 0);
    expect(meta.currentPage).toBe(1);
  });

  it("clamps negative page to page 1", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, -5);
    expect(meta.currentPage).toBe(1);
  });

  it("handles NaN page as page 1", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, NaN);
    expect(meta.currentPage).toBe(1);
  });

  it("sets hasNext/hasPrev correctly on page 1", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, 1);
    expect(meta.hasPrev).toBe(false);
    expect(meta.hasNext).toBe(true);
  });

  it("sets hasNext/hasPrev correctly on middle page", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, 2);
    expect(meta.hasPrev).toBe(true);
    expect(meta.hasNext).toBe(true);
  });

  it("sets hasNext/hasPrev correctly on last page", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, 3);
    expect(meta.hasPrev).toBe(true);
    expect(meta.hasNext).toBe(false);
  });

  it("handles empty array", () => {
    const { items, meta } = paginateArticles([], 1);
    expect(items).toEqual([]);
    expect(meta.totalPages).toBe(1);
    expect(meta.totalArticles).toBe(0);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(false);
  });

  it("handles exactly 9 articles (single page)", () => {
    const articles = makeArticles(9);
    const { items, meta } = paginateArticles(articles, 1);
    expect(items.length).toBe(9);
    expect(meta.totalPages).toBe(1);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(false);
  });

  it("calculates totalPages correctly for 10 articles", () => {
    const articles = makeArticles(10);
    const { meta } = paginateArticles(articles, 1);
    expect(meta.totalPages).toBe(2);
    expect(meta.totalArticles).toBe(10);
  });

  it("defaults page param to 1 when undefined", () => {
    const articles = makeArticles(20);
    const { meta } = paginateArticles(articles, undefined as unknown as number);
    expect(meta.currentPage).toBe(1);
  });
});
