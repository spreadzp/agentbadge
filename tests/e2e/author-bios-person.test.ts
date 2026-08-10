import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("Author Bios + Person JSON-LD (SLICE-53-1)", () => {
  it("/about has Person JSON-LD", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toContain('"@type":"Person"');
  });

  it("/about has team section with individual team members", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    expect(html).toMatch(/team|Team/i);
  });

  it("/about has at least 2 Person JSON-LD entries", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    const personCount = (html.match(/"@type":"Person"/g) || []).length;
    expect(personCount).toBeGreaterThanOrEqual(2);
  });

  it("/about team members have names and roles", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    const jsonLdMatch = html.match(
      /<script type="application\/ld\+json">(\[.*?\])<\/script>/s,
    );
    expect(jsonLdMatch).toBeTruthy();
    const schemas = JSON.parse(jsonLdMatch![1]);
    const persons = schemas.filter((s: any) => s["@type"] === "Person");
    expect(persons.length).toBeGreaterThanOrEqual(2);
    for (const p of persons) {
      expect(p.name).toBeTruthy();
      expect(p.jobTitle).toBeTruthy();
    }
  });

  it("/about team members have GitHub or social links", async () => {
    const res = await fetch(`${BASE}/about`);
    const html = await res.text();
    const jsonLdMatch = html.match(
      /<script type="application\/ld\+json">(\[.*?\])<\/script>/s,
    );
    const schemas = JSON.parse(jsonLdMatch![1]);
    const persons = schemas.filter((s: any) => s["@type"] === "Person");
    const withUrl = persons.filter((p: any) => p.url);
    expect(withUrl.length).toBeGreaterThanOrEqual(1);
  });

  it("blog articles have author attribution", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/author|by /i);
  });

  it("blog articles have author in JSON-LD", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    const jsonLdMatch = html.match(
      /<script type="application\/ld\+json">(\[.*?\])<\/script>/s,
    );
    const schemas = JSON.parse(jsonLdMatch![1]);
    const article = schemas.find((s: any) => s["@type"] === "Article");
    expect(article).toBeTruthy();
    expect(article.author).toBeTruthy();
  });

  it("blog article page shows author name visually", async () => {
    const res = await fetch(`${BASE}/blog/what-is-agent-readiness`);
    const html = await res.text();
    expect(html).toMatch(/AgentBadge Team/i);
  });
});
