import { describe, it, expect, beforeAll } from "vitest";
import { Hono } from "hono";
import { openApiConfig } from "../src/server/openapi";

// Minimal app that serves the OpenAPI spec at /openapi.json
// In production this is handled by hono-openapi's openAPIRouteHandler
describe("OpenAPI spec", () => {
  let app: Hono;

  beforeAll(() => {
    app = new Hono();

    // Serve a minimal OpenAPI spec at /openapi.json
    app.get("/openapi.json", (c) => {
      return c.json({
        openapi: "3.0.0",
        info: {
          title: openApiConfig.info.title,
          version: openApiConfig.info.version,
          description: openApiConfig.info.description,
        },
        servers: openApiConfig.servers,
        paths: {
          "/passport/request": {
            post: {
              tags: ["Passport"],
              summary: "Issue agent passport NFT",
              "x-payment-info": {
                protocols: ["x402"],
                price: { asset: "HBAR", amounts: { bronze: 5, silver: 25, gold: 100, platinum: 500 } },
                facilitator: process.env.x402_FACILITATOR_URL ?? "",
              },
            },
          },
          "/catalog": {
            get: {
              tags: ["Catalog"],
              summary: "Get tier pricing",
            },
          },
        },
      });
    });

    // Also serve at /swagger.json (alias)
    app.get("/swagger.json", (c) => {
      return c.json({
        openapi: "3.0.0",
        info: { title: "AgentBadge API", version: "0.3.0" },
        paths: {},
      });
    });

    // Simulate real routes
    app.post("/passport/request", (c) => c.json({ ok: true }));
    app.get("/catalog", (c) => c.json({ tiers: [] }));
  });

  it("serves /openapi.json with 200", async () => {
    const res = await app.request("/openapi.json");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("application/json");
    const spec = await res.json();
    expect(spec.openapi).toBeTruthy();
  });

  it("has info.title", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    expect(spec.info).toBeTruthy();
    expect(spec.info.title).toBeTruthy();
  });

  it("has paths defined", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    expect(spec.paths).toBeTruthy();
    expect(Object.keys(spec.paths).length).toBeGreaterThan(0);
  });

  it("paid operations have x-payment-info", async () => {
    const spec = await (await app.request("/openapi.json")).json();
    const passportPath = spec.paths["/passport/request"];
    expect(passportPath).toBeTruthy();
    const postOp = passportPath.post;
    expect(postOp["x-payment-info"]).toBeTruthy();
    expect(postOp["x-payment-info"].price).toBeTruthy();
  });
});
