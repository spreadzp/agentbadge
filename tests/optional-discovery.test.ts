import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";
import { feedRoutes } from "../src/server/routes/feed";
import { LandingLayout } from "../src/views/landing/layout";

describe("Optional discovery files", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
    app.route("/", feedRoutes);
    // Simple homepage that uses LandingLayout
    app.get("/", (c) => {
      const html = LandingLayout("<div></div>");
      return c.html(html as unknown as string);
    });
  });

  it("serves /agents.txt", async () => {
    const res = await app.request("/agents.txt");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body.length).toBeGreaterThanOrEqual(10);
  });

  it("serves RSS feed at /feed", async () => {
    const res = await app.request("/feed");
    expect(res.status).toBe(200);
    const body = await res.text();
    expect(body).toContain("<rss");
  });

  it("HTML links to RSS feed", async () => {
    const res = await app.request("/");
    const html = await res.text();
    expect(html).toMatch(/rel=["']alternate["'].*type=["']application\/rss\+xml["']/);
  });

  it("serves /.well-known/webmcp.json", async () => {
    const res = await app.request("/.well-known/webmcp.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.name).toBeTruthy();
    expect(body.version).toBeTruthy();
    expect(body.tools).toBeInstanceOf(Array);
  });
});
