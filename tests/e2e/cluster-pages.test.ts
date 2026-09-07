import { describe, it, expect } from "vitest";
import { CLUSTER_PAGES } from "../../src/server/lib/cluster-data";

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

describe("SLICE-116-3: Cluster page routes + JSON-LD + sitemap", () => {
  for (const page of CLUSTER_PAGES) {
    describe(`GET /${page.slug}`, () => {
      let html: string;

      it("returns 200", async () => {
        const res = await fetch(`${BASE}/${page.slug}`);
        expect(res.status).toBe(200);
        html = await res.text();
      });

      it("contains <h1> with the question", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain("<h1");
        // HTML entity encoding may differ (e.g. &#39; vs ')
        const decoded = html.replace(/&#39;/g, "'").replace(/&amp;/g, "&").replace(/&quot;/g, '"');
        expect(decoded).toContain(page.question);
      });

      it("contains Article JSON-LD", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        const schemas = extractJsonLd(html);
        expect(hasType(schemas, "Article")).toBe(true);
      });

      it("contains BreadcrumbList JSON-LD", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        const schemas = extractJsonLd(html);
        expect(hasType(schemas, "BreadcrumbList")).toBe(true);
      });

      it("contains 'Scan your site' CTA", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        expect(html).toContain("Scan your site");
      });

      it("does NOT have SoftwareApplication", async () => {
        if (!html) html = await (await fetch(`${BASE}/${page.slug}`)).text();
        const schemas = extractJsonLd(html);
        expect(hasType(schemas, "SoftwareApplication")).toBe(false);
      });
    });
  }

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
});
