import { describe, it, expect } from "vitest";
import { makeTestApp, setupMockEnv } from "../e2e/helpers";
import { buildSitemap } from "../../src/server/routes/well-known/sitemaps";
import { BLOG_ARTICLES } from "../../src/server/lib/blog-data";

// SLICE-259-12: one canonical URL per article. The blog twin of an
// authority-page article (article.canonical set) must not appear as a
// duplicate 200 — it 301s to the canonical path, drops out of the
// sitemap, and .md/.json mirrors declare Link: rel="canonical".

setupMockEnv();
const app = makeTestApp();

const overridden = BLOG_ARTICLES.filter((a) => a.canonical);

describe("SLICE-259-12: canonical article URLs", () => {
  it("sitemap lists canonical URL, not the /blog twin", () => {
    const xml = buildSitemap();
    expect(overridden.length).toBeGreaterThan(0);
    for (const a of overridden) {
      expect(xml).not.toContain(`<loc>https://agentbadge.xyz/blog/${a.slug}</loc>`);
      expect(xml).toContain(`<loc>https://agentbadge.xyz${a.canonical}</loc>`);
    }
  });

  it("non-canonical /blog URL → 301 to canonical path", async () => {
    for (const a of overridden) {
      const res = await app.request(`/blog/${a.slug}`);
      expect(res.status).toBe(301);
      expect(res.headers.get("location")).toBe(`https://agentbadge.xyz${a.canonical}`);
    }
  });

  it("articles without canonical still render at /blog/:slug", async () => {
    const normal = BLOG_ARTICLES.find((a) => !a.canonical && a.markdown);
    const res = await app.request(`/blog/${normal!.slug}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(`rel="canonical"`);
  });

  it(".md mirror carries Link: canonical header", async () => {
    const normal = BLOG_ARTICLES.find((a) => !a.canonical && a.markdown);
    const res = await app.request(`/blog/${normal!.slug}.md`);
    expect(res.status).toBe(200);
    expect(res.headers.get("link")).toBe(
      `<https://agentbadge.xyz/blog/${normal!.slug}>; rel="canonical"`,
    );

    for (const a of overridden) {
      if (!a.markdown) continue;
      const dup = await app.request(`/blog/${a.slug}.md`);
      expect(dup.status).toBe(200);
      expect(dup.headers.get("link")).toBe(
        `<https://agentbadge.xyz${a.canonical}>; rel="canonical"`,
      );
    }
  });

  it(".json Knowledge Object carries Link: canonical + canonical field", async () => {
    const a = overridden.find((x) => x) ?? BLOG_ARTICLES[0];
    const res = await app.request(`/blog/${a.slug}.json`);
    expect(res.status).toBe(200);
    const htmlUrl = a.canonical ?? `/blog/${a.slug}`;
    expect(res.headers.get("link")).toBe(
      `<https://agentbadge.xyz${htmlUrl}>; rel="canonical"`,
    );
    const ko = (await res.json()) as { canonical?: string };
    expect(ko.canonical).toBe(`https://agentbadge.xyz${htmlUrl}`);
  });

  it("blog listing + RSS + index.md link to canonical URL", async () => {
    // /blog page-1 is paginated — the card may sit on a later page; the
    // only contract is no internal surface links the non-canonical twin.
    const list = await app.request("/blog");
    const listHtml = await list.text();
    for (const a of overridden) {
      expect(listHtml).not.toContain(`href="/blog/${a.slug}"`);
    }
    const rss = await app.request("/blog/rss.xml");
    const rssXml = await rss.text();
    const index = await app.request("/blog/index.md");
    const indexMd = await index.text();
    for (const a of overridden) {
      expect(rssXml).not.toContain(`<link>https://agentbadge.xyz/blog/${a.slug}</link>`);
      expect(rssXml).toContain(`<link>https://agentbadge.xyz${a.canonical}</link>`);
      expect(indexMd).toContain(`HTML: https://agentbadge.xyz${a.canonical}`);
    }
  });
});
