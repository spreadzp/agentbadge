/**
 * SLICE-179-5 — bazaar shape validation per gate.
 *
 * For every x402 gate the emitted declaration (402-body extensions or
 * PAYMENT-REQUIRED header extensions, or the extension object passed
 * to the payment middleware) must be a valid bazaar form:
 *
 *   bazaar.info.input              — declared input (type/bodyType/body)
 *   bazaar.schema.properties.input.properties.body — JSON-schema of the
 *   body, byte-equal to inputSchemaOf(sku) (landmine: indexers reject
 *   declarations whose inputSchema lacks properties+required).
 *
 * L402 is the documented exception (macaroon challenge, no JSON slot).
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context } from "hono";
import {
  allSkus,
  inputSchemaOf,
  skuById,
  type CatalogSources,
  type ServiceSku,
} from "../../src/server/lib/service-catalog";
import {
  bazaarExtensionFor,
  bazaarExtensionOf,
} from "../../src/server/lib/service-catalog/bazaar";
import { buildTotalScanPaymentOpts } from "../../src/server/wiring/scan-packs-x402";
import { wireKeeperhubX402 } from "../../src/server/wiring/keeperhub-x402";
import { wireMarketplace } from "../../src/server/wiring/marketplace-x402";
import { mppPaymentMiddleware } from "../../src/server/middleware/mpp";
import { l402PaymentMiddleware } from "../../src/server/middleware/l402";
import { bstockFreemium } from "../../src/server/middleware/bstock-freemium";
import { createSettleSeam } from "../../src/server/lib/x402-settle-seam";
import { createEaasRoutes } from "../../src/server/routes/eaas-api";
import { createEaasBillingRoutes } from "../../src/server/routes/eaas-billing-api";
import { createEaasJobsRoutes } from "../../src/server/routes/eaas-jobs-api";
import { resetConfigCache } from "../../src/config/env";
import type {
  CirclePaymentsRuntime,
  PaymentForOpts,
} from "../../src/server/lib/circle-payments";
import type { PaymentMiddleware } from "../../src/server/routes/identity";
import type { EaasJobsRoutesDeps } from "../../src/server/routes/eaas-jobs-api";
import type { EaasBillingDeps } from "../../src/server/routes/eaas-billing-api";
import type { EaasRoutesDeps } from "../../src/server/routes/eaas-api";
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
  passport: { tiers: [{ tier: "bronze", price_hbar: "10" }] },
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

/** Emitted inputSchema inside the bazaar envelope (schema.properties.input.properties.body). */
function emittedBodySchema(ext: Record<string, unknown> | undefined) {
  const bazaar = ext?.bazaar as
    | {
      info?: { input?: unknown };
      schema?: {
        properties?: { input?: { properties?: { body?: unknown } } };
      };
    }
    | undefined;
  return {
    info: bazaar?.info,
    body: bazaar?.schema?.properties?.input?.properties?.body,
  };
}

/**
 * Bazaar shape contract: info.input present + emitted body schema has
 * `type`, `properties` and `required` (bazaar indexers reject schemas
 * missing required) and deep-equals inputSchemaOf(sku).
 */
function expectBazaarShape(
  ext: Record<string, unknown> | undefined,
  skuId: string,
  sources: CatalogSources = SRC,
): void {
  const sku = skuById(skuId, sources);
  expect(sku, `SKU ${skuId} missing`).toBeDefined();
  expect(ext, `${skuId}: no extension emitted`).toBeDefined();
  const { info, body } = emittedBodySchema(ext);
  expect(info?.input, `${skuId}: bazaar.info.input missing`).toBeDefined();
  const schema = body as {
    type?: string;
    properties?: Record<string, unknown>;
    required?: string[];
  };
  expect(schema.type, `${skuId}: inputSchema.type missing`).toBe("object");
  expect(schema.properties, `${skuId}: inputSchema.properties missing`).toBeDefined();
  expect(
    schema.required,
    `${skuId}: inputSchema.required missing (bazaar landmine)`,
  ).toBeDefined();
  expect(Array.isArray(schema.required)).toBe(true);
  expect(body).toEqual(inputSchemaOf(sku!));
}

/** Spy runtime capturing (price, opts) per registration. */
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

function asExt(
  ext: PaymentForOpts["extensions"] | undefined,
): Record<string, unknown> | undefined {
  return typeof ext === "function" ? undefined : ext;
}

function decode402Header(res: Response) {
  const hdr = res.headers.get("PAYMENT-REQUIRED");
  expect(hdr).toBeTruthy();
  return JSON.parse(Buffer.from(hdr!, "base64").toString());
}

describe("SLICE-179-5: emitted extension shape — every SKU", () => {
  it("every SKU extension is a valid bazaar form (info.input + schema.input.body)", () => {
    for (const sku of allSkus(SRC).filter((s: ServiceSku) => s.input_schema)) {
      expectBazaarShape(bazaarExtensionOf(sku) as Record<string, unknown>, sku.sku_id);
    }
  });
});

