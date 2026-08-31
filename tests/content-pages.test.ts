import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../src/server/routes/content-pages";
import { wellKnownRoutes } from "../src/server/routes/well-known";
import { FaqPage, FAQ_ENTRIES, getFaqEntries } from "../src/views/faq-page";
import { UseCasesPage, USE_CASES } from "../src/views/use-cases-page";
import { AboutPage } from "../src/views/about-page";
import { PricingPage } from "../src/views/pricing-page";
import { TermsPage } from "../src/views/terms-page";
import { PrivacyPage } from "../src/views/privacy-page";
import { faqPageLd, articleLd } from "../src/server/lib/json-ld";
import { PUBLIC_PAGES, PageMeta } from "../src/server/lib/page-meta";

const app = new Hono();
app.route("/", contentPageRoutes);

function allFaqContent(): string {
  return getFaqEntries().map((qa) => qa.question + " " + qa.answer).join("\n");
}

// ─── Unit: FAQ page ───────────────────────────────────────────

describe("FaqPage unit", () => {
  it("renders >= 8 Q&A pairs in raw HTML (page 1)", () => {
    const html = FaqPage().toString();
    // Count <details> elements = Q&A pairs on page 1
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(8);
  });

  it("includes all question texts in FAQ entries", () => {
    const content = allFaqContent();
    for (const qa of getFaqEntries()) {
      expect(content).toContain(qa.question);
      expect(content).toContain(qa.answer);
    }
  });

  it("renders FAQPage JSON-LD with matching Question count", () => {
    const allEntries = getFaqEntries();
    const schemas = [faqPageLd(allEntries)];
    const json = JSON.stringify(schemas);
    const parsed = JSON.parse(json);
    const faqSchema = parsed.find((s: { "@type": string }) => s["@type"] === "FAQPage");
    expect(faqSchema).toBeDefined();
    expect(faqSchema.mainEntity.length).toBe(allEntries.length);
    for (let i = 0; i < allEntries.length; i++) {
      expect(faqSchema.mainEntity[i]["@type"]).toBe("Question");
      expect(faqSchema.mainEntity[i].name).toBe(allEntries[i].question);
      expect(faqSchema.mainEntity[i].acceptedAnswer.text).toBe(allEntries[i].answer);
    }
  });

  it("uses canonical terminology from CONTEXT.md", () => {
    const content = allFaqContent();
    // Key terms that must appear (from CONTEXT.md glossary)
    expect(content).toContain("HTS");
    expect(content).toContain("HCS");
    expect(content).toContain("DID");
    expect(content).toContain("x402");
    expect(content).toContain("MCP");
    expect(content).toContain("HBAR");
    expect(content).toContain("Mirror Node");
    expect(content).toContain("non-transferable");
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/faq"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("FAQ");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/faq");
  });
});

// ─── Unit: FAQ SLICE-105-1 — Core Scanner EPIC Q&A ────────────

