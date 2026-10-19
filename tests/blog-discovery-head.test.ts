/**
 * SLICE-201-12: HTML discovery — rel=alternate→/blog/:slug.json,
 * JSON-LD TechArticle, canonical on HTML URL, OG article type.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { blogRoutes } from "../src/server/routes/blog";
import { BLOG_ARTICLES } from "../src/server/lib/blog-data";

const app = new Hono();
app.route("/", blogRoutes);

const SLUG = BLOG_ARTICLES[0].slug;

describe("blog article HTML discovery (201-12)", () => {
  it("head has rel=alternate application/json → /blog/:slug.json", async () => {
    const html = await (await app.request(`/blog/${SLUG}`)).text();
    expect(html).toContain(
      `<link rel="alternate" type="application/json" title="Knowledge Object" href="/blog/${SLUG}.json"`,
    );
  });

  it("JSON-LD contains TechArticle with fields matching BlogArticle", async () => {
    const html = await (await app.request(`/blog/${SLUG}`)).text();
    const lds = [...html.matchAll(
      /<script type="application\/ld\+json">(.*?)<\/script>/gs,
    )].flatMap((m) => {
      const parsed = JSON.parse(m[1]);
      return Array.isArray(parsed) ? parsed : [parsed];
    });
    const tech = lds.find((o) => o["@type"] === "TechArticle");
    expect(tech).toBeTruthy();
    const a = BLOG_ARTICLES[0];
    expect(tech.headline).toBe(a.title);
    expect(tech.author.name).toBe(a.author);
    expect(tech.datePublished).toBe(a.date);
    expect(tech.url).toContain(`/blog/${SLUG}`);
  });

  it("canonical points to HTML /blog/:slug, never the .json URL", async () => {
    const html = await (await app.request(`/blog/${SLUG}`)).text();
    const canon = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(canon).toBeTruthy();
    expect(canon).toContain(`/blog/${SLUG}`);
    expect(canon).not.toContain(".json");
  });

  it("og:type=article and og:url equals canonical", async () => {
    const html = await (await app.request(`/blog/${SLUG}`)).text();
    expect(html).toContain('property="og:type" content="article"');
    const ogUrl = html.match(/property="og:url" content="([^"]+)"/)?.[1];
    const canon = html.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    expect(ogUrl).toBe(canon);
  });
});
