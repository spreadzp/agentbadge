/**
 * SLICE-179-4: free[] section + llms.txt Services bridge (MYPROJ-2521).
 *
 * AC1: free[] non-empty; GET endpoints return 2xx without auth
 *      (POST free-tier entries asserted reachable — no auth/paywall).
 * AC2: llms.txt Paid Services section is generated from the SKU
 *      registry — an injected mock SKU appears in the output.
 * AC3: next_call points at an endpoint that exists in free[].
 * AC4: llms.txt links /api/v1/services (supersedes /api/meta/fees).
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono } from "hono";
import { setupMockEnv } from "./e2e/helpers";
import { resetConfigCache } from "../src/config/env";
import { servicesCatalogRoutes } from "../src/server/routes/services-catalog";
import { opsRoutes } from "../src/server/routes/ops";
import { scanPacksApiRoutes } from "../src/server/routes/scan-packs-api";
import { marketplaceApiRoutes } from "../src/server/routes/marketplace-api";
import { keeperhubApiRoutes } from "../src/server/routes/keeperhub-api";
import {
  useMemoryStoreForTesting,
  resetMarketplaceForTesting,
} from "../src/server/lib/marketplace";
import {
  freeEntries,
  defaultSources,
  allSkus,
  type CatalogSources,
} from "../src/server/lib/service-catalog";
import {
  buildLlmsTxt,
  collectSources,
  type DiscoverySources,
} from "../src/server/lib/agent-discovery";

function mockCatalogSources(
  overrides: Partial<CatalogSources> = {},
): CatalogSources {
  return {
    scan: { enabled: true, bundles: [], full_scan_usd: "4.50" },
    passport: { tiers: [] },
    marketplace: { enabled: true, passport_price_usd: "10" },
    keeperhub: { enabled: true, premium_price_usd: "0.01" },
    eaas: {
      enabled: true,
      verdict_usd: "0.01",
      scan_usd: "0.05",
      eval_usd: "0.10",
      tier_basic_usd: "5",
      tier_pro_usd: "25",
    },
    bstock: { enabled: true, pass_price_usd: "5", pass_days: 30 },
    venue: { enabled: true, monthly_usd: "10" },
    ...overrides,
  };
}

/* ---------------------------- registry (unit) ---------------------------- */

