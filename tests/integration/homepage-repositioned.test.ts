import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { setupMockEnv } from "../e2e/helpers";
import { landingRoutes } from "../../src/server/routes/landing";
import { uiRoutes } from "../../src/server/routes/ui";

describe("SLICE-110-9: E2E tests for repositioned homepage", () => {
  let app: Hono;

  beforeAll(() => {
    setupMockEnv();
    app = new Hono();
    app.route("/", landingRoutes);
    app.route("/", uiRoutes);
  });

  it("GET / returns 200", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
  });

  it("contains hero H1 'Can AI Agents Actually Use Your API?'", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Can AI Agents Actually");
    expect(html).toContain("Use Your API?");
  });

  it("contains immediate proof section with rule count", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Immediate Proof");
    expect(html).toContain("Automated checks");
  });

  it("contains conceptual flow: Discover → Understand → Access → Act", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Discover");
    expect(html).toContain("Understand");
    expect(html).toContain("Access");
    expect(html).toContain("Act");
  });

  it("contains agent-ready proof block", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Agent-Ready Proof");
    expect(html).toContain("We built AgentBadge");
  });

  it("contains passport secondary section", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("Verify Agent Identity");
    expect(html).toContain('href="/passport"');
  });

  it("does NOT contain agency-hub div", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).not.toContain('id="agency-hub"');
  });

  it("SEO: <title> contains 'AgentBadge'", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("<title>");
    expect(html).toContain("AgentBadge");
  });

  it("SEO: meta description present", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toMatch(/<meta name="description" content="[^"]+"/);
  });

  it("SEO: canonical URL is https://agentbadge.xyz/", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('rel="canonical"');
    expect(html).toContain("https://agentbadge.xyz/");
  });

  it("SEO: JSON-LD contains Organization + SoftwareApplication", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('"@type":"Organization"');
    expect(html).toContain('"@type":"SoftwareApplication"');
  });

  it("section order: hero before proof, proof before flow, flow before agent-ready", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const heroIdx = html.indexOf('id="scan"');
    const proofIdx = html.indexOf("Immediate Proof");
    const flowIdx = html.indexOf("Conceptual Model");
    const agentReadyIdx = html.indexOf("Agent-Ready Proof");
    expect(heroIdx).toBeLessThan(proofIdx);
    expect(proofIdx).toBeLessThan(flowIdx);
    expect(flowIdx).toBeLessThan(agentReadyIdx);
  });
});
