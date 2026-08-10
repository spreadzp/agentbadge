import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { contentPageRoutes } from "../../src/server/routes/content-pages";

const app = new Hono();
app.route("/", contentPageRoutes);

describe("FAQ — Unified all services (SLICE-51-7)", () => {
  it("returns 200", async () => {
    const res = await app.request("/faq");
    expect(res.status).toBe(200);
  });

  it("has agency-level question", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toMatch(/What is AgentBadge/i);
  });

  it("references all 3 services", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toMatch(/scanner/i);
    expect(html).toMatch(/passport/i);
    expect(html).toMatch(/marketplace/i);
  });

  it("has FAQPage JSON-LD", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain("FAQPage");
  });

  it("has agency positioning in answer", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toMatch(/agency/i);
  });

  it("has links to service pages", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/passports"');
    expect(html).toContain('href="/services/marketplace"');
  });
});
