/**
 * SLICE-178-4 (MYPROJ-2517): markdown negotiation + .md mirrors.
 *
 * AC1: Accept: text/markdown → markdown; no header → HTML (default unchanged).
 * AC2: GET /<page>.md ≡ negotiation variant.
 * AC3: public pages carry <link rel="alternate" type="text/markdown">.
 * AC4: llms.txt .md links resolve.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  markdownNegotiation,
  markdownMirrorRoutes,
} from "../../src/server/middleware/markdown-negotiation";
import { landingRoutes } from "../../src/server/routes/landing";
import { servicesRoutes } from "../../src/server/routes/services";

function mkApp(): Hono {
  const app = new Hono();
  app.use(markdownNegotiation());
  app.route("/", landingRoutes);
  app.route("/", servicesRoutes);
  app.route("/", markdownMirrorRoutes(app));
  return app;
}

const MD_ACCEPT = { Accept: "text/markdown" };

describe("Accept negotiation", () => {
  const app = mkApp();

  it("GET / without Accept → text/html (default unchanged)", async () => {
    const res = await app.request("/");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("<html");
  });

  it("GET / with Accept: text/markdown → markdown + Vary: Accept", async () => {
    const res = await app.request("/", { headers: MD_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(res.headers.get("vary")).toContain("Accept");
    const body = await res.text();
    expect(body).not.toContain("<html");
    expect(body).toMatch(/^#\s/m);
  });

  it("GET /services/scanner with markdown Accept → markdown", async () => {
    const res = await app.request("/services/scanner", { headers: MD_ACCEPT });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    expect(await res.text()).toMatch(/^#\s/m);
  });

  it("q-preference: markdown;q=0.9 beats html;q=0.1", async () => {
    const res = await app.request("/services/scanner", {
      headers: { Accept: "text/markdown;q=0.9,text/html;q=0.1" },
    });
    expect(res.headers.get("content-type")).toContain("text/markdown");
  });

  it("q-preference: html;q=0.9 beats markdown;q=0.1 → HTML", async () => {
    const res = await app.request("/services/scanner", {
      headers: { Accept: "text/html;q=0.9,text/markdown;q=0.1" },
    });
    expect(res.headers.get("content-type")).toContain("text/html");
  });
});

describe(".md mirrors", () => {
  const app = mkApp();

  it("GET /index.md ≡ negotiated / (AC2)", async () => {
    const mirror = await app.request("/index.md");
    expect(mirror.status).toBe(200);
    expect(mirror.headers.get("content-type")).toContain("text/markdown");
    const negotiated = await app.request("/", { headers: MD_ACCEPT });
    expect(await mirror.text()).toBe(await negotiated.text());
  });

  it("GET /services/scanner.md ≡ negotiated variant", async () => {
    const mirror = await app.request("/services/scanner.md");
    expect(mirror.status).toBe(200);
    const negotiated = await app.request("/services/scanner", {
      headers: MD_ACCEPT,
    });
    expect(await mirror.text()).toBe(await negotiated.text());
  });

  it("404 for .md of non-existent page", async () => {
    const res = await app.request("/no-such-page.md");
    expect(res.status).toBe(404);
  });
});

describe("discoverability — link rel=alternate", () => {
  const app = mkApp();

  it("landing / has text/markdown alternate link to /index.md", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toContain('rel="alternate"');
    expect(html).toContain("text/markdown");
    expect(html).toContain("/index.md");
  });

  it("/services/scanner has alternate link to /services/scanner.md", async () => {
    const res = await app.request("/services/scanner");
    const html = await res.text();
    expect(html).toContain("/services/scanner.md");
  });
});
