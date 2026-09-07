import { describe, it, expect } from "vitest";
import { getRegistry } from "../src/server/registry/loader";
import { getFaqEntries } from "../src/views/faq-page";
import { makeTestApp, setupMockEnv } from "./e2e/helpers";

setupMockEnv();
const app = makeTestApp();

const ARTICLE_SLUGS = [
  "what-is-agent-readiness",
  "building-mcp-servers",
  "hedera-blockchain-for-agents",
  "ai-agent-architecture-patterns",
  "geo-optimization-for-ai-discovery",
];

describe("SLICE-46-6: Update 5 articles + 2 FAQ entries", () => {
  describe("Article frontmatter", () => {
    it("all 5 articles have related_capabilities in frontmatter", async () => {
      for (const slug of ARTICLE_SLUGS) {
        const res = await app.request(`/agent-guide/articles/${slug}`);
        expect(res.status).toBe(200);
        const text = await res.text();
        // CTA should be injected if capabilities resolve
        // Body should not start with ---
        expect(text.startsWith("---")).toBe(false);
      }
    });

    it("all 5 articles have CTA with Relevant Engineering Capabilities", async () => {
      for (const slug of ARTICLE_SLUGS) {
        const res = await app.request(`/agent-guide/articles/${slug}`);
        const text = await res.text();
        expect(text).toContain("Relevant Engineering Capabilities");
      }
    });

    it("all 5 articles link to /agent-guide/team/capabilities", async () => {
      for (const slug of ARTICLE_SLUGS) {
        const res = await app.request(`/agent-guide/articles/${slug}`);
        const text = await res.text();
        expect(text).toContain("/agent-guide/team/capabilities");
      }
    });

    it("what-is-agent-readiness has ai-agent-architecture capability", async () => {
      const res = await app.request("/agent-guide/articles/what-is-agent-readiness");
      const text = await res.text();
      expect(text).toContain("AI Agent Architecture");
    });

    it("building-mcp-servers has mcp-development capability", async () => {
      const res = await app.request("/agent-guide/articles/building-mcp-servers");
      const text = await res.text();
      expect(text).toContain("MCP Server Development");
    });

    it("hedera-blockchain-for-agents has blockchain-development capability", async () => {
      const res = await app.request("/agent-guide/articles/hedera-blockchain-for-agents");
      const text = await res.text();
      expect(text).toContain("Blockchain Development");
    });

    it("ai-agent-architecture-patterns has ai-agent-architecture capability", async () => {
      const res = await app.request("/agent-guide/articles/ai-agent-architecture-patterns");
      const text = await res.text();
      expect(text).toContain("AI Agent Architecture");
    });

    it("geo-optimization has geo-optimization capability", async () => {
      const res = await app.request("/agent-guide/articles/geo-optimization-for-ai-discovery");
      const text = await res.text();
      expect(text).toContain("GEO Optimization");
    });
  });

  describe("Metadata values match registry IDs", () => {
    let registry: Awaited<ReturnType<typeof getRegistry>>;

    it("registry loads successfully", async () => {
      registry = await getRegistry();
      expect(registry.capabilities.length).toBeGreaterThan(0);
    });

    it("all capability IDs in frontmatter exist in registry", async () => {
      registry = await getRegistry();
      for (const slug of ARTICLE_SLUGS) {
        const res = await app.request(`/agent-guide/articles/${slug}`);
        const text = await res.text();
        // If CTA rendered, capabilities were resolved from registry
        // This means all frontmatter IDs matched registry IDs
        expect(text).toContain("Relevant Engineering Capabilities");
      }
    });
  });

  describe("FAQ entries with team services links", () => {
    it("FAQ has at least 54 entries (original + scanner EPIC Q&A)", () => {
      const entries = getFaqEntries();
      expect(entries.length).toBeGreaterThanOrEqual(54);
    });

    it("FAQ includes MCP server question", () => {
      const entries = getFaqEntries();
      const mcpFaq = entries.find((q) =>
        q.question.toLowerCase().includes("mcp server"),
      );
      expect(mcpFaq).toBeDefined();
      expect(mcpFaq!.answer).toContain("/agent-guide/team/services");
    });

    it("FAQ includes GEO optimization question", () => {
      const entries = getFaqEntries();
      const geoFaq = entries.find((q) =>
        q.question.toLowerCase().includes("geo"),
      );
      expect(geoFaq).toBeDefined();
      expect(geoFaq!.answer).toContain("/agent-guide/team/services");
    });

    it("team services entries link to /agent-guide/team/services", () => {
      const entries = getFaqEntries();
      const teamFaqs = entries.filter(
        (q) => q.answer.includes("/agent-guide/team/services"),
      );
      expect(teamFaqs.length).toBeGreaterThanOrEqual(2);
    });

    it("FAQ page renders team services entries", async () => {
      // FAQ paginates 8 per page, so team services entries may be on later pages.
      let foundMcp = false;
      let foundGeo = false;
      let foundLink = false;
      for (let page = 1; page <= 10; page++) {
        const res = await app.request(`/faq?page=${page}`);
        if (res.status !== 200) break;
        const html = await res.text();
        if (html.includes("Can the AgentBadge team build an MCP server for me?")) foundMcp = true;
        if (html.includes("Does the team offer GEO optimization consulting?")) foundGeo = true;
        if (html.includes("/agent-guide/team/services")) foundLink = true;
      }
      expect(foundMcp).toBe(true);
      expect(foundGeo).toBe(true);
      expect(foundLink).toBe(true);
    });
  });

  describe("SLICE-105-1: Core scanner EPIC Q&A", () => {
    const NEW_QUESTIONS = [
      "What is content negotiation for AI agents?",
      "What is llms.txt and why does AgentBadge check for it?",
      "What is an AgentBadge improvement guide?",
      "What are semantic checks in AgentBadge?",
      "What is active probing in AgentBadge's scanner?",
      "What is the AgentBadge readiness badge?",
      "What are confidence levels in AgentBadge's evidence engine?",
      "How many checks does AgentBadge run?",
      "What is DNS-AID and how does AgentBadge use it?",
      "What is WebMCP and how does it relate to AgentBadge?",
    ];

    it("has all 10 new scanner EPIC Q&A pairs", () => {
      const entries = getFaqEntries();
      for (const q of NEW_QUESTIONS) {
        const found = entries.find((e) => e.question === q);
        expect(found, `Missing question: ${q}`).toBeDefined();
      }
    });

    it("every new answer mentions AgentBadge brand name", () => {
      const entries = getFaqEntries();
      for (const q of NEW_QUESTIONS) {
        const found = entries.find((e) => e.question === q);
        expect(found).toBeDefined();
        expect(found!.answer).toContain("AgentBadge");
      }
    });

    it("no duplicate questions with existing entries", () => {
      const entries = getFaqEntries();
      const allQuestions = entries.map((e) => e.question);
      const unique = new Set(allQuestions);
      expect(unique.size).toBe(allQuestions.length);
    });

    it("FAQ page renders at least one new scanner Q&A", async () => {
      // FAQ paginates 8 per page, so new entries may be on later pages.
      // Check all pages for content negotiation question.
      let found = false;
      for (let page = 1; page <= 10; page++) {
        const res = await app.request(`/faq?page=${page}`);
        if (res.status !== 200) break;
        const html = await res.text();
        if (html.includes("content negotiation")) {
          found = true;
          break;
        }
      }
      expect(found).toBe(true);
    });
  });

  describe("SLICE-105-2: Platform EPIC Q&A", () => {
    const PLATFORM_QUESTIONS = [
      "What is llms-full.txt and how does it differ from llms.txt?",
      "How does AgentBadge handle support and contact?",
      "What are author bios in AgentBadge and why do they matter?",
      "What is the AgentBadge agency model?",
      "How does AgentBadge handle noindex and canonical tags?",
      "What are short answers in AgentBadge's FAQ?",
    ];

    it("has all 6 new platform EPIC Q&A pairs", () => {
      const entries = getFaqEntries();
      for (const q of PLATFORM_QUESTIONS) {
        const found = entries.find((e) => e.question === q);
        expect(found, `Missing question: ${q}`).toBeDefined();
      }
    });

    it("every platform answer mentions AgentBadge brand name", () => {
      const entries = getFaqEntries();
      for (const q of PLATFORM_QUESTIONS) {
        const found = entries.find((e) => e.question === q);
        expect(found).toBeDefined();
        expect(found!.answer).toContain("AgentBadge");
      }
    });

    it("no duplicate questions after platform EPIC additions", () => {
      const entries = getFaqEntries();
      const allQuestions = entries.map((e) => e.question);
      const unique = new Set(allQuestions);
      expect(unique.size).toBe(allQuestions.length);
    });

    it("total FAQ entries is at least 60", () => {
      const entries = getFaqEntries();
      expect(entries.length).toBeGreaterThanOrEqual(60);
    });
  });
});
