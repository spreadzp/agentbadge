import { describe, it, expect } from "vitest";
import type { BlogArticle } from "../../../src/server/lib/blog-data";
import { toKnowledgeObject } from "../../../src/server/lib/blog/knowledge-object";
import { AgentContextBlock } from "../../../src/views/blog-agent-context";

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

function render(agentGuideSlug: string) {
  const article = { ...BASE, agentGuideSlug };
  const ko = toKnowledgeObject(article);
  return { html: String(AgentContextBlock(article, ko)), ko };
}

describe("companion agent-guide link only for existing articles", () => {
  it("links /agent-guide/articles/<slug> when the markdown exists", () => {
    const { html, ko } = render("arc-c10-payer-binding");
    expect(html).toContain('href="/agent-guide/articles/arc-c10-payer-binding"');
    expect((ko.relatedResources ?? []).some((r) => r.url.endsWith("/agent-guide/articles/arc-c10-payer-binding"))).toBe(true);
  });

  it("omits the link when no markdown exists (prod 404s)", () => {
    const { html, ko } = render("arc-c27-did-web-identity");
    expect(html).not.toContain("/agent-guide/articles/arc-c27-did-web-identity");
    expect((ko.relatedResources ?? []).some((r) => r.url.includes("/agent-guide/articles/"))).toBe(false);
  });
});
