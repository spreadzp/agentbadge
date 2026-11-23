import { describe, it, expect } from "vitest";
import { FaqPage, getFaqEntries } from "../../src/views/pages/faq-page";
import { faqPageLd } from "../../src/server/lib/json-ld";
import { PageMeta } from "../../src/server/lib/page-meta";

function allFaqContent(): string {
  return getFaqEntries().map((qa) => qa.question + " " + qa.answer).join("\n");
}

// ─── Unit: FAQ page ───────────────────────────────────────────
describe("FaqPage unit", () => {
  it("renders >= 8 Q&A pairs in raw HTML (page 1)", () => {
    const html = FaqPage(getFaqEntries(), []).toString();
    // Count <details> elements = Q&A pairs on page 1
    const detailsCount = (html.match(/<details/g) || []).length;
    expect(detailsCount).toBe(getFaqEntries().length);
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
    expect(getFaqEntries().length).toBeGreaterThanOrEqual(26);
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
      "What is the agent directory?",
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
    expect(getFaqEntries().length).toBeGreaterThanOrEqual(34);
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
    expect(getFaqEntries().length).toBeGreaterThanOrEqual(44);
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