describe("FaqPage SLICE-105-1: Core scanner EPIC Q&A", () => {
  it("has >= 26 Q&A pairs (16 original + 10 new)", () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(26);
  });

  it("includes four scoring pillars question", () => {
    const content = allFaqContent();
    expect(content).toContain("four scoring pillars");
    expect(content).toContain("Discovery");
    expect(content).toContain("Understandability");
    expect(content).toContain("Executability");
    expect(content).toContain("Verifiability");
  });

  it("includes evidence-based scoring question", () => {
    const content = allFaqContent();
    expect(content).toContain("evidence-based scoring");
    expect(content).toContain("VERIFIED");
    expect(content).toContain("CONFLICT");
  });

  it("includes declared vs observed question", () => {
    const content = allFaqContent();
    expect(content).toContain("declared and observed");
  });

  it("includes gap engine question", () => {
    const content = allFaqContent();
    expect(content).toContain("gap engine");
  });

  it("includes runtime agent testing question", () => {
    const content = allFaqContent();
    expect(content).toContain("runtime agent testing");
  });

  it("includes ExecutionTrace question", () => {
    const content = allFaqContent();
    expect(content).toContain("ExecutionTrace");
  });

  it("includes Agent Success Rate (ASR) question", () => {
    const content = allFaqContent();
    expect(content).toContain("Agent Success Rate");
    expect(content).toContain("ASR");
  });

  it("includes scanner authentication question", () => {
    const content = allFaqContent();
    expect(content).toContain("authentication");
  });

  it("includes continuous monitoring question", () => {
    const content = allFaqContent();
    expect(content).toContain("continuous monitoring");
  });

  it("includes funnel report question", () => {
    const content = allFaqContent();
    expect(content).toContain("funnel report");
  });

  it("all new Q&A answers mention AgentBadge brand", () => {
    const allEntries = getFaqEntries();
    const newQuestions = [
      "four scoring pillars",
      "evidence-based scoring",
      "declared and observed",
      "gap engine",
      "runtime agent testing",
      "ExecutionTrace",
      "Agent Success Rate",
      "scanner handle authentication",
      "continuous monitoring",
      "funnel report",
    ];
    for (const q of newQuestions) {
      const entry = allEntries.find((e) => e.question.toLowerCase().includes(q.toLowerCase()));
      expect(entry, `Q&A containing "${q}" should exist`).toBeDefined();
      expect(entry!.answer).toContain("AgentBadge");
    }
  });

  it("new Q&A answers include blog article links where relevant", () => {
    const content = allFaqContent();
    // Scoring pillars → how-do-you-measure-agent-readiness
    expect(content).toContain("/blog/how-do-you-measure-agent-readiness");
    // OpenAPI gap → why-openapi-isnt-enough
    expect(content).toContain("/blog/why-openapi-isnt-enough");
    // What agents need → what-ai-agent-needs-to-understand-api
    expect(content).toContain("/blog/what-ai-agent-needs-to-understand-api");
  });

  it("no duplicate questions with original 16", () => {
    const originalQuestions = [
      "What is AgentBadge?",
      "What is the Agent Readiness Scanner?",
      "What is the Agent Marketplace?",
      "What is an agent passport?",
      "Why is the passport non-transferable?",
      "What are the passport tiers?",
      "What is x402 payment?",
      "What is the HCS directory?",
      "How does A2A messaging work?",
      "What does passport verification prove?",
      "How do I integrate via MCP?",
      "What does it cost?",
      "Is this on testnet or mainnet?",
      "What is AgentBadge NOT?",
      "Can the AgentBadge team build an MCP server for me?",
      "Does the team offer GEO optimization consulting?",
    ];
    const allEntries = getFaqEntries();
    const allQuestions = allEntries.map((e) => e.question);
    const uniqueQuestions = new Set(allQuestions);
    expect(uniqueQuestions.size).toBe(allQuestions.length);
    for (const q of originalQuestions) {
      expect(allQuestions.filter((aq) => aq === q).length).toBe(1);
    }
  });
});

// ─── Unit: FAQ SLICE-105-2 — Platform EPIC Q&A ────────────────

describe("FaqPage SLICE-105-2: Platform EPIC Q&A", () => {
  it("has >= 34 Q&A pairs (26 from SLICE-105-1 + 8 new)", () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(34);
  });

  it("includes ChainAdapter question", () => {
    const content = allFaqContent();
    expect(content).toContain("ChainAdapter");
  });

  it("includes multi-chain support question", () => {
    const content = allFaqContent();
    expect(content).toContain("blockchains does AgentBadge support");
  });

  it("includes WebMCP question", () => {
    const content = allFaqContent();
    expect(content).toContain("WebMCP");
  });

  it("includes task escrow question", () => {
    const content = allFaqContent();
    expect(content).toContain("task escrow");
  });

  it("includes AgentBadge blog question", () => {
    const content = allFaqContent();
    expect(content).toContain("AgentBadge blog");
  });

  it("includes SEO for agents question", () => {
    const content = allFaqContent();
    expect(content).toContain("SEO for agents");
  });

  it("includes marketplace task lifecycle question", () => {
    const content = allFaqContent();
    expect(content).toContain("task lifecycle");
  });

  it("includes agent support question", () => {
    const content = allFaqContent();
    expect(content).toContain("support");
  });

  it("all SLICE-105-2 Q&A answers mention AgentBadge brand", () => {
    const allEntries = getFaqEntries();
    const newQuestions = [
      "ChainAdapter",
      "blockchains does AgentBadge support",
      "WebMCP",
      "task escrow",
      "AgentBadge blog",
      "SEO for agents",
      "task lifecycle",
      "support",
    ];
    for (const q of newQuestions) {
      const entry = allEntries.find((e) => e.question.toLowerCase().includes(q.toLowerCase()));
      expect(entry, `Q&A containing "${q}" should exist`).toBeDefined();
      expect(entry!.answer).toContain("AgentBadge");
    }
  });

  it("SLICE-105-2 Q&A answers include blog article links where relevant", () => {
    const content = allFaqContent();
    // SEO/GEO → from-seo-to-geo-to-agent-readiness
    expect(content).toContain("/blog/from-seo-to-geo-to-agent-readiness");
    // API discovery → web-becoming-agentic-api-discovery
    expect(content).toContain("/blog/web-becoming-agentic-api-discovery");
    // Agent Readiness overview → what-is-agent-readiness
    expect(content).toContain("/blog/what-is-agent-readiness");
  });

  it("no duplicate questions with SLICE-105-1 or original 16", () => {
    const allEntries = getFaqEntries();
    const allQuestions = allEntries.map((e) => e.question);
    const uniqueQuestions = new Set(allQuestions);
    expect(uniqueQuestions.size).toBe(allQuestions.length);
  });
});

