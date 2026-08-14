import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { agentKnowledgeRoutes } from "../../src/server/routes/agent-knowledge";

const app = new Hono();
app.route("/", agentKnowledgeRoutes);

describe("Agent Guide — Agency knowledge layer (SLICE-51-8)", () => {
  it("returns 200", async () => {
    const res = await app.request("/agent-guide");
    expect(res.status).toBe(200);
  });

  it("references all 3 services", async () => {
    const res = await app.request("/agent-guide");
    const html = await res.text();
    expect(html).toMatch(/scanner/i);
    expect(html).toMatch(/passport/i);
    expect(html).toMatch(/marketplace/i);
  });

  it("has agency framing", async () => {
    const res = await app.request("/agent-guide");
    const html = await res.text();
    expect(html).toMatch(/agency/i);
  });

  it("references service pages URLs", async () => {
    const res = await app.request("/agent-guide");
    const html = await res.text();
    expect(html).toContain("/services/scanner");
    expect(html).toContain("/services/passports");
    expect(html).toContain("/services/marketplace");
  });

  it("has Engineering Services section with team links (SLICE-59-1)", async () => {
    const res = await app.request("/agent-guide");
    const text = await res.text();
    expect(text).toContain("Engineering Services");
    expect(text).toContain("/agent-guide/team/capabilities");
    expect(text).toContain("/agent-guide/team/services");
    expect(text).toContain("/agent-guide/team/contact");
    expect(text).toContain("/api/work-requests");
  });
});
