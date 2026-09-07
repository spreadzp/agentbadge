import { describe, it, expect } from "vitest";
import { CLUSTER_PAGES } from "../../src/server/lib/cluster-data";
import { RULE_DESCRIPTIONS } from "../../src/agent-readiness/rule-descriptions";

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

function decodeEntities(html: string): string {
  return html.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"').replace(/&lt;/g, "<").replace(/&gt;/g, ">");
}

const ruleIds = new Set(RULE_DESCRIPTIONS.map((r) => r.rule_id));

describe("SLICE-116-5: Comprehensive E2E tests for cluster pages", () => {
  // ─── Page Rendering (6 pages × 5 tests = 30 tests) ───
  for (const page of CLUSTER_PAGES) {
    describe(`GET /${page.slug} — page rendering`, () => {
      let html: string;

      it("returns 200", async () => {
        const res = await fetch(`${BASE}/${page.slug}`);
        expect(res.status).toBe(200);
        html = await res.text();
      });

      it("returns text/html content type", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        const res = await fetch(`${BASE}/${page.slug}`);
        expect(res.headers.get("content-type")).toContain("text/html");
      });

      it("contains <h1> with the page question", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain("<h1");
        expect(decodeEntities(html)).toContain(page.question);
      });

      it("contains direct answer in highlighted box (emerald border)", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain("border-emerald-500");
        expect(html).toContain(page.directAnswer);
      });

      it("contains 'Scan your site' CTA linking to /#scan", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain("Scan your site");
        expect(html).toContain('href="/#scan"');
      });
    });
  }

  // ─── Content Sections (per first page as representative) ───
  describe("Content sections", () => {
    let html: string;

    it("contains 'Explanation' section heading", async () => {
      html = await (await fetch(`${BASE}/how-to-make-an-api-agent-ready`)).text();
      expect(decodeEntities(html)).toContain("Explanation");
    });

    it("contains 'Example' section heading", async () => {
      expect(decodeEntities(html)).toContain("Example");
    });

    it("contains 'What AgentBadge checks' section with rule links", async () => {
      expect(html).toContain("What AgentBadge checks");
      expect(html).toMatch(/\/rules\/AB-\d+/);
    });

    it("contains 'How AgentBadge measures this' section", async () => {
      expect(html).toContain("How AgentBadge measures this");
    });

    it("contains 'Related' section with links to other cluster pages", async () => {
      expect(html).toContain("Related");
      expect(html).toMatch(/href="\/[a-z-]+"/);
    });
  });

  // ─── Rule Links (Evidence Section) ───
  describe("Rule links in evidence section", () => {
    it("contains at least one link to /rules/AB-XXX", async () => {
      const html = await (await fetch(`${BASE}/what-is-an-ai-ready-api`)).text();
      expect(html).toMatch(/\/rules\/AB-\d+/);
    });

    it("all rule links point to valid rule IDs", async () => {
      const html = await (await fetch(`${BASE}/how-to-make-an-api-agent-ready`)).text();
      const matches = html.matchAll(/\/rules\/(AB-\d+)/g);
      for (const match of matches) {
        expect(ruleIds.has(match[1])).toBe(true);
      }
    });
  });

  // ─── Cross-Links (Related Pages) ───
  describe("Related page links", () => {
    it("contains links to related cluster pages", async () => {
      const html = await (await fetch(`${BASE}/what-is-an-ai-ready-api`)).text();
      const page = CLUSTER_PAGES.find((p) => p.slug === "what-is-an-ai-ready-api")!;
      for (const slug of page.relatedPages) {
        expect(html).toContain(`href="/${slug}"`);
      }
    });

    it("all related page links return 200", async () => {
      const page = CLUSTER_PAGES.find((p) => p.slug === "what-is-an-ai-ready-api")!;
      for (const slug of page.relatedPages) {
        const res = await fetch(`${BASE}/${slug}`);
        expect(res.status).toBe(200);
      }
    });
  });

  // ─── JSON-LD ───
  for (const page of CLUSTER_PAGES) {
    describe(`JSON-LD for /${page.slug}`, () => {
      let schemas: object[];

      it("contains Article JSON-LD", async () => {
        const html = await (await fetch(`${BASE}/${page.slug}`)).text();
        schemas = extractJsonLd(html);
        expect(hasType(schemas, "Article")).toBe(true);
      });

      it("Article JSON-LD has headline matching page title", async () => {
        if (!schemas) {
          const html = await (await fetch(`${BASE}/${page.slug}`)).text();
          schemas = extractJsonLd(html);
        }
        const article = schemas.find((s) => (s as Record<string, unknown>)["@type"] === "Article") as Record<string, unknown>;
        expect(article).toBeDefined();
        expect(article.headline).toBe(page.title);
      });

      it("Article JSON-LD has description matching page description", async () => {
        if (!schemas) {
          const html = await (await fetch(`${BASE}/${page.slug}`)).text();
          schemas = extractJsonLd(html);
        }
        const article = schemas.find((s) => (s as Record<string, unknown>)["@type"] === "Article") as Record<string, unknown>;
        expect(article).toBeDefined();
        expect(article.description).toBe(page.description);
      });

      it("contains breadcrumb JSON-LD with Home and page title", async () => {
        if (!schemas) {
          const html = await (await fetch(`${BASE}/${page.slug}`)).text();
          schemas = extractJsonLd(html);
        }
        const breadcrumb = schemas.find((s) => (s as Record<string, unknown>)["@type"] === "BreadcrumbList") as Record<string, unknown>;
        expect(breadcrumb).toBeDefined();
        const items = (breadcrumb.itemListElement as Array<Record<string, unknown>>);
        expect(items[0].name).toBe("Home");
        expect(items[items.length - 1].name).toBe(page.title);
      });

      it("contains Organization and WebSite schemas", async () => {
        if (!schemas) {
          const html = await (await fetch(`${BASE}/${page.slug}`)).text();
          schemas = extractJsonLd(html);
        }
        expect(hasType(schemas, "Organization")).toBe(true);
        expect(hasType(schemas, "WebSite")).toBe(true);
      });
    });
  }

  // ─── Sitemap ───
  describe("Sitemap includes all cluster pages", () => {
    let sitemapXml: string;

    it("GET /sitemap.xml returns 200", async () => {
      const res = await fetch(`${BASE}/sitemap.xml`);
      expect(res.status).toBe(200);
      sitemapXml = await res.text();
    });

    for (const page of CLUSTER_PAGES) {
      it(`sitemap contains /${page.slug}`, async () => {
        if (!sitemapXml) sitemapXml = await (await fetch(`${BASE}/sitemap.xml`)).text();
        expect(sitemapXml).toContain(`/${page.slug}`);
      });
    }
  });

  // ─── Cross-Linking from FAQ ───
  describe("FAQ page cross-links", () => {
    let faqHtml: string;

    it("GET /faq returns 200", async () => {
      const res = await fetch(`${BASE}/faq`);
      expect(res.status).toBe(200);
      faqHtml = await res.text();
    });

    it("contains link to /what-is-an-ai-ready-api", async () => {
      if (!faqHtml) faqHtml = await (await fetch(`${BASE}/faq`)).text();
      expect(faqHtml).toContain('href="/what-is-an-ai-ready-api"');
    });

    it("contains link to /openapi-vs-agent-readiness", async () => {
      if (!faqHtml) faqHtml = await (await fetch(`${BASE}/faq`)).text();
      expect(faqHtml).toContain('href="/openapi-vs-agent-readiness"');
    });

    it("contains link to /how-ai-agents-use-apis", async () => {
      if (!faqHtml) faqHtml = await (await fetch(`${BASE}/faq`)).text();
      expect(faqHtml).toContain('href="/how-ai-agents-use-apis"');
    });
  });

  // ─── Cross-Linking from Rules Catalog ───
  describe("Rules catalog cross-links", () => {
    let rulesHtml: string;

    it("GET /rules returns 200", async () => {
      const res = await fetch(`${BASE}/rules`);
      expect(res.status).toBe(200);
      rulesHtml = await res.text();
    });

    it("contains link to /how-to-make-an-api-agent-ready", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/how-to-make-an-api-agent-ready"');
    });

    it("contains link to /what-is-an-ai-ready-api", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/what-is-an-ai-ready-api"');
    });

    it("contains link to /openapi-vs-agent-readiness", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/openapi-vs-agent-readiness"');
    });
  });

  // ─── OpenAPI Spec ───
  describe("OpenAPI spec", () => {
    let spec: Record<string, unknown>;

    it("GET /api/specs returns 200", async () => {
      const res = await fetch(`${BASE}/api/specs`);
      expect(res.status).toBe(200);
      spec = await res.json() as Record<string, unknown>;
    });

    for (const page of CLUSTER_PAGES) {
      it(`OpenAPI spec contains path /${page.slug}`, async () => {
        if (!spec) spec = await (await fetch(`${BASE}/api/specs`)).json() as Record<string, unknown>;
        const paths = spec.paths as Record<string, unknown>;
        expect(paths).toHaveProperty(`/${page.slug}`);
      });
    }
  });

  // ─── 404 Handling ───
  describe("404 handling", () => {
    it("GET /nonexistent-cluster-page returns 404", async () => {
      const res = await fetch(`${BASE}/nonexistent-cluster-page`);
      expect(res.status).toBe(404);
    });
  });

  // ─── PageMeta ───
  for (const page of CLUSTER_PAGES) {
    describe(`PageMeta for /${page.slug}`, () => {
      let html: string;

      it("<title> tag matches 'Page Title | AgentBadge'", async () => {
        html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain(`<title>${page.title} | AgentBadge</title>`);
      });

      it("<meta name='description'> matches page description", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain(`name="description"`);
        expect(html).toContain(page.description);
      });
    });
  }
});