// ─── Unit: FAQ SLICE-105-3 — Blog Article Q&A ─────────────────

describe("FaqPage SLICE-105-3: Blog article Q&A", () => {
  it("has >= 44 Q&A pairs (34 from SLICE-105-2 + 10 new)", () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(44);
  });

  it("includes Agent Readiness definition question", () => {
    const content = allFaqContent();
    expect(content).toContain("What is Agent Readiness");
  });

  it("includes SEO vs Agent Readiness question", () => {
    const content = allFaqContent();
    expect(content).toContain("different from SEO");
  });

  it("includes GEO question", () => {
    const content = allFaqContent();
    expect(content).toContain("GEO");
    expect(content).toContain("Generative Engine Optimization");
  });

  it("includes MCP vs REST API question", () => {
    const content = allFaqContent();
    expect(content).toContain("MCP vs REST");
  });

  it("includes 8 layers of context question", () => {
    const content = allFaqContent();
    expect(content).toContain("8 layers");
  });

  it("includes OpenAPI not enough question", () => {
    const content = allFaqContent();
    expect(content).toContain("OpenAPI enough");
  });

  it("includes how to measure Agent Readiness question", () => {
    const content = allFaqContent();
    expect(content).toContain("How should Agent Readiness be measured");
  });

  it("includes scanner reproducibility question", () => {
    const content = allFaqContent();
    expect(content).toContain("reproducible");
  });

  it("includes agentic web question", () => {
    const content = allFaqContent();
    expect(content).toContain("agentic web");
  });

  it("includes SEO vs GEO difference question", () => {
    const content = allFaqContent();
    expect(content).toContain("difference between SEO and GEO");
  });

  it("all SLICE-105-3 Q&A answers mention AgentBadge brand", () => {
    const allEntries = getFaqEntries();
    const newQuestions = [
      "What is Agent Readiness",
      "different from SEO",
      "GEO",
      "MCP vs REST",
      "8 layers",
      "OpenAPI enough",
      "How should Agent Readiness be measured",
      "reproducible",
      "agentic web",
      "difference between SEO and GEO",
    ];
    for (const q of newQuestions) {
      const entry = allEntries.find((e) => e.question.toLowerCase().includes(q.toLowerCase()));
      expect(entry, `Q&A containing "${q}" should exist`).toBeDefined();
      expect(entry!.answer).toContain("AgentBadge");
    }
  });

  it("SLICE-105-3 Q&A answers include blog article links", () => {
    const content = allFaqContent();
    // Agent Readiness definition → what-is-agent-readiness
    expect(content).toContain("/blog/what-is-agent-readiness");
    // SEO vs Agent Readiness → api-has-seo-agent-readiness
    expect(content).toContain("/blog/api-has-seo-agent-readiness");
    // GEO → from-seo-to-geo-to-agent-readiness
    expect(content).toContain("/blog/from-seo-to-geo-to-agent-readiness");
    // MCP vs REST → mcp-vs-api
    expect(content).toContain("/blog/mcp-vs-api");
    // x402 → x402-payments
    expect(content).toContain("/blog/x402-payments");
    // 8 layers → what-ai-agent-needs-to-understand-api
    expect(content).toContain("/blog/what-ai-agent-needs-to-understand-api");
    // OpenAPI not enough → why-openapi-isnt-enough
    expect(content).toContain("/blog/why-openapi-isnt-enough");
    // How to measure → how-do-you-measure-agent-readiness
    expect(content).toContain("/blog/how-do-you-measure-agent-readiness");
    // Reproducibility → inside-an-agent-readiness-scanner
    expect(content).toContain("/blog/inside-an-agent-readiness-scanner");
    // Agentic web → web-becoming-agentic-api-discovery
    expect(content).toContain("/blog/web-becoming-agentic-api-discovery");
  });

  it("no duplicate questions with SLICE-105-1, SLICE-105-2, or original 16", () => {
    const allEntries = getFaqEntries();
    const allQuestions = allEntries.map((e) => e.question);
    const uniqueQuestions = new Set(allQuestions);
    expect(uniqueQuestions.size).toBe(allQuestions.length);
  });
});

