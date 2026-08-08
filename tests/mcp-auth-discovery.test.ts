import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { wellKnownRoutes } from "../src/server/routes/well-known";

describe("MCP auth discovery", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();
    app.route("/", wellKnownRoutes);
  });

  it("serves /.well-known/oauth-authorization-server", async () => {
    const res = await app.request("/.well-known/oauth-authorization-server");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const data = await res.json();
    expect(data.issuer).toBeDefined();
  });
});
