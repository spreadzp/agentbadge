import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { serveStatic } from "@hono/node-server/serve-static";
import { LandingLayout } from "../src/views/landing/layout";
import { PageMeta, BASE_URL } from "../src/server/lib/page-meta";

describe("Homepage meta fixes", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    // Serve favicon.svg statically
    app.use("/favicon.svg", (c, next) => {
      c.header("Cache-Control", "public, max-age=86400");
      c.header("Content-Type", "image/svg+xml");
      return next();
    }, serveStatic({ root: "./public", path: "/favicon.svg" }));

    // Homepage route
    app.get("/", (c) => {
      const meta = PageMeta["/"];
      const html = LandingLayout("content", undefined, meta, []);
      return c.html(html.toString());
    });
  });

  it("has SVG favicon link in HTML", async () => {
    const res = await app.request("/");
    const html = await res.text();

    expect(html).toMatch(/rel=["']icon["'].*type=["']image\/svg\+xml["']/);
    expect(html).toContain("/favicon.svg");
  });

  it("favicon.svg is reachable", async () => {
    const res = await app.request("/favicon.svg");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("image/svg+xml");
  });

  it("canonical URL points to production domain", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const canonicalMatch = html.match(/<link rel=["']canonical["'] href="([^"]+)"/);
    expect(canonicalMatch).toBeTruthy();
    expect(canonicalMatch![1]).toContain("agentbadge.xyz");
    expect(canonicalMatch![1]).not.toContain("localhost");
  });

  it("og:image URL contains agentbadge.xyz", async () => {
    const res = await app.request("/");
    const html = await res.text();
    const ogMatch = html.match(/<meta property="og:image" content="([^"]+)"/);
    expect(ogMatch).toBeTruthy();
    expect(ogMatch![1]).toContain("agentbadge.xyz");
  });
});