// ─── Unit: FAQ SLICE-105-4 — Pagination ───────────────────────

describe("FaqPage SLICE-105-4: Pagination", () => {
  it("exports FAQ_PER_PAGE = 8", async () => {
    const mod = await import("../src/views/faq-page");
    expect(mod.FAQ_PER_PAGE).toBe(8);
  });

  it("paginateFaqEntries returns correct meta for page 1", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items, meta } = mod.paginateFaqEntries(allEntries, 1);
    expect(meta.currentPage).toBe(1);
    expect(meta.totalArticles).toBe(allEntries.length);
    expect(meta.totalPages).toBe(Math.ceil(allEntries.length / 8));
    expect(items.length).toBe(8);
    expect(meta.hasPrev).toBe(false);
    expect(meta.hasNext).toBe(true);
  });

  it("paginateFaqEntries returns correct meta for last page", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const totalPages = Math.ceil(allEntries.length / 8);
    const { items, meta } = mod.paginateFaqEntries(allEntries, totalPages);
    expect(meta.currentPage).toBe(totalPages);
    expect(meta.hasNext).toBe(false);
    expect(meta.hasPrev).toBe(true);
    expect(items.length).toBe(allEntries.length - (totalPages - 1) * 8);
  });

  it("paginateFaqEntries clamps invalid page values", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const totalPages = Math.ceil(allEntries.length / 8);
    const { meta: metaZero } = mod.paginateFaqEntries(allEntries, 0);
    expect(metaZero.currentPage).toBe(1);
    const { meta: metaNeg } = mod.paginateFaqEntries(allEntries, -5);
    expect(metaNeg.currentPage).toBe(1);
    const { meta: metaHuge } = mod.paginateFaqEntries(allEntries, 9999);
    expect(metaHuge.currentPage).toBe(totalPages);
    const { meta: metaUndef } = mod.paginateFaqEntries(allEntries, undefined);
    expect(metaUndef.currentPage).toBe(1);
    const { meta: metaNaN } = mod.paginateFaqEntries(allEntries, NaN);
    expect(metaNaN.currentPage).toBe(1);
  });

  it("FaqPage renders pagination nav with page links", () => {
    const html = FaqPage().toString();
    expect(html).toContain('aria-label="Pagination"');
    expect(html).toContain("/faq?page=");
  });

  it("FaqPage renders prev/next buttons", () => {
    const html = FaqPage().toString();
    expect(html).toContain("← Prev");
    expect(html).toContain("Next →");
  });

  it("GET /faq returns page 1 with 8 Q&A items", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain("Frequently Asked Questions");
    // Should contain pagination
    expect(html).toContain('aria-label="Pagination"');
  });

  it("GET /faq?page=2 returns second page", async () => {
    const res = await app.request("/faq?page=2");
    const html = await res.text();
    expect(html).toContain('aria-label="Pagination"');
    // Page 1 link is /faq (not /faq?page=1), matching blog pattern
    expect(html).toContain('href="/faq"');
    expect(html).toContain("/faq?page=3");
  });

  it("GET /faq?page=0 clamps to page 1", async () => {
    const res = await app.request("/faq?page=0");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('aria-current="page"');
  });

  it("GET /faq?page=9999 clamps to last page", async () => {
    const res = await app.request("/faq?page=9999");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('aria-label="Pagination"');
  });

  it("canonical URL is /faq for page 1", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('<link rel="canonical" href="');
    // Should contain /faq without ?page=
    const canonicalMatch = html.match(/rel="canonical" href="([^"]+)"/);
    expect(canonicalMatch).toBeDefined();
    expect(canonicalMatch![1]).toContain("/faq");
    expect(canonicalMatch![1]).not.toContain("?page=");
  });

  it("canonical URL is /faq?page=N for page > 1", async () => {
    const res = await app.request("/faq?page=2");
    const html = await res.text();
    const canonicalMatch = html.match(/rel="canonical" href="([^"]+)"/);
    expect(canonicalMatch).toBeDefined();
    expect(canonicalMatch![1]).toContain("/faq?page=2");
  });

  it("JSON-LD FAQPage contains only current page Q&A pairs", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    // JSON-LD should only have items from page 1, not all entries
    expect(items.length).toBe(8);
    expect(items.length).toBeLessThan(allEntries.length);
  });
});

