import { describe, it, expect, beforeAll, vi } from "vitest";
process.env.MOCK_HEDERA = "true";
process.env.PASSPORT_TOKEN_ID = "0.0.1234567";
const bunGlobal = (globalThis as Record<string, unknown>).Bun ?? {};
vi.stubGlobal("Bun", {
  ...bunGlobal,
  serve: vi.fn(() => ({ hostname: "localhost", port: 0 })),
});

const { createApp } = await import("../../src/server/index");

/**
 * GSC indexing fixes:
 * - GET /passport/request serves the public passport-request form
 *   (payment gates are POST-scoped; the URL is sitemap-indexable).
 * - Bare /checkout 301s to /pricing instead of dead-ending in a 404.
 * - Noindex pages no longer advertise a .md alternate link.
 */
describe("GSC indexing fixes", () => {
  let app: ReturnType<typeof createApp>;

  beforeAll(() => {
    app = createApp();
  });

  it("GET /passport/request returns 200 HTML form", async () => {
    const res = await app.request("/passport/request");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Request Passport");
    expect(html).not.toContain('content="noindex');
  });

  it("GET /passport/request?tier=gold keeps tier picker on the public path", async () => {
    const res = await app.request("/passport/request?tier=gold");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("/passport/request?tier=");
    expect(html).not.toContain("/ui/passport/request?tier=");
  });

  it("POST /passport/request is NOT the form page (payment/validation gate intact)", async () => {
    const res = await app.request("/passport/request", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "{}",
    });
    // Any outcome except HTML form: 402 challenge, 400 validation or
    // 503 chain-disabled — never a public page render.
    expect(res.status).not.toBe(200);
    expect(res.headers.get("content-type")).not.toContain("text/html");
  });

  it("sitemap.xml includes /passport/request", async () => {
    const res = await app.request("/sitemap.xml");
    expect(res.status).toBe(200);
    const xml = await res.text();
    expect(xml).toContain("/passport/request");
  });

  it("bare /checkout redirects to /pricing (301)", async () => {
    const res = await app.request("/checkout", { redirect: "manual" });
    expect(res.status).toBe(301);
    expect(res.headers.get("location")).toBe("/pricing");
  });

  it("noindex checkout page emits no .md alternate link", async () => {
    const res = await app.request("/checkout?product=PASSPORT_BRONZE");
    if (res.status === 200) {
      const html = await res.text();
      expect(html).toContain("noindex");
      expect(html).not.toContain('type="text/markdown" title="Markdown version"');
    } else {
      // Product code may differ by env — unknown product is a legit 404.
      expect(res.status).toBe(404);
    }
  });
});