describe("SLICE-179-5: gate 402-shape", () => {
  it("scan-packs: payment opts carry a valid scan:full declaration", () => {
    const opts = buildTotalScanPaymentOpts(ADDR("a"));
    expectBazaarShape(asExt(opts.extensions), "scan:full", undefined);
  });

  it("keeperhub: gate passes a valid keeperhub:scan-premium declaration", () => {
    process.env.KEEPERHUB_ENABLED = "true";
    process.env.KEEPERHUB_API_KEY = "kh_testkey";
    process.env.KEEPERHUB_X402_ENABLED = "true";
    process.env.X402_PAY_TO = ADDR("b");
    process.env.X402_PRICE = "$0.50";
    resetConfigCache();
    const { runtime, calls } = spyRuntime();
    wireKeeperhubX402(new Hono(), { runtime });
    expect(calls.length).toBe(1);
    expectBazaarShape(asExt(calls[0].opts?.extensions), "keeperhub:scan-premium", undefined);
  });

  it("marketplace: passport-mint + service-buy declarations valid", () => {
    process.env.MARKETPLACE_ENABLED = "true";
    process.env.MARKETPLACE_NFT = ADDR("c");
    process.env.MARKETPLACE_SPLITTER = ADDR("d");
    process.env.MARKETPLACE_TREASURY = ADDR("e");
    resetConfigCache();
    const { runtime, calls } = spyRuntime();
    wireMarketplace(new Hono(), { runtime });
    const exts = calls.map((c) => asExt(c.opts?.extensions));
    const byBodySchema = (id: string) =>
      exts.find(
        (e) =>
          JSON.stringify(emittedBodySchema(e).body) ===
          JSON.stringify(inputSchemaOf(skuById(id)!)),
      );
    expectBazaarShape(
      byBodySchema("marketplace:passport-mint"),
      "marketplace:passport-mint",
      undefined,
    );
    expectBazaarShape(
      byBodySchema("marketplace:service-buy"),
      "marketplace:service-buy",
      undefined,
    );
  });

  it("mpp: 402 body extensions.bazaar parses to a valid declaration", async () => {
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
    const body = (await res.json()) as { extensions?: Record<string, unknown> };
    expectBazaarShape(body.extensions, "passport:bronze", undefined);
  });

  it("bstock-freemium: PAYMENT-REQUIRED header carries a valid declaration", async () => {
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
    expectBazaarShape(payload.extensions, "bstock:service-pass", undefined);
  });

  it("settle seam: stamped PAYMENT-REQUIRED carries a valid declaration", async () => {
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
          maxAmountRequired: "100",
        },
      ],
      matchAccepted: () => 0,
      verify: async () => ({ payer: ADDR("5") }),
      settle: async () => ({ txHash: "0xabc" }),
    } as unknown as PaymentRouter;
    const seam = createSettleSeam({
      router,
      amountAtomic: () => "100",
      description: "x",
      resourceUrl: "http://localhost/api/x",
      extensions: bazaarExtensionFor("venue:instance-subscription", SRC),
    });
    await seam(ctx);
    expect(headers["payment-required"]).toBeTruthy();
    const payload = JSON.parse(
      Buffer.from(headers["payment-required"], "base64").toString(),
    );
    expectBazaarShape(payload.extensions, "venue:instance-subscription", undefined);
  });

  it("eaas routes: per-SKU/per-tier declarations are valid", async () => {
    const pfpCalls: { price: string; opts?: { extensions?: Record<string, unknown> } }[] = [];
    const pfp = (price: string, opts?: { extensions?: Record<string, unknown> }) => {
      pfpCalls.push({ price, opts });
      const stub: PaymentMiddleware = async () => new Response("pay", { status: 402 });
      return stub;
    };
    createEaasRoutes({
      paymentForPrice: pfp,
      verdictUsd: "0.10",
      scanUsd: "0.50",
      maxBytes: 64_000,
      rateRpm: 600,
      signer: {} as never,
      store: {} as never,
    } as EaasRoutesDeps);
    createEaasJobsRoutes({
      contracts: {},
      evalUsd: "0.25",
      rateRpm: 600,
      chainId: 8453,
      paymentForPrice: pfp,
    } as EaasJobsRoutesDeps);
    const billing = createEaasBillingRoutes({
      tierPrices: { basic: "5.00", pro: "20.00" },
      tiers: {} as never,
      paymentForPrice: pfp,
      minter: async () => ({ ok: true }) as never,
      store: {} as never,
      rateRpm: 600,
    } as EaasBillingDeps);
    // Billing middleware is built lazily per-tier inside the handler —
    // fire a request so paymentFor(tier) runs and captures the extension.
    const billApp = new Hono();
    billApp.route("/", billing);
    for (const tier of ["basic", "pro"]) {
      await billApp.request("/api/eaas/subscribe", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ tier }),
      });
    }

    const find = (id: string) =>
      pfpCalls.find(
        (c) =>
          JSON.stringify(emittedBodySchema(c.opts?.extensions).body) ===
          JSON.stringify(inputSchemaOf(skuById(id)!)),
      )?.opts?.extensions;

    for (const id of [
      "eaas:verdict",
      "eaas:readiness-scan",
      "eaas:jobs-evaluate",
      "eaas:subscribe-basic",
      "eaas:subscribe-pro",
    ]) {
      expectBazaarShape(find(id), id, undefined);
    }
  });

  it("L402 exception: macaroon challenge — no JSON slot in WWW-Authenticate", async () => {
    const app = new Hono();
    app.get(
      "/x",
      l402PaymentMiddleware({ amountSats: 100, testMode: true }),
      (c) => c.json({ ok: true }),
    );
    const res = await app.request("/x");
    expect(res.status).toBe(402);
    expect(res.headers.get("WWW-Authenticate")).toContain("L402");
    // Documented exception: L402's macaroon challenge carries its own
    // invoice/l402 metadata, not an x402 bazaar declaration (no info.input).
    const body = (await res.json().catch(() => ({}))) as {
      extensions?: { bazaar?: { info?: unknown } };
    };
    expect(body.extensions?.bazaar?.info).toBeUndefined();
  });
});
