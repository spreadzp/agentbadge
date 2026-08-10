import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { servicesRoutes } from "../../src/server/routes/services";

const app = new Hono();
app.route("/", servicesRoutes);

describe("Service page — Scanner (SLICE-51-3)", () => {
  it("returns 200", async () => {
    const res = await app.request("/services/scanner");
    expect(res.status).toBe(200);
  });

  it("has service-specific H1 with Scanner", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toMatch(/<h1[^>]*>[\s\S]*Scanner[\s\S]*<\/h1>/i);
  });

  it("has CTA link to scan", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toMatch(/href=".*scan.*"/i);
  });

  it("has correct page meta title", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("<title>");
    expect(html).toContain("Agent Readiness Scanner");
  });

  it("has og:title meta", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("og:title");
  });

  it("has canonical link", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("/services/scanner");
  });

  it("has features list", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("72");
    expect(html).toContain("15 categories");
  });

  it("has back to agency link", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain('href="/"');
  });
});
