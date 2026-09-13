import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { landingRoutes } from "../../src/server/routes/landing";

const app = new Hono();
app.route("/", landingRoutes);

describe("SLICE-110-9: E2E Homepage Repositioned", () => {
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

  it("contains immediate proof section (145+ checks)", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain("145+");
    expect(html).toContain("evidence-based");
  });

  it("contains conceptual flow (Discover → Understand → Access → Act)", async () => {
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
    expect(html).toContain("/llms.txt");
    expect(html).toContain("/agent-guide");
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
    expect(html).not.toContain("AgencyHubPage");
  });

  it("SEO: <title> contains 'AgentBadge'", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const titleMatch = html.match(/<title>([^<]+)<\/title>/);
    expect(titleMatch).toBeTruthy();
    expect(titleMatch![1]).toContain("AgentBadge");
  });

  it("SEO: meta description present", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const descMatch = html.match(/<meta\s+name="description"\s+content="([^"]+)"/);
    expect(descMatch).toBeTruthy();
    expect(descMatch![1].length).toBeGreaterThan(50);
  });

  it("SEO: canonical URL is https://agentbadge.xyz/", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const canonicalMatch = html.match(/<link\s+rel="canonical"\s+href="([^"]+)"/);
    expect(canonicalMatch).toBeTruthy();
    expect(canonicalMatch![1]).toBe("https://agentbadge.xyz/");
  });

  it("SEO: JSON-LD contains Organization + SoftwareApplication", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const jsonLdBlocks = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) || [];
    const allJson = jsonLdBlocks.map((b) => b.replace(/<[^>]+>/g, "")).join("\n");
    expect(allJson).toContain('"Organization"');
    expect(allJson).toContain('"SoftwareApplication"');
  });

  it("section order: hero before proof, proof before flow, flow before agent-ready", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const heroIdx = html.indexOf('id="scan"');
    const proofIdx = html.indexOf("Immediate Proof");
    const flowIdx = html.indexOf("Conceptual Model");
    const agentReadyIdx = html.indexOf("Agent-Ready Proof");
    expect(heroIdx).toBeGreaterThanOrEqual(0);
    expect(proofIdx).toBeGreaterThan(heroIdx);
    expect(flowIdx).toBeGreaterThan(proofIdx);
    expect(agentReadyIdx).toBeGreaterThan(flowIdx);
  });
});
