import { describe, it, expect, beforeAll, vi } from "vitest";

process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";

const bunGlobal = (globalThis as Record<string, unknown>).Bun ?? {};
vi.stubGlobal("Bun", {
  ...bunGlobal,
  serve: vi.fn(() => ({ hostname: "localhost", port: 0 })),
});

const { createApp } = await import("../../src/server/index");

describe("SLICE-81-4: Dashboard noindex + sitemap single-host", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it("/dashboard returns X-Robots-Tag: noindex", async () => {
    const res = await app.request("/dashboard");
    expect(res.status).toBe(200);
    const xRobots = res.headers.get("x-robots-tag");
    expect(xRobots).not.toBeNull();
    expect(xRobots!.toLowerCase()).toContain("noindex");
  });

  it("sitemap.xml contains only agentbadge.xyz URLs (single-host)", async () => {
    const res = await app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    const locs = [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.length).toBeGreaterThan(0);
    for (const loc of locs) {
      const host = new URL(loc).hostname;
      expect(host).toBe("agentbadge.xyz");
    }
  });

  it("sitemap.xml does not contain gitbook.io", async () => {
    const res = await app.request("/sitemap.xml");
    const xml = await res.text();
    expect(xml).not.toContain("gitbook.io");
  });

  it("/dashboard is NOT listed in sitemap.xml", async () => {
    const res = await app.request("/sitemap.xml");
    const xml = await res.text();
    expect(xml).not.toContain("/dashboard</loc>");
  });
});
