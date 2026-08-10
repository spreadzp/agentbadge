import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("Service page — Passports (SLICE-51-4)", () => {
  it("returns 200", async () => {
    const res = await app.request("/services/passports");
    expect(res.status).toBe(200);
  });

  it("has service-specific H1 with Passport", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Passport[\s\S]*<\/h1>/i);
  });

  it("has CTA link to passport", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toContain('href="/passport"');
  });

  it("has correct page meta title", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toContain("On-Chain Agent Passports");
  });

  it("has canonical link", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("/services/passports");
  });

  it("has NFT and Hedera mentions", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toContain("NFT");
    expect(html).toContain("Hedera");
  });

  it("has cross-links to other services", async () => {
    const res = await app.request("/services/passports");
    const html = await res.text();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/marketplace"');
  });
});
