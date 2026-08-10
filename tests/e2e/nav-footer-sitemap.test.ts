import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { Layout } from "../../src/views/layout";
import { Footer } from "../../src/views/footer";
import { wellKnownRoutes } from "../../src/server/routes/well-known";

const app = new Hono();
app.route("/", wellKnownRoutes);

describe("Navigation, Footer, Sitemap, Redirects (SLICE-51-11)", () => {
  it("nav has services links", () => {
    const html = Layout("Test", "Test content").toString();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/passports"');
    expect(html).toContain('href="/services/marketplace"');
  });

  it("footer has agency description", () => {
    const html = Footer().toString();
    expect(html).toMatch(/agency/i);
  });

  it("footer has service links", () => {
    const html = Footer().toString();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/passports"');
    expect(html).toContain('href="/services/marketplace"');
  });

  it("sitemap includes /services/*", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    expect(text).toContain("/services/scanner");
    expect(text).toContain("/services/passports");
    expect(text).toContain("/services/marketplace");
  });
});
