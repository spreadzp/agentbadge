import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { landingRoutes } from "../../src/server/routes/landing";
import { servicesRoutes } from "../../src/server/routes/services";
import { contentPageRoutes } from "../../src/server/routes/content-pages";
import { agentKnowledgeRoutes } from "../../src/server/routes/agent-knowledge";
import { wellKnownRoutes } from "../../src/server/routes/well-known";

const app = new Hono();
app.route("/", landingRoutes);
app.route("/", servicesRoutes);
app.route("/", contentPageRoutes);
app.route("/", agentKnowledgeRoutes);
app.route("/", wellKnownRoutes);

describe("EPIC-51 Smoke Tests (SLICE-51-13)", () => {
  it("/ renders agency hub", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/agency|Agency/i);
  });

  for (const slug of ["scanner", "passports", "marketplace"]) {
    it(`/services/${slug} returns 200`, async () => {
      const res = await app.request(`/services/${slug}`);
      expect(res.status).toBe(200);
    });
  }

  it("/about reflects agency story", async () => {
    const res = await app.request("/about");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toMatch(/agency|AgentBadge/i);
  });

  it("/faq has FAQPage JSON-LD", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("FAQPage");
  });

  it("/agent-guide returns 200", async () => {
    const res = await app.request("/agent-guide");
    expect(res.status).toBe(200);
  });

  it("/agent-guide.json returns 200", async () => {
    const res = await app.request("/agent-guide.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");
  });

  it("/.well-known/agent-guide.json returns 200", async () => {
    const res = await app.request("/.well-known/agent-guide.json");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("json");
  });

  it("sitemap includes /services/*", async () => {
    const res = await app.request("/sitemap.xml");
    const text = await res.text();
    expect(text).toContain("/services/scanner");
    expect(text).toContain("/services/passports");
    expect(text).toContain("/services/marketplace");
  });

  it("/scanner redirects to /services/scanner", async () => {
    const res = await app.request("/scanner");
    expect(res.status).toBe(301);
  });

  it("/marketplace redirects to /services/marketplace", async () => {
    const res = await app.request("/marketplace");
    expect(res.status).toBe(301);
  });
});
