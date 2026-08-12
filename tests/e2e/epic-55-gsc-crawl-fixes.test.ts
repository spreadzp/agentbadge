import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("EPIC-55: GSC Crawl Fixes", () => {
  // SLICE-55-1: /team → 301 redirect to /about
  describe("SLICE-55-1: /team redirect", () => {
    it("GET /team returns 301", async () => {
      const res = await fetch(`${BASE}/team`, { redirect: "manual" });
      expect(res.status).toBe(301);
    });

    it("GET /team redirects to /about", async () => {
      const res = await fetch(`${BASE}/team`, { redirect: "manual" });
      const location = res.headers.get("location") ?? "";
      expect(location).toContain("/about");
    });

    it("sitemap.xml does not contain /team", async () => {
      const res = await fetch(`${BASE}/sitemap.xml`);
      const text = await res.text();
      expect(text).not.toContain("/team</loc>");
    });

    it("sitemap.xml contains /about", async () => {
      const res = await fetch(`${BASE}/sitemap.xml`);
      const text = await res.text();
      expect(text).toContain("/about</loc>");
    });
  });

  // SLICE-55-2: noindex on /ui/* + canonical fix
  describe("SLICE-55-2: noindex on /ui/* pages", () => {
    it("GET /ui/agents has noindex meta tag", async () => {
      const res = await fetch(`${BASE}/ui/agents`);
      const html = await res.text();
      expect(html).toContain('name="robots"');
      expect(html).toContain("noindex");
    });

    it("GET /ui/catalog has noindex meta tag", async () => {
      const res = await fetch(`${BASE}/ui/catalog`);
      const html = await res.text();
      expect(html).toContain("noindex");
    });

    it("GET /ui/a2a has noindex meta tag", async () => {
      const res = await fetch(`${BASE}/ui/a2a`);
      const html = await res.text();
      expect(html).toContain("noindex");
    });

    it("GET /ui/search has noindex meta tag", async () => {
      const res = await fetch(`${BASE}/ui/search`);
      const html = await res.text();
      expect(html).toContain("noindex");
    });

    it("GET /ui/help has noindex meta tag", async () => {
      const res = await fetch(`${BASE}/ui/help`);
      const html = await res.text();
      expect(html).toContain("noindex");
    });

    it("noindex pages have canonical pointing to /", async () => {
      const res = await fetch(`${BASE}/ui/agents`);
      const html = await res.text();
      expect(html).toContain('rel="canonical"');
      expect(html).toContain("https://agentbadge.xyz/");
    });

    it("sitemap.xml does not contain /ui/ paths", async () => {
      const res = await fetch(`${BASE}/sitemap.xml`);
      const text = await res.text();
      expect(text).not.toContain("/ui/agents");
      expect(text).not.toContain("/ui/catalog");
      expect(text).not.toContain("/ui/market/tasks");
      expect(text).not.toContain("/ui/search");
      expect(text).not.toContain("/ui/help");
    });
  });

  // SLICE-55-3: noindex on /a2a/* JSON endpoints
  describe("SLICE-55-3: X-Robots-Tag on /a2a/* JSON", () => {
    it("GET /a2a/inbox has X-Robots-Tag noindex", async () => {
      const res = await fetch(`${BASE}/a2a/inbox?did=did:hcs:0.0.1:1`);
      expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    });

    it("GET /a2a/conversation has X-Robots-Tag noindex", async () => {
      const res = await fetch(`${BASE}/a2a/conversation?didA=did:hcs:0.0.1:1&didB=did:hcs:0.0.1:2`);
      expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    });
  });

  // SLICE-55-4: robots.txt disallow dynamic patterns
  describe("SLICE-55-4: robots.txt disallow patterns", () => {
    it("robots.txt disallows /ui/", async () => {
      const res = await fetch(`${BASE}/robots.txt`);
      const text = await res.text();
      expect(text).toMatch(/Disallow:\s*\/ui\//);
    });

    it("robots.txt disallows /a2a/", async () => {
      const res = await fetch(`${BASE}/robots.txt`);
      const text = await res.text();
      expect(text).toMatch(/Disallow:\s*\/a2a\//);
    });

    it("robots.txt disallows /market/tasks/", async () => {
      const res = await fetch(`${BASE}/robots.txt`);
      const text = await res.text();
      expect(text).toMatch(/Disallow:\s*\/market\/tasks\//);
    });
  });

  // SLICE-55-5: /agents JSON noindex
  describe("SLICE-55-5: /agents JSON noindex", () => {
    it("robots.txt disallows /agents", async () => {
      const res = await fetch(`${BASE}/robots.txt`);
      const text = await res.text();
      expect(text).toMatch(/Disallow:\s*\/agents/);
    });

    it("GET /agents has X-Robots-Tag noindex", async () => {
      const res = await fetch(`${BASE}/agents`);
      expect(res.headers.get("X-Robots-Tag")).toContain("noindex");
    });
  });

  // SLICE-55-6: /work-with-us in sitemap
  describe("SLICE-55-6: /work-with-us sitemap", () => {
    it("sitemap.xml contains /work-with-us", async () => {
      const res = await fetch(`${BASE}/sitemap.xml`);
      const text = await res.text();
      expect(text).toContain("/work-with-us");
    });
  });
});
