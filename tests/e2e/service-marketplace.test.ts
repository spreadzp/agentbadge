import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("Service page — Marketplace (SLICE-51-5)", () => {
  it("returns 200", async () => {
    const res = await app.request("/services/marketplace");
    expect(res.status).toBe(200);
  });

  it("has service-specific H1 with Marketplace", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Marketplace[\s\S]*<\/h1>/i);
  });

  it("has CTA link to marketplace tasks", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toContain('href="/ui/market/tasks"');
  });

  it("has correct page meta title", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toContain("Agent Marketplace");
  });

  it("has canonical link", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("/services/marketplace");
  });

  it("has x402 and HBAR mentions", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toContain("x402");
    expect(html).toContain("HBAR");
  });

  it("has cross-links to other services", async () => {
    const res = await app.request("/services/marketplace");
    const html = await res.text();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/passports"');
  });
});