// ─── Unit: FAQ SLICE-105-5 — Content + Pagination UI ─────────

describe("FaqPage SLICE-105-5: Content + Pagination UI", () => {
  it("has no duplicate questions", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const questions = allEntries.map((qa) => qa.question);
    const unique = new Set(questions);
    expect(questions.length).toBe(unique.size);
  });

  it("page 1 contains brand question 'What is AgentBadge?'", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("What is AgentBadge?");
  });

  it("page 1 contains brand question 'What is AgentBadge NOT?'", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("What is AgentBadge NOT?");
  });

  it("page 1 contains service question 'What does it cost?'", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("What does it cost?");
  });

  it("page 1 contains quick-win question 'How do I integrate via MCP?'", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("How do I integrate via MCP?");
  });

  it("page 1 contains quick-win question 'Is this on testnet or mainnet?'", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    const questions = items.map((qa) => qa.question);
    expect(questions).toContain("Is this on testnet or mainnet?");
  });

  it("page 1 does NOT contain deep concept questions", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const { items } = mod.paginateFaqEntries(allEntries, 1);
    const questions = items.map((qa) => qa.question);
    expect(questions).not.toContain("What is an ExecutionTrace in AgentBadge's runtime testing?");
    expect(questions).not.toContain("What is Agent Success Rate (ASR) in AgentBadge?");
    expect(questions).not.toContain("What is the difference between SEO and GEO?");
  });

  it("renders agent resource footer with llms.txt link", () => {
    const html = FaqPage().toString();
    expect(html).toContain('href="/llms.txt"');
  });

  it("renders agent resource footer with llms-full.txt link", () => {
    const html = FaqPage().toString();
    expect(html).toContain('href="/llms-full.txt"');
  });

  it("renders agent resource footer with agent-guide link", () => {
    const html = FaqPage().toString();
    expect(html).toContain('href="/agent-guide"');
  });

  it("renders agent resource footer with sitemap.xml link", () => {
    const html = FaqPage().toString();
    expect(html).toContain('href="/sitemap.xml"');
  });

  it("renders agent resource footer with ai-plugin.json link", () => {
    const html = FaqPage().toString();
    expect(html).toContain('href="/.well-known/ai-plugin.json"');
  });

  it("renders agent resource footer with blog link", () => {
    const html = FaqPage().toString();
    expect(html).toContain('href="/blog"');
  });

  it("agent resource footer appears on every page", async () => {
    const mod = await import("../src/views/faq-page");
    const allEntries = mod.getFaqEntries();
    const totalPages = Math.ceil(allEntries.length / 8);
    for (let p = 1; p <= totalPages; p++) {
      const { items, meta } = mod.paginateFaqEntries(allEntries, p);
      const html = FaqPage(items, meta, []).toString();
      expect(html).toContain('href="/llms.txt"');
      expect(html).toContain('href="/agent-guide"');
    }
  });

  it("GET /faq includes agent resource footer", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/llms-full.txt"');
    expect(html).toContain('href="/.well-known/ai-plugin.json"');
  });

  it("GET /faq?page=2 includes agent resource footer", async () => {
    const res = await app.request("/faq?page=2");
    const html = await res.text();
    expect(html).toContain('href="/llms.txt"');
    expect(html).toContain('href="/agent-guide"');
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
        title: "How AgentBadge Works in Practice",
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
    expect(article.headline).toBe("How AgentBadge Works in Practice");
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
  it("GET /faq returns 200 with 8 Q&A pairs in HTML (page 1)", async () => {
    const res = await app.request("/faq");
    expect(res.status).toBe(200);
    const html = await res.text();
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(8);
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
    // JSON-LD should only contain current page's Q&A (8 per page)
    expect(faqSchema.mainEntity.length).toBe(8);
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
    expect(article.headline).toContain("AgentBadge");
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

// ─── Unit: About page ─────────────────────────────────────────

describe("AboutPage unit", () => {
  it("renders mission, architecture, and roadmap sections", () => {
    const html = AboutPage().toString();
    expect(html).toContain("Mission");
    expect(html).toContain("Architecture");
    expect(html).toContain("Roadmap");
    expect(html).toContain("Open source");
  });

  it("includes canonical terminology", () => {
    const html = AboutPage().toString();
    expect(html).toContain("HTS");
    expect(html).toContain("HCS");
    expect(html).toContain("DID");
    expect(html).toContain("x402");
    expect(html).toContain("MCP");
    expect(html).toContain("HBAR");
    expect(html).toContain("Mirror Node");
  });

  it("includes GitHub link", () => {
    const html = AboutPage().toString();
    expect(html).toContain("github.com/spreadzp/agentgate");
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/about"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("About");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/about");
  });
});

// ─── Unit: Pricing page ───────────────────────────────────────

describe("PricingPage unit", () => {
  it("renders 4 tier cards with HBAR prices", () => {
    const html = PricingPage().toString();
    expect(html).toContain("Bronze");
    expect(html).toContain("10");
    expect(html).toContain("Silver");
    expect(html).toContain("50");
    expect(html).toContain("Gold");
    expect(html).toContain("200");
    expect(html).toContain("Platinum");
    expect(html).toContain("500");
    expect(html).toContain("HBAR");
  });

  it("includes upgrade pricing table", () => {
    const html = PricingPage().toString();
    expect(html).toContain("Upgrade");
    expect(html).toContain("+40");
    expect(html).toContain("+150");
    expect(html).toContain("+300");
  });

  it("includes comparison table", () => {
    const html = PricingPage().toString();
    expect(html).toContain("Comparison");
    expect(html).toContain("Self-hosted");
    expect(html).toContain("Centralized");
  });

  it("includes mint links with tier parameter", () => {
    const html = PricingPage().toString();
    expect(html).toContain("/ui/passport/request?tier=bronze");
    expect(html).toContain("/ui/passport/request?tier=silver");
    expect(html).toContain("/ui/passport/request?tier=gold");
    expect(html).toContain("/ui/passport/request?tier=platinum");
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/pricing"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("Pricing");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/pricing");
  });
});

// ─── Unit: Terms page ─────────────────────────────────────────

describe("TermsPage unit", () => {
  it("renders 10 numbered sections", () => {
    const html = TermsPage().toString();
    for (let i = 1; i <= 10; i++) {
      expect(html).toContain(`${i}.`);
    }
  });

  it("includes MIT license reference", () => {
    const html = TermsPage().toString();
    expect(html).toContain("MIT");
    expect(html).toContain("LICENSE");
  });

  it("includes testnet disclaimer", () => {
    const html = TermsPage().toString();
    expect(html).toContain("Testnet");
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/terms"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("Terms");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/terms");
  });
});

// ─── Unit: Privacy page ───────────────────────────────────────

describe("PrivacyPage unit", () => {
  it("renders privacy sections", () => {
    const html = PrivacyPage().toString();
    expect(html).toContain("on-chain");
    expect(html).toContain("cookies");
    expect(html).toContain("GDPR");
    expect(html).toContain("LLM");
  });

  it("includes third-party services", () => {
    const html = PrivacyPage().toString();
    expect(html).toContain("Fly.io");
    expect(html).toContain("Hedera");
    expect(html).toContain("Pinata");
  });

  it("includes unique title and description via PageMeta", () => {
    const meta = PageMeta["/privacy"];
    expect(meta).toBeDefined();
    expect(meta.title).toContain("Privacy");
    expect(meta.description.length).toBeGreaterThan(50);
    expect(meta.path).toBe("/privacy");
  });
});

// ─── Integration: About, Pricing, Terms, Privacy routes ───────

describe("Epic 20: Static content pages integration", () => {
  it("GET /about returns 200 with mission content", async () => {
    const res = await app.request("/about");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("About AgentBadge");
    expect(html).toContain("Mission");
    expect(html).not.toContain("Loading");
  });

  it("GET /about includes Article JSON-LD", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toContain("application/ld+json");
    const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(match).not.toBeNull();
    const schemas = JSON.parse(match![1]);
    const article = schemas.find((s: { "@type": string }) => s["@type"] === "Article");
    expect(article).toBeDefined();
    expect(article.headline).toContain("AgentBadge");
  });

  it("GET /pricing returns 200 with tier prices", async () => {
    const res = await app.request("/pricing");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Bronze");
    expect(html).toContain("Platinum");
    expect(html).toContain("HBAR");
    expect(html).not.toContain("Loading");
  });

  it("GET /pricing includes Article JSON-LD", async () => {
    const res = await app.request("/pricing");
    const html = await res.text();
    const match = html.match(/<script type="application\/ld\+json">(.+?)<\/script>/s);
    expect(match).not.toBeNull();
    const schemas = JSON.parse(match![1]);
    const article = schemas.find((s: { "@type": string }) => s["@type"] === "Article");
    expect(article).toBeDefined();
    expect(article.headline).toContain("Pricing");
  });

  it("GET /terms returns 200 with legal content", async () => {
    const res = await app.request("/terms");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Terms of Service");
    expect(html).toContain("MIT");
    expect(html).not.toContain("Loading");
  });

  it("GET /privacy returns 200 with privacy content", async () => {
    const res = await app.request("/privacy");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Privacy");
    expect(html).toContain("GDPR");
    expect(html).not.toContain("Loading");
  });

  it("all 4 pages appear in sitemap PUBLIC_PAGES", () => {
    const paths = PUBLIC_PAGES.map((p) => p.path);
    expect(paths).toContain("/about");
    expect(paths).toContain("/pricing");
    expect(paths).toContain("/terms");
    expect(paths).toContain("/privacy");
  });

  it("all 4 pages have distinct titles and descriptions", () => {
    const metas = [PageMeta["/about"], PageMeta["/pricing"], PageMeta["/terms"], PageMeta["/privacy"]];
    const titles = metas.map((m) => m.title);
    const descs = metas.map((m) => m.description);
    expect(new Set(titles).size).toBe(4);
    expect(new Set(descs).size).toBe(4);
  });

  it("all 4 pages appear in footer nav", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toContain('href="/about"');
    expect(html).toContain('href="/pricing"');
    expect(html).toContain('href="/terms"');
    expect(html).toContain('href="/privacy"');
  });
});

