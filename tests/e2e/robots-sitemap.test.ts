import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("robots.txt and sitemap.xml accessibility (SLICE-52-6)", () => {
  it("robots.txt returns 200", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("text");
  });

  it("sitemap.xml returns 200", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type") ?? "").toContain("xml");
  });

  it("robots.txt allows GPTBot", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    const text = await res.text();
    expect(text).toMatch(/GPTBot/i);
    expect(text).toMatch(/Allow:\s*\//);
  });

  it("robots.txt allows ClaudeBot", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    const text = await res.text();
    expect(text).toMatch(/ClaudeBot/i);
  });

  it("robots.txt has Content-Signal header", async () => {
    const res = await fetch(`${BASE}/robots.txt`);
    const text = await res.text();
    expect(text).toMatch(/Content-Signal/i);
  });

  it("sitemap.xml contains homepage URL", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("https://agentbadge.xyz/");
  });

  it("sitemap.xml contains blog URLs", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/blog");
    expect(text).toContain("/blog/what-is-agent-readiness");
    expect(text).toContain("/blog/mcp-vs-api");
    expect(text).toContain("/blog/x402-payments");
  });

  it("sitemap.xml contains service URLs", async () => {
    const res = await fetch(`${BASE}/sitemap.xml`);
    const text = await res.text();
    expect(text).toContain("/services/scanner");
    expect(text).toContain("/services/passports");
    expect(text).toContain("/services/marketplace");
  });
});
