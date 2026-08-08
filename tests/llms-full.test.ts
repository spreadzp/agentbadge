import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { catalogRoutes } from "../src/server/routes/catalog";

describe("llms-full.txt", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", catalogRoutes);
  });

  it("serves /llms-full.txt with 200", async () => {
    const res = await app.request("/llms-full.txt");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(500);
  });
});