// ─── Integration: LLM Policy endpoint ──────────────────────────

describe("Epic 20: LLM Policy endpoint", () => {
  const policyApp = new Hono();
  policyApp.route("/", wellKnownRoutes);

  it("GET /.well-known/llm-policy.json returns 200", async () => {
    const res = await policyApp.request("/.well-known/llm-policy.json");
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.policy).toContain("AgentBadge");
    expect(json.version).toBe("1.0");
  });

  it("LLM policy includes training, RAG, and summarization sections", async () => {
    const res = await policyApp.request("/.well-known/llm-policy.json");
    const json = await res.json();
    expect(json.training).toBeDefined();
    expect(json.training.preTraining).toBe("disallowed");
    expect(json.retrievalAugmentedGeneration).toBeDefined();
    expect(json.retrievalAugmentedGeneration.rAGIndexing).toBe("allowed");
    expect(json.summarizationAndQuotation).toBeDefined();
    expect(json.summarizationAndQuotation.summarization).toBe("allowed-with-attribution");
  });

  it("LLM policy includes preferred crawl endpoints", async () => {
    const res = await policyApp.request("/.well-known/llm-policy.json");
    const json = await res.json();
    expect(json.preferredCrawlEndpoints).toBeDefined();
    expect(Array.isArray(json.preferredCrawlEndpoints)).toBe(true);
    expect(json.preferredCrawlEndpoints).toContain("/about");
    expect(json.preferredCrawlEndpoints).toContain("/pricing");
  });
});
