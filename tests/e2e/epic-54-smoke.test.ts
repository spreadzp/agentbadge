import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("EPIC-54 Smoke Test — Voice Search, Domain & Testnet Polish", () => {
  describe("SLICE-54-1: Short answer blocks", () => {
    it("blog articles have TL;DR or Short Answer", async () => {
      for (const slug of ["what-is-agent-readiness", "mcp-vs-api", "x402-payments"]) {
        const res = await fetch(`${BASE}/blog/${slug}`);
        const html = await res.text();
        expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
      }
    });

    it("FAQ has TL;DR block", async () => {
      const res = await fetch(`${BASE}/faq`);
      const html = await res.text();
      expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
    });

    it("about page has TL;DR block", async () => {
      const res = await fetch(`${BASE}/about`);
      const html = await res.text();
      expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
    });

    it("agent-guide has TL;DR block", async () => {
      const res = await fetch(`${BASE}/agent-guide`, {
        headers: { Accept: "text/html" },
      });
      const html = await res.text();
      expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
    });
  });

  describe("SLICE-54-2: Acronym expansion", () => {
    it("FAQ expands HTS, HCS, DID, MCP, A2A", async () => {
      const res = await fetch(`${BASE}/faq`);
      const html = await res.text();
      expect(html).toContain("Hedera Token Service");
      expect(html).toContain("Hedera Consensus Service");
      expect(html).toContain("Decentralized Identifier");
      expect(html).toContain("Model Context Protocol");
      expect(html).toContain("Agent-to-Agent");
    });

    it("about page expands HTS, HCS, MCP", async () => {
      const res = await fetch(`${BASE}/about`);
      const html = await res.text();
      expect(html).toContain("Hedera Token Service");
      expect(html).toContain("Hedera Consensus Service");
      expect(html).toContain("Model Context Protocol");
    });

    it("homepage expands HTS, HCS", async () => {
      const res = await fetch(`${BASE}/`);
      const html = await res.text();
      expect(html).toContain("Hedera Token Service");
      expect(html).toContain("Hedera Consensus Service");
    });

    it("agent-guide expands HTS, HCS, MCP", async () => {
      const res = await fetch(`${BASE}/agent-guide`, {
        headers: { Accept: "text/html" },
      });
      const html = await res.text();
      expect(html).toContain("Hedera Token Service");
      expect(html).toContain("Hedera Consensus Service");
      expect(html).toContain("Model Context Protocol");
    });
  });

  describe("SLICE-54-4: Testnet positioning", () => {
    it("FAQ has 'Join testnet' CTA with benefits", async () => {
      const res = await fetch(`${BASE}/faq`);
      const html = await res.text();
      expect(html).toMatch(/join testnet/i);
      expect(html).toMatch(/free|safe|early access|no cost|zero cost/i);
    });

    it("about page has 'Join testnet' CTA", async () => {
      const res = await fetch(`${BASE}/about`);
      const html = await res.text();
      expect(html).toMatch(/join testnet|try.*testnet|testnet.*free|testnet.*advantage/i);
    });
  });
});
