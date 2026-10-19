/**
 * SLICE-201-6: Article → Rules (AB-*) links — validator + view block.
 * AC: every rules[] id resolves in RULE_DESCRIPTIONS; article page renders
 * "Related Agent Readiness Checks" block; empty rules → block hidden.
 */
import { describe, expect, it } from "vitest";
import { BLOG_ARTICLES, type BlogArticle } from "../src/server/lib/blog-data";
import { findInvalidRuleIds } from "../src/server/lib/blog/article-rules";
import { BlogArticlePage } from "../src/views/blog-article";

const BASE: BlogArticle = {
  slug: "test-article",
  title: "T",
  description: "d",
  tags: [],
  content: "<p>x</p>",
  author: "a",
  authorRole: "r",
  date: "2026-10-19",
  readingTime: "1 min",
};

describe("blog article → rules links (201-6)", () => {
  it("every rules[] id across all articles exists in the rule registry", () => {
    const invalid = findInvalidRuleIds(BLOG_ARTICLES);
    expect(invalid).toEqual([]);
  });

  it("validator flags unknown rule ids", () => {
    const bad: BlogArticle = { ...BASE, rules: ["AB-001", "AB-999"] };
    const invalid = findInvalidRuleIds([bad]);
    expect(invalid).toEqual([
      { slug: "test-article", ruleId: "AB-999" },
    ]);
  });

  it("article page renders Related Agent Readiness Checks block with links", () => {
    const html = BlogArticlePage({ ...BASE, rules: ["AB-001"] }).toString();
    expect(html).toContain("Related Agent Readiness Checks");
    expect(html).toContain('href="/rules/AB-001"');
    expect(html).toContain("Robots.txt File");
  });

  it("block is hidden when rules are absent or empty", () => {
    expect(BlogArticlePage(BASE).toString()).not.toContain(
      "Related Agent Readiness Checks",
    );
    expect(BlogArticlePage({ ...BASE, rules: [] }).toString()).not.toContain(
      "Related Agent Readiness Checks",
    );
  });
});
