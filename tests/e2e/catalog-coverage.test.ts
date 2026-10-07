/**
 * SLICE-179-5 — catalog coverage e2e + drift contract.
 *
 * Regression shield for EPIC-179:
 *  1. GATE↔SKU cross-check (D-179-7): every x402-gated endpoint has ≥1
 *     SKU with that endpoint; every paid SKU endpoint is gated here.
 *     A new paid route must be added to GATE_TABLE together with its
 *     SKU — this test is what makes CI fail when that step is skipped.
 *  2. Endpoint liveness: every SKU endpoint resolves to a real route
 *     (app.request → not 404; 402 is a valid answer for gated routes).
 *  3. Immutability: golden snapshot of sku_id values — ids are the
 *     public contract, renaming breaks agents + bazaar declarations.
 *  4. Exceptions: gates that legitimately have no SKU/bazaar slot are
 *     an explicit allowlist — the list may not grow silently.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import {
  allSkus,
  skuById,
  type CatalogSources,
  type ServiceSku,
} from "../../src/server/lib/service-catalog";
import { bazaarExtensionOf } from "../../src/server/lib/service-catalog/bazaar";
import { totalScanRoutes } from "../../src/server/routes/total-scan-api";
import { marketplaceApiRoutes } from "../../src/server/routes/marketplace-api";
import { keeperhubApiRoutes } from "../../src/server/routes/keeperhub-api";
import { passportRoutes } from "../../src/server/routes/passport";
import { createEaasRoutes } from "../../src/server/routes/eaas-api";
import { createEaasJobsRoutes } from "../../src/server/routes/eaas-jobs-api";
import { createEaasBillingRoutes } from "../../src/server/routes/eaas-billing-api";
import { registerVenueBillingRoutes } from "../../src/server/routes/venue-api-billing";
import type { PaymentMiddleware } from "../../src/server/routes/identity";

/** Deterministic fixture sources — registry assertions stay env-free. */
const SRC: CatalogSources = {
  scan: {
    enabled: true,
    bundles: [
      {
        id: "discovery-crawling",
        name: "Discovery crawling",
        description: "d",
        price_usd: "1.00",
        rule_count: 5,
      },
    ],
    full_scan_usd: "5.00",
  },
  passport: {
    tiers: [
      { tier: "bronze", price_hbar: "10" },
      { tier: "silver", price_hbar: "50" },
    ],
  },
  marketplace: { enabled: true, passport_price_usd: "10.00" },
  keeperhub: { enabled: true, premium_price_usd: "0.50" },
  eaas: {
    enabled: true,
    verdict_usd: "0.10",
    scan_usd: "0.50",
    eval_usd: "0.25",
    tier_basic_usd: "5.00",
    tier_pro_usd: "20.00",
  },
  bstock: { enabled: true, pass_price_usd: "5.00", pass_days: 30 },
  venue: { enabled: true, monthly_usd: "49.00" },
};

/**
 * Explicit gate table — every paid route in src/server/{index,wiring}.
 * `skus` = sku_ids whose endpoint covers this route.
 * Adding a new paid route = adding a row here + a SKU entry, or the
 * coverage checks below fail.
 */
