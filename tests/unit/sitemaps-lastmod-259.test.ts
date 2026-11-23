import { describe, it, expect, vi, beforeEach } from "vitest";

// SLICE-259-11: sitemap lastmod honesty — no BUILD_DATE fallback.
// A deploy with zero content changes must not move any <lastmod>;
// pages without a known real date emit no lastmod at all
// (absent signal > fake signal, D-259-Q8).

async function importSitemap(buildDate: string) {
  vi.resetModules();
  vi.stubEnv("BUILD_DATE", buildDate);
  try {
    return await import("../../src/server/routes/well-known/sitemaps");
  } finally {
    vi.unstubAllEnvs();
  }
}

describe("SLICE-259-11: honest sitemap lastmod", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
  });

  it("no <lastmod> in sitemap.xml equals BUILD_DATE", async () => {
    const buildDate = "2000-01-01";
    const { buildSitemap } = await importSitemap(buildDate);
    const xml = buildSitemap();
    expect(xml).not.toContain(`<lastmod>${buildDate}</lastmod>`);
  });

  it("identical sitemap across builds when content unchanged", async () => {
    const a = await importSitemap("2000-01-01");
    const b = await importSitemap("2030-12-31");
    expect(a.buildSitemap()).toBe(b.buildSitemap());
  });

  it("blog articles keep real lastmod dates", async () => {
    const { buildSitemap } = await importSitemap("2000-01-01");
    const xml = buildSitemap();
    const blogBlocks =
      xml.match(/<loc>[^<]+\/blog\/[^<]+<\/loc>\s*<lastmod>([^<]+)<\/lastmod>/g) ??
      [];
    expect(blogBlocks.length).toBeGreaterThan(0);
    for (const b of blogBlocks) {
      expect(b).not.toContain("<lastmod>2000-01-01</lastmod>");
    }
  });

  it("ai-sitemap emits no fake lastmod either", async () => {
    const buildDate = "2000-01-01";
    const { buildAiSitemap } = await importSitemap(buildDate);
    const xml = buildAiSitemap();
    expect(xml).not.toContain(`<lastmod>${buildDate}</lastmod>`);
  });
});
