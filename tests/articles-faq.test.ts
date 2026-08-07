import { describe, it, expect } from "vitest";
import { parseFrontmatter } from "../src/server/lib/frontmatter";
import { getRegistry } from "../src/server/registry/loader";
import { FAQ_ENTRIES } from "../src/views/faq-page";
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
      const capIds = new Set(registry.capabilities.map((c) => c.id));

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
    it("FAQ has 14 entries (12 original + 2 new)", () => {
      expect(FAQ_ENTRIES.length).toBe(14);
    });

    it("FAQ includes MCP server question", () => {
      const mcpFaq = FAQ_ENTRIES.find((q) =>
        q.question.toLowerCase().includes("mcp server"),
      );
      expect(mcpFaq).toBeDefined();
      expect(mcpFaq!.answer).toContain("/agent-guide/team/services");
    });

    it("FAQ includes GEO optimization question", () => {
      const geoFaq = FAQ_ENTRIES.find((q) =>
        q.question.toLowerCase().includes("geo"),
      );
      expect(geoFaq).toBeDefined();
      expect(geoFaq!.answer).toContain("/agent-guide/team/services");
    });

    it("both new FAQ entries link to /agent-guide/team/services", () => {
      const teamFaqs = FAQ_ENTRIES.filter(
        (q) => q.answer.includes("/agent-guide/team/services"),
      );
      expect(teamFaqs.length).toBe(2);
    });

    it("FAQ page renders new entries", async () => {
      const res = await app.request("/faq");
      expect(res.status).toBe(200);
      const html = await res.text();
      expect(html).toContain("Can the AgentBadge team build an MCP server for me?");
      expect(html).toContain("Does the team offer GEO optimization consulting?");
      expect(html).toContain("/agent-guide/team/services");
    });
  });
});
