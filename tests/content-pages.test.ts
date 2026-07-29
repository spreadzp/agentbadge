import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../src/server/routes/content-pages";
import { FaqPage, FAQ_ENTRIES } from "../src/views/faq-page";
import { UseCasesPage, USE_CASES } from "../src/views/use-cases-page";
import { faqPageLd, articleLd } from "../src/server/lib/json-ld";
import { PUBLIC_PAGES, PageMeta } from "../src/server/lib/page-meta";

const app = new Hono();
app.route("/", contentPageRoutes);

// ─── Unit: FAQ page ───────────────────────────────────────────

describe("FaqPage unit", () => {
  it("renders >= 10 Q&A pairs in raw HTML", () => {
    const html = FaqPage().toString();
    // Count <details> elements = Q&A pairs
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBeGreaterThanOrEqual(10);
    expect(detailsCount).toBe(FAQ_ENTRIES.length);
  });

  it("includes all question texts in HTML", () => {
    const html = FaqPage().toString();
    for (const qa of FAQ_ENTRIES) {
      expect(html).toContain(qa.question);
      expect(html).toContain(qa.answer);
    }
  });

  it("renders FAQPage JSON-LD with matching Question count", () => {
    const schemas = [faqPageLd(FAQ_ENTRIES)];
    const json = JSON.stringify(schemas);
    const parsed = JSON.parse(json);
    const faqSchema = parsed.find((s: { "@type": string }) => s["@type"] === "FAQPage");
    expect(faqSchema).toBeDefined();
    expect(faqSchema.mainEntity.length).toBe(FAQ_ENTRIES.length);
    for (let i = 0; i < FAQ_ENTRIES.length; i++) {
      expect(faqSchema.mainEntity[i]["@type"]).toBe("Question");
      expect(faqSchema.mainEntity[i].name).toBe(FAQ_ENTRIES[i].question);
      expect(faqSchema.mainEntity[i].acceptedAnswer.text).toBe(FAQ_ENTRIES[i].answer);
    }
  });

  it("uses canonical terminology from CONTEXT.md", () => {
    const html = FaqPage().toString();
    // Key terms that must appear (from CONTEXT.md glossary)
    expect(html).toContain("HTS");
    expect(html).toContain("HCS");
    expect(html).toContain("DID");
    expect(html).toContain("x402");
    expect(html).toContain("MCP");
    expect(html).toContain("HBAR");
    expect(html).toContain("Mirror Node");
    expect(html).toContain("non-transferable");
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/faq"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("FAQ");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/faq");
  });
});

// ─── Unit: Use Cases page ─────────────────────────────────────

describe("UseCasesPage unit", () => {
  it("renders >= 4 scenarios with outcomes", () => {
    const html = UseCasesPage().toString();
    const articleCount = (html.match(/<article/g) || []).length;
    expect(articleCount).toBeGreaterThanOrEqual(4);
    expect(articleCount).toBe(USE_CASES.length);
  });

  it("includes problem, solution, and on-chain proof for each scenario", () => {
    const html = UseCasesPage().toString();
    for (const uc of USE_CASES) {
      expect(html).toContain(uc.title);
      expect(html).toContain(uc.problem);
      expect(html).toContain(uc.solution);
      expect(html).toContain(uc.onChainProof);
    }
  });

  it("includes HashScan links", () => {
    const html = UseCasesPage().toString();
    expect(html).toContain("hashscan.io");
  });

  it("renders Article JSON-LD", () => {
    const schemas = [
      articleLd({
        title: "How AgentGate Works in Practice",
        description: "test desc",
        path: "/use-cases",
        sections: USE_CASES.map((uc) => ({
          title: uc.title,
          body: uc.problem,
        })),
      }),
    ];
    const parsed = JSON.parse(JSON.stringify(schemas));
    const article = parsed.find((s: { "@type": string }) => s["@type"] === "Article");
    expect(article).toBeDefined();
    expect(article.headline).toBe("How AgentGate Works in Practice");
    expect(article.articleBody).toContain(USE_CASES[0].title);
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/use-cases"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("Use Cases");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/use-cases");
  });

  it("uses canonical terminology from CONTEXT.md", () => {
    const html = UseCasesPage().toString();
    expect(html).toContain("HTS");
    expect(html).toContain("HCS");
    expect(html).toContain("DID");
    expect(html).toContain("x402");
    expect(html).toContain("HBAR");
    expect(html).toContain("Mirror Node");
  });
});

// ─── Integration: routes ──────────────────────────────────────

describe("Content pages integration", () => {
  it("GET /faq returns 200 with >= 10 Q&A pairs in HTML", async () => {
    const res = await app.request("/faq");
    expect(res.status).toBe(200);
    const html = await res.text();
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBeGreaterThanOrEqual(10);
  });

  it("GET /faq includes FAQPage JSON-LD with matching Question count", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain("application/ld+json");
    // Extract JSON-LD script
    const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(match).not.toBeNull();
    const schemas = JSON.parse(match![1]);
    const faqSchema = schemas.find((s: { "@type": string }) => s["@type"] === "FAQPage");
    expect(faqSchema).toBeDefined();
    expect(faqSchema.mainEntity.length).toBe(FAQ_ENTRIES.length);
  });

  it("GET /faq has unique title and meta description", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain("<title>FAQ");
    expect(html).toContain('name="description"');
  });

  it("GET /faq has no 'Loading' text", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).not.toContain("Loading");
  });

  it("GET /use-cases returns 200 with >= 4 scenarios", async () => {
    const res = await app.request("/use-cases");
    expect(res.status).toBe(200);
    const html = await res.text();
    const articleCount = (html.match(/<article/g) || []).length;
    expect(articleCount).toBeGreaterThanOrEqual(4);
  });

  it("GET /use-cases includes Article JSON-LD", async () => {
    const res = await app.request("/use-cases");
    const html = await res.text();
    const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(match).not.toBeNull();
    const schemas = JSON.parse(match![1]);
    const article = schemas.find((s: { "@type": string }) => s["@type"] === "Article");
    expect(article).toBeDefined();
    expect(article.headline).toContain("AgentGate");
  });

  it("GET /use-cases has unique title and meta description", async () => {
    const res = await app.request("/use-cases");
    const html = await res.text();
    expect(html).toContain("<title>Use Cases");
    expect(html).toContain('name="description"');
  });

  it("GET /use-cases has no 'Loading' text", async () => {
    const res = await app.request("/use-cases");
    const html = await res.text();
    expect(html).not.toContain("Loading");
  });

  it("both pages appear in sitemap PUBLIC_PAGES", () => {
    const paths = PUBLIC_PAGES.map((p) => p.path);
    expect(paths).toContain("/faq");
    expect(paths).toContain("/use-cases");
  });

  it("both pages appear in footer nav", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('href="/faq"');
    expect(html).toContain('href="/use-cases"');
  });

  it("FAQ and Use Cases have distinct titles and descriptions", () => {
    const faqMeta = PageMeta["/faq"];
    const ucMeta = PageMeta["/use-cases"];
    expect(faqMeta.title).not.toBe(ucMeta.title);
    expect(faqMeta.description).not.toBe(ucMeta.description);
  });
});
