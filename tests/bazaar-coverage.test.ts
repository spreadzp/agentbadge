/**
 * SLICE-179-3: bazaar-extension coverage across every 402 gate.
 *
 * Contract under test (D-179-4): the inputSchema advertised to bazaar
 * indexers is byte-identical to the SKU registry's input_schema —
 * one source of truth via inputSchemaOf → bazaarExtensionOf.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";

import {
  inputSchemaOf,
  skuById,
  type CatalogSources,
} from "../src/server/lib/service-catalog";
import {
  bazaarExtensionOf,
  bazaarExtensionFor,
} from "../src/server/lib/service-catalog/bazaar";
import { buildTotalScanPaymentOpts } from "../src/server/wiring/scan-packs-x402";
import { wireKeeperhubX402 } from "../src/server/wiring/keeperhub-x402";
import { wireMarketplace } from "../src/server/wiring/marketplace-x402";
import { mppPaymentMiddleware } from "../src/server/middleware/mpp";
import { l402PaymentMiddleware } from "../src/server/middleware/l402";
import { bstockFreemium } from "../src/server/middleware/bstock-freemium";
import { createSettleSeam } from "../src/server/lib/x402-settle-seam";
import { createEaasRoutes } from "../src/server/routes/eaas-api";
import { createEaasBillingRoutes } from "../src/server/routes/eaas-billing-api";
import { createEaasJobsRoutes } from "../src/server/routes/eaas-jobs-api";
import { resetConfigCache } from "../src/config/env";
import type {
  CirclePaymentsRuntime,
  PaymentForOpts,
} from "../src/server/lib/circle-payments";
import type { PaymentMiddleware } from "../src/server/routes/identity";
import type { EaasJobsRoutesDeps } from "../src/server/routes/eaas-jobs-api";
import type { EaasBillingDeps } from "../src/server/routes/eaas-billing-api";
import type { EaasRoutesDeps } from "../src/server/routes/eaas-api";
import type { PaymentRouter } from "@agentbadge/circle-payments";

const ADDR = (c: string) => `0x${c.repeat(40)}`;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env = { ...originalEnv };
});
afterEach(() => {
  process.env = { ...originalEnv };
  resetConfigCache();
});

/** Fixture sources — keeps registry assertions env-free (D-179-1). */
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
    tier_basic_usd: "29.00",
    tier_pro_usd: "99.00",
  },
  bstock: { enabled: true, pass_price_usd: "9.00", pass_days: 30 },
  venue: { enabled: true, monthly_usd: "49.00" },
};

/** Every SKU backed by a 402 gate (L402 + attestation are the
 *  documented exceptions — see l402.ts / attestation-api.ts). */
const GATED_SKUS = [
  "scan:full",
  "scan:discovery-crawling",
  "passport:bronze",
  "marketplace:passport-mint",
  "marketplace:service-buy",
  "keeperhub:scan-premium",
  "eaas:verdict",
  "eaas:readiness-scan",
  "eaas:jobs-evaluate",
  "eaas:subscribe-basic",
  "eaas:subscribe-pro",
  "bstock:service-pass",
  "venue:instance-subscription",
];

/** The inputSchema as emitted inside the bazaar extension envelope. */
function emittedInputSchema(ext: Record<string, unknown> | undefined) {
  const bazaar = ext?.bazaar as
    | { schema?: { properties?: { input?: { properties?: { body?: unknown } } } } }
    | undefined;
  return bazaar?.schema?.properties?.input?.properties?.body;
}

/** PaymentForOpts.extensions is Record | async-getter — we always pass
 *  the Record form, so narrow for assertions. */
function asExt(
  ext: PaymentForOpts["extensions"] | undefined,
): Record<string, unknown> | undefined {
  return typeof ext === "function" ? undefined : ext;
}

/** Spy runtime — captures (price, opts) at registration time. */
function spyRuntime() {
  const calls: { price: unknown; opts?: PaymentForOpts }[] = [];
  const stub: PaymentMiddleware = async () =>
    new Response("pay", { status: 402 });
  const runtime = {
    router: {} as never,
    paymentForPrice(price: unknown, opts?: PaymentForOpts) {
      calls.push({ price, opts });
      return stub;
    },
    paymentFor(route: string, opts?: PaymentForOpts) {
      calls.push({ price: route, opts });
      return stub;
    },
  } as unknown as CirclePaymentsRuntime;
  return { runtime, calls };
}

type PfpOpts = { extensions?: Record<string, unknown> };
function spyPaymentForPrice() {
  const calls: { price: string; opts?: PfpOpts }[] = [];
  const fn = (price: string, opts?: PfpOpts): PaymentMiddleware => {
    calls.push({ price, opts });
    return async () => new Response("pay", { status: 402 });
  };
  return { fn, calls };
}