describe("freeEntries (registry)", () => {
  it("every entry has endpoint/method/limit/note", () => {
    for (const e of freeEntries(mockCatalogSources())) {
      expect(e.endpoint).toMatch(/^\//);
      expect(["GET", "POST"]).toContain(e.method);
      expect(e.limit.length).toBeGreaterThan(0);
      expect(e.note.length).toBeGreaterThan(0);
    }
  });

  it("surface enabled flags gate entries", () => {
    const all = freeEntries(mockCatalogSources());
    expect(all.map((e) => e.endpoint)).toContain("/api/scan-packs");
    expect(all.map((e) => e.endpoint)).toContain("/api/market/services");

    const off = freeEntries(
      mockCatalogSources({
        scan: { enabled: false, bundles: [], full_scan_usd: "4.50" },
        marketplace: { enabled: false, passport_price_usd: "10" },
      }),
    );
    expect(off.map((e) => e.endpoint)).not.toContain("/api/scan-packs");
    expect(off.map((e) => e.endpoint)).not.toContain("/api/market/services");
    // health, catalog self, keeperhub free scan — always advertised
    expect(off.map((e) => e.endpoint)).toContain("/api/health");
    expect(off.map((e) => e.endpoint)).toContain("/api/keeperhub/scan");
  });
});

/* ------------------------------ e2e (AC1/AC3) ---------------------------- */

describe("GET /api/v1/services free[] + next_call", () => {
  beforeEach(() => {
    setupMockEnv();
    resetConfigCache();
    useMemoryStoreForTesting();
  });
  afterEach(() => {
    resetMarketplaceForTesting();
    vi.unstubAllEnvs();
  });

  function makeApp() {
    const app = new Hono();
    app.route("/", servicesCatalogRoutes);
    app.route("/", opsRoutes); // GET /api/health
    app.route("/api", scanPacksApiRoutes); // GET /api/scan-packs
    app.route("/api", marketplaceApiRoutes); // GET /api/market/services
    app.route("/api", keeperhubApiRoutes); // POST /api/keeperhub/scan
    return app;
  }

  it("free[] is non-empty and every GET endpoint answers 2xx without auth", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/services");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(Array.isArray(body.free)).toBe(true);
    expect(body.free.length).toBeGreaterThan(0);
    expect(body.free).toEqual(freeEntries(defaultSources()));

    for (const e of body.free as {
      endpoint: string;
      method: string;
    }[]) {
      const r =
        e.method === "GET"
          ? await app.request(e.endpoint)
          : await app.request(e.endpoint, {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({ url: "https://example.com", confirm: true }),
            });
      if (e.method === "GET") {
        // AC1: every free GET endpoint must really serve 2xx unauthenticated.
        expect(r.status, `GET ${e.endpoint}`).toBeGreaterThanOrEqual(200);
        expect(r.status, `GET ${e.endpoint}`).toBeLessThan(300);
      } else {
        // POST free-tier: reachable without auth — never 401/402/403/404
        // (execution may fail in test env; the point is no paywall).
        expect([401, 402, 403, 404]).not.toContain(r.status);
      }
    }
  });

  it("next_call points at an existing free endpoint (AC3)", async () => {
    const app = makeApp();
    const res = await app.request("/api/v1/services");
    const body = await res.json();

    expect(body.next_call).toBeDefined();
    const freePaths = (body.free as { endpoint: string; method: string }[]);
    const match = freePaths.find(
      (e) => e.endpoint === body.next_call.path && e.method === body.next_call.method,
    );
    expect(
      match,
      `next_call ${body.next_call.method} ${body.next_call.path} not in free[]`,
    ).toBeDefined();
  });
});

/* ------------------------- llms.txt bridge (AC2/AC4) --------------------- */

function mockDiscoverySources(
  overrides: Partial<DiscoverySources> = {},
): DiscoverySources {
  return {
    baseUrl: "https://agentbadge.xyz",
    authSection: "## Auth\n\nx\n",
    llmsCore: "# AgentBadge\n\n> summary\n",
    articles: [],
    faqEntries: [],
    tiers: [],
    appRoutes: [],
    skus: [],
    ...overrides,
  };
}

describe("llms.txt Services section from SKU registry", () => {
  it("AC2: section generated from skus — mock SKU appears with catalog anchor", () => {
    const txt = buildLlmsTxt(
      mockDiscoverySources({
        skus: [
          {
            id: "mock:tier",
            name: "Mock Service",
            endpoint: "/api/mock",
            priceUsd: "0.99",
            description: "drift check",
          },
        ],
      }),
    );
    expect(txt).toContain("## Paid Services");
    expect(txt).toContain(
      "https://agentbadge.xyz/api/v1/services#mock:tier",
    );
    expect(txt).toContain("$0.99");
  });

  it("empty skus → section omitted (degrade)", () => {
    expect(buildLlmsTxt(mockDiscoverySources())).not.toContain(
      "## Paid Services",
    );
  });

  it("collectSources populates skus from the registry (wiring)", () => {
    setupMockEnv();
    resetConfigCache();
    const src = collectSources();
    const ids = (src.skus ?? []).map((s) => s.id);
    expect(ids.length).toBeGreaterThan(0);
    // every advertised sku_id exists in the registry
    const registryIds = new Set(allSkus().map((s) => s.sku_id));
    for (const id of ids) expect(registryIds.has(id), id).toBe(true);
    vi.unstubAllEnvs();
  });

  it("AC4: compliance section links /api/v1/services", () => {
    const txt = buildLlmsTxt(mockDiscoverySources());
    expect(txt).toContain("- /api/v1/services —");
  });
});
