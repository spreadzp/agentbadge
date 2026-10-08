/**
 * SLICE-171-4: payer-binding wiring on paymentForPrice surfaces —
 * keeperhub / scan-packs / marketplace / eaas + group kill-switch +
 * helper units (createArcPayerPeek, withPayerBindDecl, settle guard).
 *
 * The fake runtime's paymentForPrice mimics requirePayment's contract:
 * payment-signature → verify → onBeforeSettle → settle → next; no
 * payment → 402 with resolved `extensions` + `accepts[].extra`.
 * Ordering assertions (inspect called, verify NOT called) prove the
 * binding middleware runs before the payment gate.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { Hono, type Context, type MiddlewareHandler } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { verifyMessage } from "viem";
import { buildPayerChallenge } from "@agentbadge/circle-payments";
import {
  configurePayerBindingForTesting,
  resetPayerBindingForTesting,
  PAYER_BINDING_DECLARATION,
} from "../src/server/middleware/payer-binding";
import {
  createArcPayerPeek,
  payerBindSettleGuard,
  withPayerBindDecl,
} from "../src/server/lib/payer-binding-arc";
import { wireKeeperhubX402 } from "../src/server/wiring/keeperhub-x402";
import { wireScanPacksX402 } from "../src/server/wiring/scan-packs-x402";
import { wireMarketplace } from "../src/server/wiring/marketplace-x402";
import { wireEaas } from "../src/server/wiring/eaas";
import { resetConfigCache } from "../src/config/env";
import { resetCacheForTests } from "../src/server/lib/cache";
import type { CirclePaymentsRuntime, PaymentForOpts } from "../src/server/lib/circle-payments";
import type { PriceResolver } from "@agentbadge/circle-payments";

const PAYER_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80" as const;
const SNIPER_KEY =
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const;
const payer = privateKeyToAccount(PAYER_KEY);
const sniper = privateKeyToAccount(SNIPER_KEY);

const TX_HASH =
  "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const PAY_TO = "0x9999999999999999999999999999999999999999";
const VERDICT_KEY =
  "0x1111111111111111111111111111111111111111111111111111111111111111";

const paymentHeader = (txHash = TX_HASH) =>
  Buffer.from(JSON.stringify({ payload: { txHash } })).toString("base64");

const nowSec = () => Math.floor(Date.now() / 1000);

async function boundHeaders(
  account: typeof payer,
  path: string,
  txHash = TX_HASH,
) {
  const timestamp = nowSec();
  const signature = await account.signMessage({
    message: buildPayerChallenge({
      wallet: account.address,
      method: "POST",
      path,
      payRef: txHash,
      timestamp,
    }),
  });
  return {
    "payment-signature": paymentHeader(txHash),
    "x-wallet": account.address,
    "x-sig": signature,
    "x-timestamp": String(timestamp),
  };
}

/** Fake arc-self-settle handle — inspect reports the VICTIM's payer. */
function fakeHandle() {
  return {
    network: "eip155:5042002",
    publicClient: {} as never,
    seenTxHashes: new Set<string>(),
    inspect: vi.fn(
      async (_payload: unknown, _requirements: unknown) => ({
        ok: true as const,
        txHash: TX_HASH as `0x${string}`,
        payer: payer.address,
      }),
    ),
    verify: vi.fn(
      async (_payload: unknown, _requirements: unknown) => ({
        isValid: true,
        payer: payer.address,
      }),
    ),
    settle: vi.fn(
      async (_payload: unknown, _requirements: unknown) => ({
        success: true,
        transaction: TX_HASH,
        payer: payer.address,
      }),
    ),
  };
}
type FakeHandle = ReturnType<typeof fakeHandle>;

/** requirePayment-shaped stub honoring the hooks we assert on. */
function fakeRuntime(handle: FakeHandle): CirclePaymentsRuntime {
  return {
    arcSelfSettle: handle as never,
    paymentForPrice: (_price: PriceResolver, opts?: PaymentForOpts) => {
      const mw: MiddlewareHandler = async (c, next) => {
        const sig = c.req.header("payment-signature");
        if (!sig) {
          const ext =
            typeof opts?.extensions === "function"
              ? await opts.extensions()
              : opts?.extensions;
          const accepts = [
            {
              scheme: "eip3009-client-broadcast",
              extra: { ...(opts?.extraRequirements ?? {}) },
            },
          ];
          return c.json(
            {
              x402Version: 2,
              error: "Payment required",
              accepts,
              ...(ext ? { extensions: ext } : {}),
            },
            402,
          );
        }
        const v = await handle.verify({}, {});
        if (!v.isValid) return c.json({ error: "invalid payment" }, 402);
        const deny = await opts?.onBeforeSettle?.({
          c,
          paymentPayload: {} as never,
          requirements: {} as never,
          payer: v.payer,
        });
        if (deny instanceof Response) return deny;
        await handle.settle({}, {});
        await opts?.onSettleResult?.({
          c,
          ok: true,
          payment: { payer: payer.address },
        } as never);
        return next();
      };
      return mw as never;
    },
  } as unknown as CirclePaymentsRuntime;
}