function decode402Header(res: Response) {
  const hdr = res.headers.get("PAYMENT-REQUIRED");
  expect(hdr).toBeTruthy();
  return JSON.parse(Buffer.from(hdr!, "base64").toString());
}

describe("SLICE-179-3: SKU → bazaar extension drift contract", () => {
  for (const id of GATED_SKUS) {
    it(`${id}: extension inputSchema byte-equals inputSchemaOf(sku)`, () => {
      const sku = skuById(id, SRC);
      expect(sku, `SKU ${id} not registered`).toBeDefined();
      const schema = inputSchemaOf(sku!);
      expect(schema, `${id} missing input_schema`).toBeDefined();
      const ext = bazaarExtensionOf(sku!);
      expect(ext, `${id} produced no extension`).toBeDefined();
      expect(ext!.bazaar).toBeDefined();
      expect(emittedInputSchema(ext)).toEqual(schema);
    });
  }

  it("bazaarExtensionFor resolves by sku_id and returns undefined for unknown ids", () => {
    expect(bazaarExtensionFor("keeperhub:scan-premium", SRC)?.bazaar).toBeDefined();
    expect(bazaarExtensionFor("nope:nope", SRC)).toBeUndefined();
  });
});

describe("SLICE-179-3: gate wiring", () => {
  it("scan-packs: buildTotalScanPaymentOpts carries bazaar", () => {
    const opts = buildTotalScanPaymentOpts(ADDR("a"));
    expect(asExt(opts.extensions)?.bazaar).toBeDefined();
    expect(emittedInputSchema(asExt(opts.extensions))).toEqual(
      inputSchemaOf(skuById("scan:full")!),
    );
  });

  it("keeperhub: premium gate passes keeperhub:scan-premium extension", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_testkey";
    process.env.KEEPERHUB_X402_ENABLED = "true";
    process.env.X402_PAY_TO = ADDR("b");
    process.env.X402_PRICE = "$0.50";
    resetConfigCache();
    const { runtime, calls } = spyRuntime();
    wireKeeperhubX402(new Hono(), { runtime });
    expect(calls.length).toBe(1);
    expect(asExt(calls[0].opts?.extensions)?.bazaar).toBeDefined();
    expect(emittedInputSchema(asExt(calls[0].opts?.extensions))).toEqual(
      inputSchemaOf(skuById("keeperhub:scan-premium")!),
    );
  });

  it("marketplace: passport-mint + service-buy gates carry extensions", () => {
    process.env.MARKETPLACE_ENABLED = "true";
    process.env.MARKETPLACE_NFT = ADDR("c");
    process.env.MARKETPLACE_SPLITTER = ADDR("d");
    process.env.MARKETPLACE_TREASURY = ADDR("e");
    resetConfigCache();
    const { runtime, calls } = spyRuntime();
    wireMarketplace(new Hono(), { runtime });
    expect(calls.length).toBeGreaterThanOrEqual(2);
    const schemas = calls.map((c) => emittedInputSchema(asExt(c.opts?.extensions)));
    expect(schemas).toContainEqual(
      inputSchemaOf(skuById("marketplace:passport-mint")!),
    );
    expect(schemas).toContainEqual(
      inputSchemaOf(skuById("marketplace:service-buy")!),
    );
  });

  it("mpp: 402 body carries the passport bazaar declaration", async () => {
    const app = new Hono();
    app.get(
      "/x",
      mppPaymentMiddleware({
        secretKey: "k",
        recipientAddress: ADDR("f"),
        amount: "1000",
      }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/x");
    expect(res.status).toBe(402);
    const body = (await res.json()) as {
      extensions?: { bazaar?: { info?: unknown } };
    };
    expect(body.extensions?.bazaar?.info).toBeDefined();
  });

  it("bstock-freemium: 402 header carries extensions", async () => {
    const app = new Hono();
    app.use(
      "/feed/*",
      bstockFreemium({
        priceUsd: "1.00",
        durationSec: 0,
        payTo: ADDR("1"),
        networkId: "eip155:8453",
        usdcAddress: ADDR("2"),
        scheme: "exact",
        freePerMin: 0,
        facilitator: {} as never,
        extensions: bazaarExtensionFor("bstock:service-pass", SRC),
      }),
    );
    app.get("/feed/x", (c) => c.json({ ok: true }));
    const res = await app.request("/feed/x");
    expect(res.status).toBe(402);
    const payload = decode402Header(res);
    expect(payload.extensions.bazaar).toBeDefined();
    expect(emittedInputSchema(payload.extensions)).toEqual(
      inputSchemaOf(skuById("bstock:service-pass", SRC)!),
    );
  });
});

describe("SLICE-179-3: settle seam", () => {
  it("stamps PAYMENT-REQUIRED with extensions.bazaar", async () => {
    const headers: Record<string, string> = {};
    const ctx = {
      req: { header: () => undefined, url: "http://localhost/api/x" },
      header: (k: string, v: string) => {
        headers[k.toLowerCase()] = v;
      },
    } as unknown as Context;
    const router = {
      acceptsFor: () => [
        {
          scheme: "exact",
          network: "eip155:8453",
          asset: ADDR("3"),
          payTo: ADDR("4"),
          maxAmountRequired: "1",
          maxTimeoutSeconds: 60,
        },
      ],
      verify: vi.fn(),
      settle: vi.fn(),
    } as unknown as PaymentRouter;
    const seam = createSettleSeam({
      router,
      amountAtomic: () => "1",
      description: "test",
      extensions: bazaarExtensionFor("venue:instance-subscription", SRC),
    });
    expect(await seam(ctx)).toBeNull();
    const hdr = JSON.parse(
      Buffer.from(headers["payment-required"], "base64").toString(),
    );
    expect(hdr.extensions.bazaar).toBeDefined();
    expect(emittedInputSchema(hdr.extensions)).toEqual(
      inputSchemaOf(skuById("venue:instance-subscription", SRC)!),
    );
  });
});

describe("SLICE-179-3: EaaS gates", () => {
  it("verdicts: paymentFor(policy) carries per-SKU extensions", async () => {
    const { fn, calls } = spyPaymentForPrice();
    const app = new Hono();
    app.route(
      "/",
      createEaasRoutes({
        paymentForPrice: fn,
        verdictUsd: "0.10",
        scanUsd: "0.50",
        maxBytes: 64 * 1024,
        rateRpm: 600,
        signer: {} as never,
        store: {} as never,
      } as EaasRoutesDeps),
    );
    const post = (policy: string) =>
      app.request("/api/eaas/verdicts", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          policy,
          deliverable: { uri: "https://example.com/d" },
        }),
      });

    expect((await post("deliverable-present")).status).toBe(402);
    expect((await post("readiness-scan")).status).toBe(402);

    const verdict = calls.find((c) => c.price === "0.10");
    const scan = calls.find((c) => c.price === "0.50");
    expect(verdict).toBeDefined();
    expect(scan).toBeDefined();
    expect(emittedInputSchema(verdict!.opts?.extensions)).toEqual(
      inputSchemaOf(skuById("eaas:verdict")!),
    );
    expect(emittedInputSchema(scan!.opts?.extensions)).toEqual(
      inputSchemaOf(skuById("eaas:readiness-scan")!),
    );
  });

  it("subscribe: paymentFor(tier) carries the per-tier extension", async () => {
    const { fn, calls } = spyPaymentForPrice();
    const app = new Hono();
    app.route(
      "/",
      createEaasBillingRoutes({
        tierPrices: { basic: "29", pro: "99" },
        tiers: {} as never,
        paymentForPrice: fn,
        minter: vi.fn() as never,
        store: {
          name: "memory",
          get: () => undefined,
          put: vi.fn(),
          list: () => [],
        } as never,
        rateRpm: 600,
      } as EaasBillingDeps),
    );
    const res = await app.request("/api/eaas/subscribe", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tier: "pro" }),
    });
    expect(res.status).toBe(402);
    const pro = calls.find((c) => c.price === "99");
    expect(pro).toBeDefined();
    expect(emittedInputSchema(pro!.opts?.extensions)).toEqual(
      inputSchemaOf(skuById("eaas:subscribe-pro")!),
    );
  });

  it("jobs: legacy evalPay middleware carries eaas:jobs-evaluate", () => {
    const { fn, calls } = spyPaymentForPrice();
    createEaasJobsRoutes({
      evalUsd: "0.25",
      rateRpm: 600,
      chainId: 8453,
      paymentForPrice: fn,
      contracts: {},
    } as unknown as EaasJobsRoutesDeps);
    expect(calls.length).toBe(1);
    expect(calls[0].opts?.extensions?.bazaar).toBeDefined();
    expect(emittedInputSchema(calls[0].opts?.extensions as Record<string, unknown>)).toEqual(
      inputSchemaOf(skuById("eaas:jobs-evaluate")!),
    );
  });
});

describe("SLICE-179-3: documented exceptions", () => {
  it("l402: macaroon+invoice challenge — no JSON extension slot", async () => {
    const app = new Hono();
    app.get(
      "/x",
      l402PaymentMiddleware({ amountSats: 100, testMode: true }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/x");
    expect(res.status).toBe(402);
    expect(res.headers.get("WWW-Authenticate")).toContain("L402");
  });
});
