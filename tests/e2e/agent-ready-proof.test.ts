import { describe, it, expect } from "vitest";
import { BLOG_ARTICLES } from "../../src/server/lib/blog-data";
import { existsSync } from "fs";

const BASE = "http://localhost:4021";

function extractJsonLd(html: string): object[] {
  const blocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g);
  if (!blocks) return [];
  const all: object[] = [];
  for (const block of blocks) {
    const json = block.replace(/<script type="application\/ld\+json">/, "").replace(/<\/script>/, "");
    try {
      const parsed = JSON.parse(json);
      if (Array.isArray(parsed)) all.push(...parsed);
      else all.push(parsed);
    } catch {
      // skip malformed
    }
  }
  return all;
}

function hasType(schemas: object[], type: string): boolean {
  return schemas.some((s) => (s as Record<string, unknown>)["@type"] === type);
}

describe("SLICE-119-5: Comprehensive E2E — agent-ready proof + blog mapping + strategy docs", () => {
  let html: string;

  // ─── Proof Block Rendering ───
  describe("Proof block rendering", () => {
    it("GET / returns 200", async () => {
      const res = await fetch(`${BASE}/`);
      expect(res.status).toBe(200);
      html = await res.text();
    });

    it("homepage contains id='agent-ready-proof' section", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('id="agent-ready-proof"');
    });

    it("section contains headline 'We don't just measure Agent Readiness'", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain("We don't just measure Agent Readiness");
    });

    it("section contains 'We built AgentBadge to be agent-ready'", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain("We built AgentBadge to be agent-ready");
    });

    it("section contains 6 evidence cards", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      const section = html.match(/id="agent-ready-proof"[\s\S]*?<\/section>/)?.[0] ?? "";
      const cardLinks = section.match(/<a href="[^"]*" class="group block rounded-xl/g) ?? [];
      expect(cardLinks.length).toBe(6);
    });

    it("card 1 links to /robots.txt", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/robots.txt"');
    });

    it("card 2 links to /llms.txt", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/llms.txt"');
    });

    it("card 3 links to /openapi.json", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/openapi.json"');
    });

    it("card 4 links to /hackathon/webmcp", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/hackathon/webmcp"');
    });

    it("card 5 links to /agent-guide/", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/agent-guide/"');
    });

    it("card 6 links to /agent-guide/knowledge-map.json", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/agent-guide/knowledge-map.json"');
    });

    it("each card has a status badge (200 OK, 6 tools, Live)", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain("200 OK");
      expect(html).toContain("6 tools");
      expect(html).toContain("Live");
    });

    it("CTA button links to /hackathon/webmcp", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain('href="/hackathon/webmcp"');
    });

    it("CTA button text contains 'See the agent architecture'", async () => {
      if (!html) html = await (await fetch(`${BASE}/`)).text();
      expect(html).toContain("See the agent architecture");
    });
  });

  // ─── Proof Block Position ───
  describe("Proof block position", () => {
    it("proof section appears after scanner preview section", async () => {
      const page = await (await fetch(`${BASE}/`)).text();
      const proofIdx = page.indexOf('id="agent-ready-proof"');
      const scannerIdx = page.indexOf('id="how"');
      expect(proofIdx).toBeGreaterThan(-1);
      expect(scannerIdx).toBeGreaterThan(-1);
      expect(proofIdx).toBeGreaterThan(scannerIdx);
    });

    it("proof section appears before FAQ section", async () => {
      const page = await (await fetch(`${BASE}/`)).text();
      const proofIdx = page.indexOf('id="agent-ready-proof"');
      const faqIdx = page.indexOf('id="evidence"');
      expect(proofIdx).toBeGreaterThan(-1);
      expect(faqIdx).toBeGreaterThan(-1);
      expect(proofIdx).toBeLessThan(faqIdx);
    });
  });

  // ─── Live Endpoint Verification ───
  describe("Live endpoints", () => {
    it("GET /robots.txt returns 200", async () => {
      const res = await fetch(`${BASE}/robots.txt`);
      expect(res.status).toBe(200);
    });

    it("GET /llms.txt returns 200", async () => {
      const res = await fetch(`${BASE}/llms.txt`);
      expect(res.status).toBe(200);
    });

    it("GET /openapi.json returns 200", async () => {
      const res = await fetch(`${BASE}/openapi.json`);
      expect(res.status).toBe(200);
    });

    it("GET /openapi.json response is valid JSON", async () => {
      const res = await fetch(`${BASE}/openapi.json`);
      const json = await res.json();
      expect(json).toBeDefined();
      expect(typeof json).toBe("object");
    });

    it("GET /hackathon/webmcp returns 200", async () => {
      const res = await fetch(`${BASE}/hackathon/webmcp`);
      expect(res.status).toBe(200);
    });

    it("GET /agent-guide/ returns 200", async () => {
      const res = await fetch(`${BASE}/agent-guide/`);
      expect(res.status).toBe(200);
    });

    it("GET /agent-guide/knowledge-map.json returns 200", async () => {
      const res = await fetch(`${BASE}/agent-guide/knowledge-map.json`);
      expect(res.status).toBe(200);
    });

    it("GET /agent-guide/knowledge-map.json response is valid JSON", async () => {
      const res = await fetch(`${BASE}/agent-guide/knowledge-map.json`);
      const json = await res.json();
      expect(json).toBeDefined();
      expect(typeof json).toBe("object");
    });
  });

  // ─── Blog → Agent Guide Mapping ───
  describe("Blog → Agent Guide mapping", () => {
    it("every blog article page contains a link to its agent-guide article", async () => {
      for (const article of BLOG_ARTICLES) {
        const guideSlug = article.agentGuideSlug ?? article.slug;
        const res = await fetch(`${BASE}/blog/${article.slug}`);
        expect(res.status).toBe(200);
        const pageHtml = await res.text();
        expect(pageHtml).toContain(`/agent-guide/articles/${guideSlug}`);
      }
    });

    const guideSlugs = [
      "what-is-agent-readiness",
      "seo-vs-agent-readiness",
      "web-becoming-agentic-api-discovery",
      "seo-geo-agent-readiness",
      "what-ai-agent-needs-to-understand-api",
      "why-openapi-isnt-enough",
      "how-do-you-measure-agent-readiness",
      "inside-an-agent-readiness-scanner",
    ];

    for (const slug of guideSlugs) {
      it(`GET /agent-guide/articles/${slug} returns 200`, async () => {
        const res = await fetch(`${BASE}/agent-guide/articles/${slug}`);
        expect(res.status).toBe(200);
      });
    }

    it("all blog articles have non-empty agentGuideSlug", () => {
      for (const article of BLOG_ARTICLES) {
        expect(article.agentGuideSlug).toBeDefined();
        expect(typeof article.agentGuideSlug).toBe("string");
        expect(article.agentGuideSlug!.length).toBeGreaterThan(0);
      }
    });
  });

  // ─── Strategy Docs ───
  describe("Strategy docs exist", () => {
    it("docs/STRATEGY/external-publication-strategy.md exists", () => {
      expect(existsSync("docs/STRATEGY/external-publication-strategy.md")).toBe(true);
    });

    it("docs/STRATEGY/llm-citation-monitoring.md exists", () => {
      expect(existsSync("docs/STRATEGY/llm-citation-monitoring.md")).toBe(true);
    });
  });

  // ─── JSON-LD ───
  describe("Homepage JSON-LD", () => {
    it("includes Organization schema", async () => {
      const page = await (await fetch(`${BASE}/`)).text();
      const schemas = extractJsonLd(page);
      expect(hasType(schemas, "Organization")).toBe(true);
    });

    it("includes WebSite schema", async () => {
      const page = await (await fetch(`${BASE}/`)).text();
      const schemas = extractJsonLd(page);
      expect(hasType(schemas, "WebSite")).toBe(true);
    });
  });
});