const GATE_TABLE: { gate: string; method: string; path: string; skus: string[] }[] = [
  // wiring/scan-packs-x402.ts — dynamic price from bundle ids
  { gate: "scan-packs-x402", method: "POST", path: "/api/total-scan", skus: ["scan:full", "scan:discovery-crawling"] },
  // wiring/payments.ts — x402 Hedera + MPP/Stripe on passport mint
  { gate: "payments:x402", method: "POST", path: "/passport/request", skus: ["passport:bronze", "passport:silver"] },
  { gate: "payments:mpp", method: "POST", path: "/passport/request", skus: ["passport:bronze", "passport:silver"] },
  // wiring/keeperhub-x402.ts — premium variant of free scan
  { gate: "keeperhub-x402", method: "POST", path: "/api/keeperhub/scan/premium", skus: ["keeperhub:scan-premium"] },
  // wiring/marketplace-x402.ts — passport mint + service buy
  { gate: "marketplace-x402:mint", method: "POST", path: "/api/market/passport", skus: ["marketplace:passport-mint"] },
  { gate: "marketplace-x402:buy", method: "POST", path: "/api/market/buy/:serviceId", skus: ["marketplace:service-buy", "bstock:service-pass"] },
  // routes/eaas-api.ts — per-call verdicts + readiness scan
  { gate: "eaas:verdicts", method: "POST", path: "/api/eaas/verdicts", skus: ["eaas:verdict", "eaas:readiness-scan"] },
  // routes/eaas-jobs-api.ts — external job evaluation
  { gate: "eaas:jobs", method: "POST", path: "/api/eaas/jobs/evaluate", skus: ["eaas:jobs-evaluate"] },
  // routes/eaas-billing-api.ts — subscription tiers
  { gate: "eaas:subscribe", method: "POST", path: "/api/eaas/subscribe", skus: ["eaas:subscribe-basic", "eaas:subscribe-pro"] },
  // routes/venue-api-billing.ts + settle seam in index.ts
  { gate: "venue:subscribe", method: "POST", path: "/api/venue/instances/:id/subscribe", skus: ["venue:instance-subscription"] },
];

/**
 * Gates with NO SKU / no JSON bazaar slot — explicit allowlist (AC4).
 * Each entry must carry a reason; the list may only grow with a
 * documented exception, never silently.
 */
const GATE_EXCEPTIONS: { gate: string; path: string; reason: string }[] = [
  {
    gate: "l402",
    path: "/premium/*",
    reason:
      "macaroon+invoice challenge (WWW-Authenticate: L402) — no JSON extension slot; documented in l402.ts",
  },
  {
    gate: "attestation-api",
    path: "/api/attestations/*",
    reason:
      "attestation routes carry no ServiceSku — internal trust surface, not a billable product",
  },
];

const skusOf = (): ServiceSku[] => allSkus(SRC);

describe("SLICE-179-5: gate ↔ SKU cross-check", () => {
  it("every gate row has ≥1 registered SKU on that endpoint", () => {
    for (const g of GATE_TABLE) {
      for (const id of g.skus) {
        const sku = skuById(id, SRC);
        expect(sku, `${id} (${g.gate}) not registered`).toBeDefined();
        expect(sku!.endpoint.method).toBe(g.method);
        expect(sku!.endpoint.path).toBe(g.path);
      }
    }
  });

  it("every paid SKU endpoint is covered by a gate row (no orphan SKU)", () => {
    const covered = new Set(GATE_TABLE.map((g) => `${g.method} ${g.path}`));
    for (const sku of skusOf()) {
      const key = `${sku.endpoint.method} ${sku.endpoint.path}`;
      expect(
        covered.has(key),
        `SKU ${sku.sku_id} endpoint ${key} has no gate row — add it to GATE_TABLE or GATE_EXCEPTIONS`,
      ).toBe(true);
    }
  });

  it("exception list is exactly the documented L402/attestation set", () => {
    expect(GATE_EXCEPTIONS.map((e) => e.gate)).toEqual([
      "l402",
      "attestation-api",
    ]);
  });

  it("bstock freemium gate is covered by its pass SKU (buy endpoint, not feed path)", () => {
    // bstockFreemium gates /mcp/bstock/* reads, but the billable SKU is
    // the AccessPass purchase at /api/market/buy/:serviceId — covered
    // by marketplace-x402:buy row. Assert the mapping stays.
    const sku = skuById("bstock:service-pass", SRC);
    expect(sku?.endpoint.path).toBe("/api/market/buy/:serviceId");
  });
});

