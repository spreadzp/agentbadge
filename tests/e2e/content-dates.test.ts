import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Publication & Updated Dates (SLICE-53-2)", () => {
  it("blog articles have visible publication date", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/<time/i);
    expect(html).toMatch(/2026/);
  });

  it("blog articles have datePublished in JSON-LD", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toContain("datePublished");
  });

  it("blog articles have dateModified in JSON-LD", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    const jsonLdMatch = html.match(
      /<script type="application\/ld\+json">(\[.*?\])<\/script>/s,
    );
    expect(jsonLdMatch).toBeTruthy();
    const schemas = JSON.parse(jsonLdMatch![1]);
    const article = schemas.find((s: any) => s["@type"] === "Article");
    expect(article).toBeTruthy();
    expect(article.datePublished).toBeTruthy();
    expect(article.dateModified).toBeTruthy();
  });

  it("blog listing shows publication dates", async () => {
    const res = await fetch(`${BASE}/blog`);
    const html = await res.text();
    expect(html).toMatch(/2026/);
  });

  it("agent-guide has visible last updated date", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/last updated|updated/i);
    expect(html).toMatch(/2026/);
  });

  it("agent-guide has dateModified in JSON-LD", async () => {
    const res = await fetch(`${BASE}/agent-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toContain("dateModified");
  });

  it("market-guide has visible last updated date", async () => {
    const res = await fetch(`${BASE}/market-guide`, {
      headers: { Accept: "text/html" },
    });
    const html = await res.text();
    expect(html).toMatch(/last updated|updated/i);
  });

  it("about page has dateModified in JSON-LD", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toContain("dateModified");
  });
});
