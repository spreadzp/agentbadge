import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Acronym expansion at first mention (SLICE-54-2)", () => {
  it("FAQ expands HTS, HCS, DID, MCP, A2A at first mention", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toContain("Hedera Token Service");
    expect(html).toContain("Hedera Consensus Service");
    expect(html).toContain("Decentralized Identifier");
    expect(html).toContain("Model Context Protocol");
    expect(html).toContain("Agent-to-Agent");
  });

  it("about page expands HTS, HCS, MCP at first mention", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toContain("Hedera Token Service");
    expect(html).toContain("Hedera Consensus Service");
    expect(html).toContain("Model Context Protocol");
  });

  it("homepage expands HTS, HCS at first mention", async () => {
    const res = await fetch(`${BASE}/`);
    const html = await res.text();
    expect(html).toContain("Hedera Token Service");
    expect(html).toContain("Hedera Consensus Service");
  });

  it("scanner service page expands AEO, GEO at first mention", async () => {
    const res = await fetch(`${BASE}/services/scanner`);
    const html = await res.text();
    expect(html).toMatch(/Answer Engine Optimization|AEO/i);
    expect(html).toMatch(/Generative Engine Optimization|GEO/i);
  });

  it("agent-guide expands key acronyms", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("Hedera Token Service");
    expect(html).toContain("Hedera Consensus Service");
    expect(html).toContain("Model Context Protocol");
  });
});
