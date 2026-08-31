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

// ─── Unit: FAQ SLICE-105-1 — Core Scanner EPIC Q&A ────────────

describe("FaqPage SLICE-105-1: Core scanner EPIC Q&A", () => {
  it("has >= 26 Q&A pairs (16 original + 10 new)", () => {
    expect(FAQ_ENTRIES.length).toBeGreaterThanOrEqual(26);
  });

  it("includes four scoring pillars question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("four scoring pillars");
    expect(html).toContain("Discovery");
    expect(html).toContain("Understandability");
    expect(html).toContain("Executability");
    expect(html).toContain("Verifiability");
  });

  it("includes evidence-based scoring question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("evidence-based scoring");
    expect(html).toContain("VERIFIED");
    expect(html).toContain("CONFLICT");
  });

  it("includes declared vs observed question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("declared and observed");
  });

  it("includes gap engine question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("gap engine");
  });

  it("includes runtime agent testing question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("runtime agent testing");
  });

  it("includes ExecutionTrace question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("ExecutionTrace");
  });

  it("includes Agent Success Rate (ASR) question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("Agent Success Rate");
    expect(html).toContain("ASR");
  });

  it("includes scanner authentication question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("authentication");
  });

  it("includes continuous monitoring question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("continuous monitoring");
  });

  it("includes funnel report question", () => {
    const html = FaqPage().toString();
    expect(html).toContain("funnel report");
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
    const html = FaqPage().toString();
    // Scoring pillars → how-do-you-measure-agent-readiness
    expect(html).toContain("/blog/how-do-you-measure-agent-readiness");
    // OpenAPI gap → why-openapi-isnt-enough
    expect(html).toContain("/blog/why-openapi-isnt-enough");
    // What agents need → what-ai-agent-needs-to-understand-api
    expect(html).toContain("/blog/what-ai-agent-needs-to-understand-api");
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
