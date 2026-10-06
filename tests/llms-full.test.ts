import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { discoveryManifestRoutes } from "../src/server/routes/discovery";

describe("llms-full.txt", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", discoveryManifestRoutes);
  });

  it("serves /llms-full.txt with 200", async () => {
    const res = await app.request("/llms-full.txt");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/plain");
    const body = await res.text();
    expect(body.length).toBeGreaterThan(500);
  });
});
