import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import { setupMockEnv } from "../e2e/helpers";
import { wireOpenApi } from "../../src/server/wiring/ops";
import { discoveryRoutes } from "../../src/server/routes/well-known/discovery";
import { aauthDiscoveryRoutes } from "../../src/server/routes/well-known/discovery-aauth";
import { buildPricingJson } from "../../src/server/lib/service-catalog/pricing-export";
import type { CatalogSources } from "../../src/server/lib/service-catalog/sources";

setupMockEnv();

const CATALOG_SOURCES: CatalogSources = {
  scan: { enabled: true, bundles: [], full_scan_usd: "4.50" },
  passport: { tiers: [] },
  marketplace: { enabled: false, passport_price_usd: null },
  keeperhub: { enabled: false, premium_price_usd: null },
  eaas: {
    enabled: false,
    verdict_usd: "0.01",
    scan_usd: "0.05",
    eval_usd: "0.10",
    tier_basic_usd: "5",
    tier_pro_usd: "25",
  },
  bstock: { enabled: false, pass_price_usd: "5", pass_days: 30 },
  venue: { enabled: false, monthly_usd: "10" },
};

// SLICE-259-40 (Grok R4 cluster-B + DeepSeek bot_auth cluster): cheap
// declaration fixes — machine-readable pricing/rate-limit keys, retry
// semantics, sandbox + limits sections, signed offer-receipt, MCP↔REST
// parity map, and honest auth-surface declarations.
describe("SLICE-259-40: declaration fixes", () => {
  it("/.well-known/mcp-rest-mapping.json serves parity map", async () => {
    const app = new Hono();
    app.route("/", discoveryRoutes);
    const res = await app.request("/.well-known/mcp-rest-mapping.json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.schema).toBe("agentbadge.mcp-rest-mapping.v1");
    expect(body.mappings.length).toBeGreaterThanOrEqual(10);
    for (const m of body.mappings) {
      expect(m.tool).toBeTruthy();
      expect(m.rest).toMatch(/^(GET|POST|PUT|DELETE) \//);
    }
  });

  it("oauth-authorization-server exposes top-level scopes + real revocation", async () => {
    const app = new Hono();
    app.route("/", aauthDiscoveryRoutes);
    const res = await app.request("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Array.isArray(body.scopes_supported)).toBe(true);
    expect(body.scopes_supported.length).toBeGreaterThanOrEqual(5);
    // The old /passport/revoke pointer was a dead URL — the real
    // revocation surface is the admin-gated route.
    expect(body.revocation_endpoint).toMatch(/\/admin\/revoke$/);
    expect(body.agent_auth.revocation_endpoint).toMatch(/\/admin\/revoke$/);
  });

  it("pricing.json carries machine-readable per-call floor + rate limit", () => {
    const p = buildPricingJson(CATALOG_SOURCES);
    expect(p.price_per_call).toBe("0.001");
    expect(p.price_unit).toBe("USDC");
    expect(p.rate_limit).toContain("60");
    // Consistency guard: price_per_call must match the cheapest priced sku.
    const cheapest = Math.min(
      ...p.services
        .filter((s) => s.price_usdc !== null)
        .map((s) => Number(s.price_usdc)),
    );
    expect(Number(p.price_per_call)).toBe(cheapest);
  });

  it("OpenAPI declares real auth schemes + x_pricing/x_rate_limit", async () => {
    const app = new Hono();
    app.get("/ping", describeRoute({ responses: { 200: { description: "ok" } } }), (c) =>
      c.json({ ok: true }),
    );
    wireOpenApi(app);
    const res = await app.request("/api/specs");
    const spec = await res.json();
    const schemes = spec.components?.securitySchemes ?? {};
    // apiKey-in-header (never query) — flips AB-129 honestly.
    const apiKeys = Object.values(schemes).filter(
      (s) => (s as { type?: string }).type === "apiKey",
    ) as { in?: string; name?: string }[];
    expect(apiKeys.length).toBeGreaterThanOrEqual(1);
    for (const s of apiKeys) {
      expect(s.in).toBe("header");
    }
    expect(spec.x_pricing?.price_per_call).toBe("0.001");
    expect(spec.x_rate_limit?.requests_per_minute).toBe("60");
  });

  it("OpenAPI register route serves requestBody + response examples", async () => {
    // Spec-level assertion: the register describeRoute embeds `example`
    // in requestBody and `example` in the 201 response media object —
    // the shape AB-148 extracts.
    const { createAgentRegisterRoutes } = await import(
      "../../src/server/routes/agents/agents-register-api"
    );
    const app = new Hono();
    app.route(
      "/",
      createAgentRegisterRoutes({
        enabled: false,
        store: {} as never,
        chainId: 5042,
        registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
        keyRpm: 120,
        dailyLimit: 50,
        cache: null,
      }),
    );
    wireOpenApi(app);
    const res = await app.request("/api/specs");
    const spec = await res.json();
    const reg = spec.paths?.["/api/v1/agents/register"]?.post;
    expect(reg).toBeTruthy();
    const rb = reg.requestBody?.content?.["application/json"];
    expect(rb?.example ?? rb?.examples).toBeTruthy();
    const ok = reg.responses?.["201"]?.content?.["application/json"];
    expect(ok?.example ?? ok?.examples).toBeTruthy();
  });
});