const stubEnv = (env: Record<string, string>) => {
  for (const [k, v] of Object.entries(env)) vi.stubEnv(k, v);
  resetConfigCache();
};

const appWith = (path: string, wire: (app: Hono) => void) => {
  const app = new Hono();
  wire(app);
  app.post(path, (c) => c.json({ ok: true }));
  return app;
};

describe("SLICE-171-4: payer-binding wiring surfaces", () => {
  beforeEach(() => {
    stubEnv({
      PAYER_BIND_ENABLED: "true",
      CACHE_ENABLED: "false",
      KEEPERHUB_ENABLED: "true",
      KEEPERHUB_X402_ENABLED: "true",
      X402_PAY_TO: PAY_TO,
      SCAN_PACKS_ENABLED: "true",
      SCAN_PACK_PRICING_ENABLED: "true",
      MARKETPLACE_ENABLED: "true",
      MARKETPLACE_NFT: "0x4444444444444444444444444444444444444444",
      MARKETPLACE_SPLITTER: "0x5555555555555555555555555555555555555555",
      MARKETPLACE_TREASURY: PAY_TO,
      ARC_EAAS_ENABLED: "true",
      ARC_VERDICT_SIGNER_KEY: VERDICT_KEY,
      ARC_EAAS_MEMO_ANCHOR: "0",
      CIRCLE_SELLER_ADDRESS: PAY_TO,
    });
    resetCacheForTests();
    configurePayerBindingForTesting({
      verifier: (wallet, message, signature) =>
        verifyMessage({
          address: wallet as `0x${string}`,
          message,
          signature: signature as `0x${string}`,
        }),
    });
  });
  afterEach(() => {
    resetPayerBindingForTesting();
    vi.unstubAllEnvs();
    resetConfigCache();
    resetCacheForTests();
  });

  it("keeperhub: snipe → 403 before verify (slot intact, inspect peeked)", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/keeperhub/scan/premium", (a) =>
      wireKeeperhubX402(a, { runtime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/keeperhub/scan/premium", {
      method: "POST",
      headers: await boundHeaders(sniper, "/api/keeperhub/scan/premium"),
    });
    expect(res.status).toBe(403);
    expect(handle.inspect).toHaveBeenCalledTimes(1);
    expect(handle.verify).not.toHaveBeenCalled();
  });

  it("keeperhub: legit binding → reaches payment gate (verify runs)", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/keeperhub/scan/premium", (a) =>
      wireKeeperhubX402(a, { runtime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/keeperhub/scan/premium", {
      method: "POST",
      headers: await boundHeaders(payer, "/api/keeperhub/scan/premium"),
    });
    expect(res.status).toBe(200);
    expect(handle.verify).toHaveBeenCalledTimes(1);
  });

  it("scan-packs: snipe → 403 before verify", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/total-scan", (a) =>
      wireScanPacksX402(a, { runtime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/total-scan", {
      method: "POST",
      headers: await boundHeaders(sniper, "/api/total-scan"),
    });
    expect(res.status).toBe(403);
    expect(handle.inspect).toHaveBeenCalledTimes(1);
    expect(handle.verify).not.toHaveBeenCalled();
  });

  it("marketplace: snipe on passport mint → 403 before verify", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/market/passport", (a) =>
      wireMarketplace(a, { runtime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/market/passport", {
      method: "POST",
      headers: await boundHeaders(sniper, "/api/market/passport"),
    });
    expect(res.status).toBe(403);
    expect(handle.inspect).toHaveBeenCalledTimes(1);
    expect(handle.verify).not.toHaveBeenCalled();
  });

  it("eaas: snipe on /api/eaas/verdicts → 403 before verify", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/eaas/verdicts", (a) =>
      wireEaas(a, { circleRuntime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/eaas/verdicts", {
      method: "POST",
      headers: await boundHeaders(sniper, "/api/eaas/verdicts"),
    });
    expect(res.status).toBe(403);
    expect(handle.inspect).toHaveBeenCalledTimes(1);
    expect(handle.verify).not.toHaveBeenCalled();
  });

  it("no payment → 402 advertises payerBinding (extensions + accepts.extra)", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/keeperhub/scan/premium", (a) =>
      wireKeeperhubX402(a, { runtime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/keeperhub/scan/premium", {
      method: "POST",
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.extensions.payerBinding.required).toBe(true);
    expect(body.accepts[0].extra.payerBinding.challenge).toBe(
      "agentbadge-pay:v1",
    );
  });

  it("arc payment w/o binding headers → 402 declaration, verify untouched", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/keeperhub/scan/premium", (a) =>
      wireKeeperhubX402(a, { runtime: fakeRuntime(handle) }),
    );
    const res = await app.request("/api/keeperhub/scan/premium", {
      method: "POST",
      headers: { "payment-signature": paymentHeader() },
    });
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.payerBinding.required).toBe(true);
    expect(handle.verify).not.toHaveBeenCalled();
  });

  it("non-self-settle payload (no txHash) → binding skips, verify runs", async () => {
    const handle = fakeHandle();
    const app = appWith("/api/keeperhub/scan/premium", (a) =>
      wireKeeperhubX402(a, { runtime: fakeRuntime(handle) }),
    );
    const gatewayPayload = Buffer.from(
      JSON.stringify({ payload: { signature: "0xabc" } }),
    ).toString("base64");
    const res = await app.request("/api/keeperhub/scan/premium", {
      method: "POST",
      headers: { "payment-signature": gatewayPayload },
    });
    expect(handle.verify).toHaveBeenCalledTimes(1);
    expect(res.status).toBe(200);
  });

  it("kill-switch: PAYER_BIND_DISABLED_GROUPS=keeperhub bypasses only that group", async () => {
    vi.stubEnv("PAYER_BIND_DISABLED_GROUPS", "keeperhub");
    resetConfigCache();
    const khHandle = fakeHandle();
    const khApp = appWith("/api/keeperhub/scan/premium", (a) =>
      wireKeeperhubX402(a, { runtime: fakeRuntime(khHandle) }),
    );
    // Sniper's binding headers are ignored on keeperhub — reaches verify.
    const kh = await khApp.request("/api/keeperhub/scan/premium", {
      method: "POST",
      headers: await boundHeaders(sniper, "/api/keeperhub/scan/premium"),
    });
    expect(kh.status).toBe(200);
    expect(khHandle.verify).toHaveBeenCalledTimes(1);
    expect(khHandle.inspect).not.toHaveBeenCalled();

    // scan-packs group still enforced.
    const spHandle = fakeHandle();
    const spApp = appWith("/api/total-scan", (a) =>
      wireScanPacksX402(a, { runtime: fakeRuntime(spHandle) }),
    );
    const sp = await spApp.request("/api/total-scan", {
      method: "POST",
      headers: await boundHeaders(sniper, "/api/total-scan"),
    });
    expect(sp.status).toBe(403);
    expect(spHandle.verify).not.toHaveBeenCalled();
  });
});

