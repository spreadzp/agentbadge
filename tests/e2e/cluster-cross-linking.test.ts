import { describe, it, expect } from "vitest";

const BASE = "http://localhost:4021";

describe("SLICE-116-4: Cross-linking from existing pages to cluster pages", () => {
  describe("FAQ page links", () => {
    let faqHtml: string;

    it("GET /faq returns 200", async () => {
      const res = await fetch(`${BASE}/faq`);
      expect(res.status).toBe(200);
      faqHtml = await res.text();
    });

    it("contains link to /what-is-an-ai-ready-api", async () => {
      if (!faqHtml) faqHtml = await (await fetch(`${BASE}/faq`)).text();
      expect(faqHtml).toContain('href="/what-is-an-ai-ready-api"');
    });

    it("contains link to /openapi-vs-agent-readiness", async () => {
      if (!faqHtml) faqHtml = await (await fetch(`${BASE}/faq`)).text();
      expect(faqHtml).toContain('href="/openapi-vs-agent-readiness"');
    });

    it("contains link to /how-ai-agents-use-apis", async () => {
      if (!faqHtml) faqHtml = await (await fetch(`${BASE}/faq`)).text();
      expect(faqHtml).toContain('href="/how-ai-agents-use-apis"');
    });
  });

  describe("Rules catalog page links", () => {
    let rulesHtml: string;

    it("GET /rules returns 200", async () => {
      const res = await fetch(`${BASE}/rules`);
      expect(res.status).toBe(200);
      rulesHtml = await res.text();
    });

    it("contains link to /how-to-make-an-api-agent-ready", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/how-to-make-an-api-agent-ready"');
    });

    it("contains link to /what-is-an-ai-ready-api", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/what-is-an-ai-ready-api"');
    });

    it("contains link to /agent-readiness-vs-seo", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/agent-readiness-vs-seo"');
    });

    it("contains link to /openapi-vs-agent-readiness", async () => {
      if (!rulesHtml) rulesHtml = await (await fetch(`${BASE}/rules`)).text();
      expect(rulesHtml).toContain('href="/openapi-vs-agent-readiness"');
    });
  });

  describe("Linked cluster pages return 200", () => {
    const clusterSlugs = [
      "/what-is-an-ai-ready-api",
      "/openapi-vs-agent-readiness",
      "/how-ai-agents-use-apis",
      "/how-to-make-an-api-agent-ready",
      "/agent-readiness-vs-seo",
    ];

    for (const slug of clusterSlugs) {
      it(`GET ${slug} returns 200`, async () => {
        const res = await fetch(`${BASE}${slug}`);
        expect(res.status).toBe(200);
      });
    }
  });
});
