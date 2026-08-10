import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("llms-full.txt (SLICE-53-5)", () => {
  it("returns 200", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    expect(res.status).toBe(200);
  });

  it("has comprehensive content (> 500 words)", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text.split(/\s+/).length).toBeGreaterThan(500);
  });

  it("includes all services", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text).toMatch(/scanner/i);
    expect(text).toMatch(/passport/i);
    expect(text).toMatch(/marketplace/i);
  });

  it("includes FAQ content", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text).toMatch(/FAQ/i);
    expect(text).toMatch(/What is AgentBadge/i);
  });

  it("includes blog articles", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text).toMatch(/agent readiness/i);
    expect(text).toMatch(/x402/i);
    expect(text).toMatch(/MCP/i);
  });

  it("includes about content", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text).toMatch(/about/i);
  });

  it("includes guides", async () => {
    const res = await fetch(`${BASE}/llms-full.txt`);
    const text = await res.text();
    expect(text).toMatch(/agent-guide/i);
    expect(text).toMatch(/market-guide/i);
  });

  it("llms.txt links to llms-full.txt", async () => {
    const res = await fetch(`${BASE}/llms.txt`);
    const text = await res.text();
    expect(text).toContain("llms-full.txt");
  });
});