describe("SLICE-179-5: SKU ↔ bazaar parity (registry level)", () => {
  it("every SKU with input_schema emits schema.properties.input.body === input_schema (POST)", () => {
    for (const sku of skusOf()) {
      if (!sku.input_schema) continue;
      const ext = bazaarExtensionOf(sku);
      expect(ext, `${sku.sku_id} produced no extension`).toBeDefined();
      const schema = ext!.bazaar as {
        schema?: { properties?: { input?: { properties?: { body?: unknown } } } };
      };
      expect(schema.schema?.properties?.input?.properties?.body).toEqual(
        sku.input_schema,
      );
    }
  });
});

describe("SLICE-179-5: endpoint liveness (route exists, not 404)", () => {
  /** App mounting the real route modules — no payment middleware, so a
   *  registered-but-gated route still resolves (handler or 4xx, never 404). */
  function livenessApp(): Hono {
    const app = new Hono();
    const payStub: PaymentMiddleware = async () =>
      new Response("pay", { status: 402 });
    const payFor = () => payStub;

    app.route("/", passportRoutes);
    app.route("/api", totalScanRoutes);
    app.route("/api", keeperhubApiRoutes);
    app.route("/api", marketplaceApiRoutes);
    app.route(
      "/",
      createEaasRoutes({
        paymentForPrice: payFor,
        verdictUsd: "0.10",
        scanUsd: "0.50",
        maxBytes: 64_000,
        rateRpm: 600,
        signer: { sign: async () => "0x" } as never,
        store: { get: async () => null, put: async () => { } } as never,
      }),
    );
    app.route(
      "/",
      createEaasJobsRoutes({
        contracts: {},
        evalUsd: "0.25",
        rateRpm: 600,
        chainId: 8453,
        paymentForPrice: payFor,
      } as never),
    );
    app.route(
      "/",
      createEaasBillingRoutes({
        tierPrices: { basic: "5.00", pro: "20.00" },
        tiers: {},
        paymentForPrice: payFor,
        minter: async () => ({ ok: true }) as never,
        store: { get: async () => null } as never,
        rateRpm: 600,
      } as never),
    );
    registerVenueBillingRoutes(app);
    return app;
  }

  for (const sku of allSkus(SRC)) {
    it(`${sku.sku_id}: ${sku.endpoint.method} ${sku.endpoint.path} resolves`, async () => {
      const app = livenessApp();
      const path = sku.endpoint.path.replace(/:([a-zA-Z]+)/g, "x$1");
      const res = await app.request(path, {
        method: sku.endpoint.method,
        headers: { "content-type": "application/json" },
        body: sku.endpoint.method === "GET" ? undefined : "{}",
      });
      // Handlers may legitimately 404 on unknown :param values (unknown
      // serviceId / venue id) — what matters is the route MATCHED. Hono's
      // unmatched-route 404 is bare text "404 Not Found"; handler 404s are
      // structured JSON errors.
      const body = await res.text();
      const unmatched = res.status === 404 && body.trim() === "404 Not Found";
      expect(
        unmatched,
        `${sku.sku_id} endpoint ${sku.endpoint.path} matched no route`,
      ).toBe(false);
    });
  }
});

describe("SLICE-179-5: sku_id immutability golden", () => {
  it("sku_id list is stable (rename = breaking change for agents + bazaar)", () => {
    expect(
      skusOf()
        .map((s) => s.sku_id)
        .sort(),
    ).toEqual(
      [
        "bstock:service-pass",
        "eaas:jobs-evaluate",
        "eaas:readiness-scan",
        "eaas:subscribe-basic",
        "eaas:subscribe-pro",
        "eaas:verdict",
        "keeperhub:scan-premium",
        "marketplace:passport-mint",
        "marketplace:service-buy",
        "passport:bronze",
        "passport:silver",
        "scan:discovery-crawling",
        "scan:full",
        "venue:instance-subscription",
      ].sort(),
    );
  });
});
