/**
 * SLICE-201-11: Q&A + Key facts + context links + FOR AI AGENTS block
 * + FAQPage JSON-LD + status badge on article pages.
 * SSOT: all data derives from BlogArticle via toKnowledgeObject —
 * the same derivation that powers /blog/:slug.json (D-201-13).
 */
import { describe, expect, it } from "vitest";
import type { BlogArticle } from "../src/server/lib/blog-data";
import { BlogArticlePage } from "../src/views/blog-article";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

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

describe("Q&A block (201-11)", () => {
  it("renders collapsible Q&A from article.qa", () => {
    const html = BlogArticlePage({
      ...BASE,
      qa: [{ question: "What is X?", answer: "Y answer" }],
    }).toString();
    expect(html).toContain("Questions &amp; Answers");
    expect(html).toContain("What is X?");
    expect(html).toContain("Y answer");
    expect(html).toContain("<details");
  });

  it("extracts Q&A from question-style H2 when qa absent", () => {
    const html = BlogArticlePage({
      ...BASE,
      content: "<h2>What is x402?</h2><p>A payment protocol.</p><p>more</p>",
    }).toString();
    expect(html).toContain("What is x402?");
    expect(html).toContain("A payment protocol.");
  });

  it("falls back to a summary question when no qa and no H2 questions", () => {
    const html = BlogArticlePage({ ...BASE, shortAnswer: "Short." }).toString();
    // same fallback as toKnowledgeObject → page/JSON consistency
    expect(html).toContain("What is &quot;T&quot; about?");
    expect(html).toContain("Short.");
  });
});

describe("Key facts block (201-11)", () => {
  it("renders claims with status and evidence links", () => {
    const html = BlogArticlePage({
      ...BASE,
      claims: [
        {
          id: "c1",
          text: "x402 enables autonomous payments.",
          status: "VERIFIED",
          evidence: [{ type: "demo", url: "https://example.com/e" }],
        },
      ],
    }).toString();
    expect(html).toContain("Key facts");
    expect(html).toContain("x402 enables autonomous payments.");
    expect(html).toContain("VERIFIED");
    expect(html).toContain('href="https://example.com/e"');
  });
});

describe("Context block (201-11)", () => {
  it("links concepts to /agent-guide/concepts/:name", () => {
    const html = BlogArticlePage({
      ...BASE,
      concepts: ["agent-readiness"],
    }).toString();
    expect(html).toContain('href="/agent-guide/concepts/agent-readiness"');
  });

  it("links capabilities to /agent-guide/capabilities/:name", () => {
    const html = BlogArticlePage({
      ...BASE,
      capabilities: ["x402-payment"],
    }).toString();
    expect(html).toContain('href="/agent-guide/capabilities/x402-payment"');
  });

  it("renders technologies in context", () => {
    const html = BlogArticlePage({
      ...BASE,
      technologies: ["x402", "USDC"],
    }).toString();
    expect(html).toContain("x402");
    expect(html).toContain("USDC");
  });
});

describe("FOR AI AGENTS block (D-201-16)", () => {
  it("renders visible agent context block with machine-readable link", () => {
    const html = BlogArticlePage(BASE).toString();
    expect(html).toContain("FOR AI AGENTS");
    expect(html).toContain('href="/blog/test-article.json"');
    expect(html).toContain("Status");
    // block must be visible — no display:none hack
    expect(html).not.toMatch(/display:\s*none/);
  });

  it("includes summary, actions and related guide", () => {
    const html = BlogArticlePage({
      ...BASE,
      shortAnswer: "Sum.",
      agentGuideSlug: "test-guide",
      relatedLinks: [{ label: "Repo", href: "https://github.com/x/y" }],
    }).toString();
    expect(html).toContain("Sum.");
    expect(html).toContain("/agent-guide/articles/test-guide");
    expect(html).toContain("https://github.com/x/y");
  });
});

describe("Author / work with section (D-201-23)", () => {
  it("renders team links when relatedResources has team-profile", () => {
    const html = BlogArticlePage({
      ...BASE,
      relatedResources: [
        { type: "team-profile", label: "Team", url: "https://agentbadge.xyz/agent-guide/team" },
      ],
    }).toString();
    expect(html).toContain("/agent-guide/team/capabilities");
    expect(html).toContain("/agent-guide/team/availability");
    expect(html).toContain("/agent-guide/team/contact");
  });

  it("is hidden without team-profile", () => {
    const html = BlogArticlePage(BASE).toString();
    expect(html).not.toContain("/agent-guide/team/availability");
  });
});

describe("status badge in header", () => {
  it("shows status badge, default LIVE", () => {
    expect(BlogArticlePage(BASE).toString()).toContain("LIVE");
    expect(BlogArticlePage({ ...BASE, status: "EXPERIMENT" }).toString()).toContain("EXPERIMENT");
  });
});

describe("FAQPage JSON-LD", () => {
  it("article page emits FAQPage schema matching qa[]", async () => {
    const res = await app.request("/blog/x402-payments");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("FAQPage");
    expect(html).toContain("Question");
    expect(html).toContain("acceptedAnswer");
  });
});
