/**
 * SLICE-221-5 (EPIC-221, D-221-5): Legacy checkout deprecation headers +
 * OpenAPI coverage for /api/v1/*.
 *
 * AC1: /api/payment/products, /api/payment/checkout, /payment/success,
 *      /payment/canceled → Deprecation + Sunset headers.
 * AC2: /api/stripe/webhook → NO deprecation headers (serves both flows).
 * AC3: OpenAPI spec marks legacy endpoints deprecated and contains the
 *      /api/v1/payments* + /api/v1/catalog/* paths.
 */
import { describe, it, expect } from "vitest";
import { openAPIRouteHandler } from "hono-openapi";

import { makeTestApp } from "./e2e/helpers";
import { openApiConfig } from "../src/server/openapi";
import { paymentsApiRoutes } from "../src/server/routes/payments-api";
import { commerceCatalogRoutes } from "../src/server/routes/commerce-catalog";

const SUNSET = "Thu, 31 Dec 2026 00:00:00 GMT";

describe("legacy payment deprecation headers", () => {
  it("GET /api/payment/products → Deprecation + Sunset", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/payment/products");
    expect(res.status).toBe(200);
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBe(SUNSET);
    expect(res.headers.get("Link")).toContain("successor-version");
  });

  it("GET /payment/canceled → Deprecation + Sunset", async () => {
    const app = makeTestApp();
    const res = await app.request("/payment/canceled");
    expect(res.status).toBe(200);
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBe(SUNSET);
  });

  it("GET /payment/success (no session_id) → Deprecation + Sunset", async () => {
    const app = makeTestApp();
    const res = await app.request("/payment/success");
    expect(res.status).toBe(200);
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBe(SUNSET);
  });

  it("POST /api/payment/checkout → Deprecation + Sunset even on error", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/payment/checkout", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ productId: "passport-bronze" }),
    });
    expect(res.headers.get("Deprecation")).toBe("true");
    expect(res.headers.get("Sunset")).toBe(SUNSET);
  });

  it("POST /api/stripe/webhook → no deprecation headers", async () => {
    const app = makeTestApp();
    const res = await app.request("/api/stripe/webhook", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: "{}",
    });
    expect(res.headers.get("Deprecation")).toBeNull();
    expect(res.headers.get("Sunset")).toBeNull();
  });
});

describe("OpenAPI spec coverage", () => {
  it("marks legacy endpoints deprecated and lists /api/v1/* paths", async () => {
    const app = makeTestApp();
    app.route("/", paymentsApiRoutes);
    app.route("/", commerceCatalogRoutes);
    // generate the spec against the test app's route table — same handler
    // used by wireOpenApi (introspects app at call time).
    app.get(
      "/openapi.json",
      openAPIRouteHandler(app, {
        documentation: openApiConfig,
      } as Parameters<typeof openAPIRouteHandler>[1]),
    );
    const res = await app.request("/openapi.json");
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      paths: Record<string, Record<string, { deprecated?: boolean }>>;
    };
    // legacy routes marked deprecated
    expect(
      spec.paths["/api/payment/products"]?.get?.deprecated,
    ).toBe(true);
    expect(
      spec.paths["/api/payment/checkout"]?.post?.deprecated,
    ).toBe(true);
    // webhook stays current
    expect(
      spec.paths["/api/stripe/webhook"]?.post?.deprecated,
    ).toBeUndefined();
    // v1 endpoints present
    expect(spec.paths["/api/v1/payments"]?.post).toBeDefined();
    expect(spec.paths["/api/v1/catalog/products"]?.get).toBeDefined();
  });
});