describe("SLICE-171-4: helper units", () => {
  const fakeCtx = (wallet?: string) =>
    ({
      get: (k: string) => (k === "payerBindWallet" ? wallet : undefined),
      json: (b: unknown, s: number) => new Response(JSON.stringify(b), { status: s }),
    }) as unknown as Context;

  it("createArcPayerPeek: inspect(amount '0') → payer; failure → undefined", async () => {
    const handle = fakeHandle();
    const peek = createArcPayerPeek(handle as never, PAY_TO)!;
    expect(await peek(paymentHeader())).toBe(payer.address);
    const reqs = handle.inspect.mock.calls[0][1] as unknown as {
      amount: string;
      payTo: string;
    };
    expect(reqs.amount).toBe("0");
    expect(reqs.payTo).toBe(PAY_TO);
    handle.inspect.mockRejectedValueOnce(new Error("rpc down"));
    expect(await peek(paymentHeader())).toBeUndefined();
    expect(createArcPayerPeek(undefined, PAY_TO)).toBeUndefined();
  });

  it("payerBindSettleGuard: bound wallet != verified payer → 403", async () => {
    const guard = payerBindSettleGuard();
    const deny = await guard({
      c: fakeCtx(payer.address.toLowerCase()),
      paymentPayload: {} as never,
      requirements: {} as never,
      payer: sniper.address,
    });
    expect(deny).toBeInstanceOf(Response);
    expect((deny as Response).status).toBe(403);
    // match → inner runs
    const inner = vi.fn(async () => undefined);
    const ok = payerBindSettleGuard(inner as never);
    await ok({
      c: fakeCtx(payer.address.toLowerCase()),
      paymentPayload: {} as never,
      requirements: {} as never,
      payer: payer.address,
    });
    expect(inner).toHaveBeenCalledTimes(1);
    // unbound → pass
    await ok({
      c: fakeCtx(undefined),
      paymentPayload: {} as never,
      requirements: {} as never,
      payer: sniper.address,
    });
    expect(inner).toHaveBeenCalledTimes(2);
  });

  it("withPayerBindDecl: dynamic extensions + accepts.extra merge", async () => {
    vi.stubEnv("PAYER_BIND_ENABLED", "true");
    resetConfigCache();
    const base = vi.fn(async () => ({ bazaar: { sku: "x" } }));
    const wrapped = withPayerBindDecl(
      {
        extensions: base,
        extraRequirements: { paymentFlow: "upfront" },
      },
      "keeperhub",
    );
    const ext = await (wrapped.extensions as () => Promise<Record<string, unknown>>)();
    expect(ext.bazaar).toEqual({ sku: "x" });
    expect(ext.payerBinding).toEqual(PAYER_BINDING_DECLARATION);
    const extraReq = wrapped.extraRequirements as Record<string, unknown>;
    expect(extraReq.paymentFlow).toBe("upfront");
    expect(extraReq.payerBinding).toEqual(PAYER_BINDING_DECLARATION);
    vi.unstubAllEnvs();
    resetConfigCache();
  });
});
