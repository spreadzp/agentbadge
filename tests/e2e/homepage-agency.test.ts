import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { landingRoutes } from "../../src/server/routes/landing";

const app = new Hono();
app.route("/", landingRoutes);

describe("Homepage — Agency Hub (SLICE-51-2)", () => {
  it("renders agency headline, not single product", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agency for the Agentic Web");
  });

  it("shows all 3 service cards with links", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('href="/services/scanner"');
    expect(html).toContain('href="/services/passports"');
    expect(html).toContain('href="/services/marketplace"');
  });

  it("has cross-sell section mentioning all services", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html.toLowerCase()).toMatch(/scan.*passport.*marketplace/);
  });

  it("has agency value proposition", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("agent-ready");
  });

  it("page title reflects agency positioning", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("AgentBadge — Agency for the Agentic Web");
  });
});
