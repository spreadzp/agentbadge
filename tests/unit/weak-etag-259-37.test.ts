import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { weakEtag } from "../../src/server/middleware/weak-etag";

// SLICE-259-37: generated agent surfaces must revalidate cheaply — a weak
// ETag over the served bytes, 304 with ETag+Cache-Control on match.
describe("SLICE-259-37: weakEtag middleware", () => {
  function appWith() {
    const app = new Hono();
    app.use("/llms.txt", weakEtag());
    app.use("/.well-known/*", weakEtag());
    app.get("/llms.txt", (c) => c.text("# llms"));
    app.get("/.well-known/agent-card.json", (c) => c.json({ name: "x" }));
    app.get("/unmatched", (c) => c.text("no etag here"));
    app.get("/.well-known/already.json", (c) => {
      c.header("ETag", '"pre-existing"');
      return c.json({ ok: true });
    });
    return app;
  }

  it("adds W/ etag to a 200 GET and answers 304 on revalidation", async () => {
    const app = appWith();
    const res = await app.request("/llms.txt");
    const etag = res.headers.get("etag");
    expect(etag).toMatch(/^W\/"[0-9a-f]{16}"$/);

    const again = await app.request("/llms.txt", {
      headers: { "If-None-Match": etag! },
    });
    expect(again.status).toBe(304);
    expect(again.headers.get("etag")).toBe(etag);
    expect(await again.text()).toBe("");
  });

  it("applies under wildcard mounts and skips non-matching paths", async () => {
    const app = appWith();
    const res = await app.request("/.well-known/agent-card.json");
    expect(res.headers.get("etag")).toMatch(/^W\//);

    const bare = await app.request("/unmatched");
    expect(bare.headers.get("etag")).toBeNull();
  });

  it("does not overwrite a pre-existing ETag", async () => {
    const res = await appWith().request("/.well-known/already.json");
    expect(res.headers.get("etag")).toBe('"pre-existing"');
  });
});
