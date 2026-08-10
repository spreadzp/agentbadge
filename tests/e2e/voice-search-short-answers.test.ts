import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Short answer blocks for voice search (SLICE-54-1)", () => {
  it("blog articles have short answer blocks", async () => {
    for (const slug of ["what-is-agent-readiness", "mcp-vs-api", "x402-payments"]) {
      const res = await fetch(`${BASE}/blog/${slug}`);
      const html = await res.text();
      expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
    }
  });

  it("FAQ page has a short answer intro section", async () => {
    const res = await fetch(`${BASE}/faq`);
    const html = await res.text();
    expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
  });

  it("about page has a short answer or TL;DR section", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
  });

  it("agent-guide has a short answer or TL;DR section", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/short answer|tl;?dr|in brief|quick answer/i);
  });
});
