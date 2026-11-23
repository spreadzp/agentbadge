import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../../src/server/routes/pages/content-pages";
import { FaqPage, getFaqEntries } from "../../src/views/pages/faq-page";

const app = new Hono();
app.route("/", contentPageRoutes);

// ─── FAQ single-page rendering + pagination + JSON-LD ─────────
describe("FaqPage: single-page rendering", () => {
  it("renders every FAQ entry as <details> on one page", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(getFaqEntries().length);
  });

  it("GET /faq renders the full single-page FAQ", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain("Frequently Asked Questions");
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(getFaqEntries().length);
  });

  it("GET /faq canonical is /faq (no ?page= variants)", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    const canonicalMatch = html.match(/rel="canonical" href="([^"]+)"/);
    expect(canonicalMatch).toBeDefined();
    expect(canonicalMatch![1]).toContain("/faq");
    expect(canonicalMatch![1]).not.toContain("?page=");
  });

  it("?page= param is ignored — same single-page content", async () => {
    const res1 = await app.request("/faq");
    const res2 = await app.request("/faq?page=2");
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);
    expect(await res2.text()).toBe(await res1.text());
  });

  it("JSON-LD FAQPage contains all entries", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(match).not.toBeNull();
    const schemas = JSON.parse(match![1]);
    const faqSchema = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");
    expect(faqSchema).toBeDefined();
    expect(faqSchema.mainEntity.length).toBe(getFaqEntries().length);
  });
});

// ─── Unit: FAQ SLICE-105-5 — Content + Pagination UI ─────────

describe("FaqPage SLICE-105-5: Content + Pagination UI", () => {
  it("has no duplicate questions", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const allEntries = mod.getFaqEntries();
    const questions = allEntries.map((qa) => qa.question);
    const unique = new Set(questions);
    expect(questions.length).toBe(unique.size);
  });

  it("page 1 contains brand question 'What is AgentBadge?'", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const allEntries = mod.getFaqEntries();
    const items = allEntries;
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("What is AgentBadge?");
  });

  it("page 1 contains brand question 'What is AgentBadge NOT?'", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const allEntries = mod.getFaqEntries();
    const items = allEntries;
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("What is AgentBadge NOT?");
  });

  it("page 1 contains service question 'What does it cost?'", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const allEntries = mod.getFaqEntries();
    const items = allEntries;
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("What does it cost?");
  });

  it("page 1 contains quick-win question 'How do I integrate via MCP?'", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const allEntries = mod.getFaqEntries();
    const items = allEntries;
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("How do I integrate via MCP?");
  });

  it("page 1 contains quick-win question 'Is this on testnet or mainnet?'", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const allEntries = mod.getFaqEntries();
    const items = allEntries;
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("Is this on testnet or mainnet?");
  });

  it("includes deep concept questions on the single page", async () => {
    const mod = await import("../../src/views/pages/faq-page");
    const questions = mod.getFaqEntries().map((qa) => qa.question);
    expect(questions).toContain("What is an ExecutionTrace in AgentBadge's runtime testing?");
    expect(questions).toContain("What is Agent Success Rate (ASR) in AgentBadge?");
    expect(questions).toContain("What is the difference between SEO and GEO?");
  });

  it("renders agent resource footer with llms.txt link", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/llms.txt"');
  });

  it("renders agent resource footer with llms-full.txt link", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/llms-full.txt"');
  });

  it("renders agent resource footer with agent-guide link", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/agent-guide"');
  });

  it("renders agent resource footer with sitemap.xml link", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/sitemap.xml"');
  });

  it("renders agent resource footer with ai-plugin.json link", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/.well-known/agent-card.json"');
  });

  it("renders agent resource footer with blog link", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/blog"');
  });

  it("agent resource footer renders on the single page", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/agent-guide"');
  });

  it("GET /faq includes agent resource footer", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/llms-full.txt"');
    expect(html).toContain('href="/.well-known/agent-card.json"');
  });

  it("GET /faq?page=2 includes agent resource footer", async () => {
    const res = await app.request("/faq?page=2");
    const html = await res.text();
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/agent-guide"');
  });
});

// ─── SLICE-105-6: Pagination & JSON-LD Verification ──────────

describe("SLICE-105-6: FAQ integration (single-page)", () => {
  it("GET /faq?page=N returns identical single-page content", async () => {
    for (const page of ["-1", "0", "abc", "2", "9999"]) {
      const res = await app.request(`/faq?page=${page}`);
      expect(res.status).toBe(200);
    }
    const base = await (await app.request("/faq")).text();
    const paged = await (await app.request("/faq?page=2")).text();
    expect(paged).toBe(base);
  });

  it("GET /faq renders all Q&A pairs in one response", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(getFaqEntries().length);
  });
});

describe("SLICE-105-6: JSON-LD verification", () => {
  const faqJsonLd = async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(match).not.toBeNull();
    const schemas = JSON.parse(match![1]);
    return schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");
  };

  it("FAQPage schema has datePublished and dateModified", async () => {
    const faqSchema = await faqJsonLd();
    expect(faqSchema).toBeDefined();
    expect(faqSchema.datePublished).toBeDefined();
    expect(faqSchema.dateModified).toBeDefined();
  });

  it("mainEntity count matches <details> count", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    const faqSchema = await faqJsonLd();
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(faqSchema.mainEntity.length).toBe(detailsCount);
    expect(faqSchema.mainEntity.length).toBe(getFaqEntries().length);
  });

  it("each Question has name and acceptedAnswer.text", async () => {
    const faqSchema = await faqJsonLd();
    for (const entity of faqSchema.mainEntity) {
      expect(entity["@type"]).toBe("Question");
      expect(entity.name).toBeDefined();
      expect(typeof entity.name).toBe("string");
      expect(entity.name.length).toBeGreaterThan(0);
      expect(entity.acceptedAnswer).toBeDefined();
      expect(entity.acceptedAnswer["@type"]).toBe("Answer");
      expect(entity.acceptedAnswer.text).toBeDefined();
      expect(typeof entity.acceptedAnswer.text).toBe("string");
      expect(entity.acceptedAnswer.text.length).toBeGreaterThan(0);
    }
  });
});

// ─── Unit: Use Cases page ─────────────────────────────────────
