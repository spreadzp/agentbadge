import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../../src/server/routes/content-pages";

const app = new Hono();
app.route("/", contentPageRoutes);

describe("About page — Agency story (SLICE-51-6)", () => {
  it("returns 200", async () => {
    const res = await app.request("/about");
    expect(res.status).toBe(200);
  });

  it("reflects agency positioning", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toMatch(/agency/i);
    expect(html).toContain("AgentBadge");
  });

  it("references all 3 services", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toMatch(/scanner/i);
    expect(html).toMatch(/passport/i);
    expect(html).toMatch(/marketplace/i);
  });

  it("has agency headline", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Agency[\s\S]*<\/h1>/i);
  });

  it("has mission section", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toMatch(/mission/i);
  });

  it("has links to services", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/passports"');
    expect(html).toContain('href="/services/marketplace"');
  });
});
