import { describe, it, expect } from "vitest";

process.env.MOCK_HEDERA = "true";
const { createApp } = await import("../../src/server/index");

// SLICE-259-17: /faq — rendered-HTML memoization + ETag/304.
// The page is deterministic module data (getFaqEntries + JSON-LD),
// so the rendered bytes and the weak ETag are stable per process.

const app = createApp();

describe("/faq cache + ETag", () => {
  it("GET /faq carries a stable weak ETag", async () => {
    const a = await app.request("/faq");
    const b = await app.request("/faq");
    const etag = a.headers.get("etag");
    expect(etag).toMatch(/^W\/"/);
    expect(b.headers.get("etag")).toBe(etag);
    // deterministic bytes — cached render is identical
    expect(await a.text()).toBe(await b.text());
  });

  it("If-None-Match: <etag> → 304 with empty body", async () => {
    const first = await app.request("/faq");
    const etag = first.headers.get("etag")!;
    const res = await app.request("/faq", {
      headers: { "If-None-Match": etag },
    });
    expect(res.status).toBe(304);
    expect(res.headers.get("etag")).toBe(etag);
    expect(await res.text()).toBe("");
  });

  it("If-None-Match with a stale tag → 200", async () => {
    const res = await app.request("/faq", {
      headers: { "If-None-Match": 'W/"deadbeef"' },
    });
    expect(res.status).toBe(200);
    expect((await res.text()).length).toBeGreaterThan(50_000);
  });

  it("If-None-Match: * → 304", async () => {
    const res = await app.request("/faq", {
      headers: { "If-None-Match": "*" },
    });
    expect(res.status).toBe(304);
  });

  it("repeat request is served from memoized render (<500ms TTFB)", async () => {
    await app.request("/faq"); // warm
    const t0 = performance.now();
    const res = await app.request("/faq");
    const ttfb = performance.now() - t0;
    expect(res.status).toBe(200);
    await res.text();
    expect(ttfb).toBeLessThan(500);
    console.log(`[bench] /faq repeat-request TTFB: ${ttfb.toFixed(1)}ms`);
  });

  it("HEAD /faq carries the same ETag, no body", async () => {
    const get = await app.request("/faq");
    const head = await app.request("/faq", { method: "HEAD" });
    expect(head.status).toBe(200);
    expect(head.headers.get("etag")).toBe(get.headers.get("etag"));
    expect(head.headers.get("content-type")).toContain("text/html");
    expect(await head.text()).toBe("");
  });

  it("FAQPage JSON-LD still present in cached HTML", async () => {
    const res = await app.request("/faq");
    const html = await res.text();
    expect(html).toContain('"@type":"FAQPage"');
    expect(html).toContain("mainEntity");
  });
});
