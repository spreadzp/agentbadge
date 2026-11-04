/**
 * GET /api/v1/services — canonical paid-services catalog
 * (EPIC-179 SLICE-179-2, rebuilt on the ServiceSku registry).
 * Locks: 200 no-auth, response shape, ?surface/?q filters (combined),
 * cache header, deprecated pointers on /pricing.json + /api/meta/fees.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { makeTestApp, setupMockEnv } from "./helpers";
import { metaRoutes } from "../../src/server/routes/meta";
import { catalogRoutes } from "../../src/server/routes/catalog";
import {
  allSkus,
  defaultSources,
} from "../../src/server/lib/service-catalog";

describe("GET /api/v1/services", () => {
  beforeEach(() => setupMockEnv());
  afterEach(() => vi.unstubAllEnvs());

  async function get(path = "/api/v1/services") {
    const app = makeTestApp();
    const res = await app.request(path);
    return { res, body: await res.json() };
  }

  it("returns 200 with registry shape", async () => {
    const { res, body } = await get();
    expect(res.status).toBe(200);
    expect(res.headers.get("cache-control")).toBe("public, max-age=300");
    expect(body.total).toBe(body.services.length);
    expect(body.total).toBe(allSkus(defaultSources()).length);
    expect(body.generated_at).toBeDefined();
    expect(body.network).toMatch(/^eip155:\d+$/);
    expect(body.links.openapi).toContain("/api/specs");
    expect(body.links.llms).toContain("/llms.txt");
    expect(body.links.agent_card).toContain("/.well-known/agent-card.json");
    expect(body.links.refusal_contract).toContain(
      "/api/meta/refusal-contract",
    );
    expect(body.free.length).toBeGreaterThan(0);
  });

  it("each service is a valid ServiceSku", async () => {
    const { body } = await get();
    for (const s of body.services) {
      expect(s.sku_id).toMatch(/^[a-z]+:[a-z0-9-]+$/);
      expect(s.endpoint.path).toMatch(/^\//);
      expect(["GET", "POST"]).toContain(s.endpoint.method);
      expect([
        "per_call",
        "per_bundle",
        "subscription",
        "dynamic",
        "free",
      ]).toContain(s.pricing);
      if (s.input_schema) {
        expect(s.input_schema.required).toBeDefined();
      }
    }
  });

  it("?surface=scan filters", async () => {
    const { res, body } = await get("/api/v1/services?surface=scan");
    expect(res.status).toBe(200);
    expect(body.total).toBeGreaterThan(0);
    for (const s of body.services) expect(s.surface).toBe("scan");
  });

  it("?surface=bogus → 400", async () => {
    const { res } = await get("/api/v1/services?surface=bogus");
    expect(res.status).toBe(400);
  });

  it("?q= substring filter", async () => {
    const { body } = await get("/api/v1/services?q=verdict");
    expect(body.total).toBeGreaterThan(0);
    for (const s of body.services) {
      const hay = `${s.name} ${s.description}`.toLowerCase();
      expect(hay).toContain("verdict");
    }
  });

  it("surface + q combine", async () => {
    const { body } = await get("/api/v1/services?surface=eaas&q=verdict");
    for (const s of body.services) {
      expect(s.surface).toBe("eaas");
      expect(`${s.name} ${s.description}`.toLowerCase()).toContain(
        "verdict",
      );
    }
  });
});

describe("machine pricing export (SLICE-206-9)", () => {
  beforeEach(() => setupMockEnv());
  afterEach(() => vi.unstubAllEnvs());

  it("/pricing.json returns flat USDC service list from the SKU registry", async () => {
    const app = new Hono();
    app.route("/", catalogRoutes);
    const res = await app.request("/pricing.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe("agentbadge.pricing.v1");
    expect(body.currency).toBe("USDC");
    expect(body.canonical).toBe("/api/v1/services");
    expect(Array.isArray(body.services)).toBe(true);
    expect(Array.isArray(body.free)).toBe(true);
    // Same source of truth: every enabled SKU appears exactly once.
    expect(body.services.length).toBe(
      allSkus(defaultSources()).filter((s) => s.enabled !== false).length,
    );
    for (const s of body.services) {
      expect(s.endpoint).toMatch(/^(GET|POST) \//);
      expect(["x402", "wallet-sig", "free"]).toContain(s.payment);
      expect(s.unit).toBeTruthy();
      expect("price_usdc" in s).toBe(true);
    }
  });

  it("/pricing.md mirrors the same services as Markdown", async () => {
    const app = new Hono();
    app.route("/", catalogRoutes);
    const res = await app.request("/pricing.md");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/markdown");
    const md = await res.text();
    expect(md).toContain("Paid services");
    expect(md).toContain("/api/v1/services");
    const jsonRes = await app.request("/pricing.json");
    const body = await jsonRes.json();
    for (const s of body.services.slice(0, 3)) {
      expect(md).toContain(s.endpoint);
    }
  });

  it("/api/meta/fees carries deprecated pointer, old fields intact", async () => {
    const app = new Hono();
    app.route("/", metaRoutes);
    const res = await app.request("/api/meta/fees");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total_count).toBeGreaterThan(0);
    expect(Array.isArray(body.fees)).toBe(true);
    expect(body.deprecated.replaced_by).toBe("/api/v1/services");
  });
});
