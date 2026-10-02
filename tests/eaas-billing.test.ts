/**
 * SLICE-154-5 tests: EaaS billing tiers.
 *
 * Covered:
 *  - POST /api/eaas/subscribe: 402 → settle → minter(CLASS_EAAS) +
 *    subscription row; unknown tier 400; mint failure → 502 + row kept.
 *  - GET /api/eaas/subscription: status by wallet.
 *  - Verdict quota gate: valid sig + CLASS_EAAS pass + live sub → quota
 *    path (no x402), quotaUsed++; expired/exhausted → x402 fallback;
 *    basic tier + pro-only policy → 402 upgrade hint; window reset.
 *  - CLASS_EAAS = 8 parity across TS mirrors + the Solidity source.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { mkdtempSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Wallet } from "ethers";

import { createEaasRoutes } from "../src/server/routes/eaas-api";
import { createEaasBillingRoutes } from "../src/server/routes/eaas-billing-api";
import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import {
  createMemorySubscriptionStore,
  EAAS_QUOTA_WINDOW_SEC,
  type EaasQuotaDeps,
  type EaasTierMap,
} from "../src/server/lib/eaas/subscription";
import type { MinterFn, MintRequest } from "../src/server/lib/access-pass-minter";
import { CLASS_EAAS as EAAS_MINTER } from "../src/server/lib/access-pass-minter";
import {
  CLASS_EAAS as EAAS_AUTH,
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import type { PaymentMiddleware } from "../src/server/routes/identity";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);

const WALLET = "0x00000000000000000000000000000000000000ab";
const OTHER = "0x00000000000000000000000000000000000000cd";
const PAY_TX = "0xpaytx";
const MINT_TX = "0xminttx";

const TIERS: EaasTierMap = {
  basic: { quota: 2, policies: ["deliverable-present", "hash-match"] },
  pro: { quota: 1000, policies: ["*"] },
};
const TIER_PRICES = { basic: "$5.00", pro: "$25.00" };

/* ---------------------------------- mocks --------------------------------- */

interface PayMock {
  calls: string[];
  middleware: (priceUsd: string) => PaymentMiddleware;
}

function makePayMock(): PayMock {
  const calls: string[] = [];
  return {
    calls,
    middleware: (priceUsd) => (async (c: Context, next: Next) => {
      calls.push(priceUsd);
      if (!c.req.header("payment-signature")) {
        return c.json({ error: "payment required", price: priceUsd }, 402);
      }
      c.set("payment", {
        payer: WALLET,
        transaction: PAY_TX,
        amount: "5000000",
      });
      return next();
    }) as PaymentMiddleware,
  };
}

interface MintMock {
  calls: MintRequest[];
  minter: MinterFn;
  fail?: boolean;
}

function makeMintMock(fail = false): MintMock {
  const calls: MintRequest[] = [];
  return {
    calls,
    minter: async (req) => {
      calls.push(req);
      if (fail) throw new Error("mint boom");
      return MINT_TX;
    },
  };
}

/** Valid wallet-sig headers (verifier is overridden to accept anything). */
function sigHeaders(wallet = WALLET): Record<string, string> {
  return {
    "x-wallet": wallet,
    "x-sig": "0xsig",
    "x-timestamp": String(Math.floor(Date.now() / 1000)),
  };
}

/* ---------------------------------- apps ---------------------------------- */

function mkQuotaDeps(opts?: {
  hasAccess?: (w: string, cls: number) => Promise<boolean>;
  now?: () => number;
}): EaasQuotaDeps {
  const store = createMemorySubscriptionStore();
  return {
    store,
    tiers: TIERS,
    hasAccess: opts?.hasAccess ?? (async () => true),
    ...(opts?.now ? { now: opts.now } : {}),
  };
}

function mkApp(opts?: {
  quota?: EaasQuotaDeps;
  pay?: PayMock;
  mint?: MintMock;
}) {
  const dir = mkdtempSync(join(tmpdir(), "eaas-billing-"));
  const pay = opts?.pay ?? makePayMock();
  const mint = opts?.mint ?? makeMintMock();
  const quota = opts?.quota ?? mkQuotaDeps();
  const app = new Hono();
  app.route(
    "/",
    createEaasRoutes({
      paymentForPrice: (p) => pay.middleware(p),
      verdictUsd: "$0.01",
      scanUsd: "$0.05",
      maxBytes: 1024,
      rateRpm: 60,
      signer,
      store: createJsonVerdictStore(join(dir, "v.json")),
      quota,
    }),
  );
  app.route(
    "/",
    createEaasBillingRoutes({
      tierPrices: TIER_PRICES,
      tiers: TIERS,
      paymentForPrice: (p) => pay.middleware(p),
      minter: mint.minter,
      store: quota.store,
      rateRpm: 60,
    }),
  );
  return { app, pay, mint, quota, dir };
}

const postVerdict = (
  app: Hono,
  policy = "deliverable-present",
  headers: Record<string, string> = {},
) =>
  app.request("/api/eaas/verdicts", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ policy, deliverable: { data: { a: 1 } } }),
  });

const postSubscribe = (
  app: Hono,
  tier = "basic",
  headers: Record<string, string> = {},
) =>
  app.request("/api/eaas/subscribe", {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify({ tier }),
  });

const PAID = { "payment-signature": "sig" };

let dirs: string[] = [];
function use(opts?: Parameters<typeof mkApp>[0]) {
  const made = mkApp(opts);
  dirs.push(made.dir);
  return made;
}
configureAgentAuthForTesting({ verifier: async () => true });
afterEach(() => {
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
  resetAgentAuthForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
});

/* --------------------------- subscribe endpoints -------------------------- */

describe("POST /api/eaas/subscribe", () => {
  it("402 without payment-signature; no mint, no sub row", async () => {
    const { app, pay, mint, quota } = use();
    const res = await postSubscribe(app);
    expect(res.status).toBe(402);
    expect(pay.calls).toEqual(["$5.00"]);
    expect(mint.calls).toEqual([]);
    expect(quota.store.list()).toEqual([]);
  });

  it("settled payment → mintOrExtend(CLASS_EAAS) + subscription row", async () => {
    const { app, mint, quota } = use();
    const res = await postSubscribe(app, "basic", PAID);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mintTx).toBe(MINT_TX);
    expect(body.paymentTx).toBe(PAY_TX);
    expect(mint.calls).toHaveLength(1);
    expect(mint.calls[0]!.to).toBe(WALLET);
    expect(mint.calls[0]!.classMask).toBe(8);
    expect(mint.calls[0]!.durationSec).toBeGreaterThan(0);

    const sub = quota.store.get(WALLET)!;
    expect(sub.tier).toBe("basic");
    expect(sub.quotaUsed).toBe(0);
    expect(sub.expiresAt).toBeGreaterThan(Math.floor(Date.now() / 1000));
    expect(sub.paymentTx).toBe(PAY_TX);
  });

  it("pro tier settles at $25", async () => {
    const { app, pay, quota } = use();
    const res = await postSubscribe(app, "pro", PAID);
    expect(res.status).toBe(200);
    expect(pay.calls).toEqual(["$25.00"]);
    expect(quota.store.get(WALLET)!.tier).toBe("pro");
  });

  it("unknown tier → 400 before payment", async () => {
    const { app, pay } = use();
    const res = await postSubscribe(app, "gold", PAID);
    expect(res.status).toBe(400);
    expect(pay.calls).toEqual([]);
  });

  it("mint failure → 502, subscription still recorded (payment settled)", async () => {
    const { app, quota } = use({ mint: makeMintMock(true) });
    const res = await postSubscribe(app, "basic", PAID);
    expect(res.status).toBe(502);
    const sub = quota.store.get(WALLET)!;
    expect(sub.tier).toBe("basic");
    expect(sub.paymentTx).toBe(PAY_TX);
  });
});

describe("GET /api/eaas/subscription", () => {
  it("returns status + quota fields for a subscriber", async () => {
    const { app } = use();
    await postSubscribe(app, "basic", PAID);
    const res = await app.request(`/api/eaas/subscription?wallet=${WALLET}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.subscribed).toBe(true);
    expect(body.tier).toBe("basic");
    expect(body.quota).toBe(2);
    expect(body.quotaUsed).toBe(0);
    expect(body.quotaLeft).toBe(2);
  });

  it("{subscribed:false} for unknown wallet; 400 without wallet", async () => {
    const { app } = use();
    const res = await app.request(`/api/eaas/subscription?wallet=${OTHER}`);
    expect((await res.json()).subscribed).toBe(false);
    expect((await app.request("/api/eaas/subscription")).status).toBe(400);
  });
});

/* ------------------------------ quota gating ------------------------------ */

describe("POST /api/eaas/verdicts — subscription quota gate", () => {
  it("valid pass + live sub → quota path, no x402, quotaUsed++", async () => {
    const { app, pay, quota } = use();
    await postSubscribe(app, "basic", PAID);
    pay.calls.length = 0;

    const res = await postVerdict(app, "deliverable-present", sigHeaders());
    expect(res.status).toBe(200);
    expect(pay.calls).toEqual([]); // no payment middleware call
    expect(quota.store.get(WALLET)!.quotaUsed).toBe(1);

    const body = await res.json();
    expect(body.artifact.kind).toBe("approve");
  });

  it("no sig headers → plain x402 path unchanged", async () => {
    const { app, pay } = use();
    const res = await postVerdict(app);
    expect(res.status).toBe(402);
    expect(pay.calls).toEqual(["$0.01"]);
  });

  it("valid sig but no CLASS_EAAS pass → falls back to x402", async () => {
    const quota = mkQuotaDeps({ hasAccess: async () => false });
    const { app, pay } = use({ quota });
    const res = await postVerdict(app, "deliverable-present", sigHeaders());
    expect(res.status).toBe(402);
    expect(pay.calls).toEqual(["$0.01"]);
  });

  it("expired subscription → x402 fallback", async () => {
    const quota = mkQuotaDeps();
    const { app, pay } = use({ quota });
    const now = Math.floor(Date.now() / 1000);
    quota.store.put({
      wallet: WALLET,
      tier: "basic",
      expiresAt: now - 10,
      quotaUsed: 0,
      resetAt: now + 1000,
      updatedAt: new Date().toISOString(),
    });
    const res = await postVerdict(app, "deliverable-present", sigHeaders());
    expect(res.status).toBe(402);
    expect(pay.calls).toEqual(["$0.01"]);
  });

  it("quota exhausted → x402 fallback (pay-per-call still works)", async () => {
    const quota = mkQuotaDeps();
    const { app, pay } = use({ quota });
    const now = Math.floor(Date.now() / 1000);
    quota.store.put({
      wallet: WALLET,
      tier: "basic",
      expiresAt: now + 86_400,
      quotaUsed: TIERS.basic.quota,
      resetAt: now + 1000,
      updatedAt: new Date().toISOString(),
    });
    const res = await postVerdict(app, "deliverable-present", sigHeaders());
    expect(res.status).toBe(402);
    expect(pay.calls).toEqual(["$0.01"]);
  });

  it("30d window rollover: quotaUsed resets, quota path continues", async () => {
    let now = Math.floor(Date.now() / 1000);
    const quota = mkQuotaDeps({ now: () => now });
    const { app, pay } = use({ quota });
    quota.store.put({
      wallet: WALLET,
      tier: "basic",
      expiresAt: now + 86_400 * 60,
      quotaUsed: TIERS.basic.quota,
      resetAt: now + 10,
      updatedAt: new Date().toISOString(),
    });
    now += EAAS_QUOTA_WINDOW_SEC; // window rolled over
    const res = await postVerdict(app, "deliverable-present", sigHeaders());
    expect(res.status).toBe(200);
    expect(pay.calls).toEqual([]);
    const sub = quota.store.get(WALLET)!;
    expect(sub.quotaUsed).toBe(1);
    expect(sub.resetAt).toBe(now + EAAS_QUOTA_WINDOW_SEC);
  });

  it("basic tier + readiness-scan → 402 policy_requires_pro upgrade hint", async () => {
    const { app, pay, quota } = use();
    await postSubscribe(app, "basic", PAID);
    pay.calls.length = 0;

    const res = await postVerdict(app, "readiness-scan", sigHeaders());
    expect(res.status).toBe(402);
    const body = await res.json();
    expect(body.error).toBe("policy_requires_pro");
    expect(body.upgrade).toContain("subscribe");
    expect(pay.calls).toEqual([]); // did not reach x402
    expect(quota.store.get(WALLET)!.quotaUsed).toBe(0); // not consumed
  });

  it("pro tier → readiness-scan rides quota", async () => {
    const { app, pay, quota } = use();
    await postSubscribe(app, "pro", PAID);
    pay.calls.length = 0;
    const res = await postVerdict(app, "readiness-scan", sigHeaders());
    expect(res.status).toBe(200);
    expect(pay.calls).toEqual([]);
    expect(quota.store.get(WALLET)!.quotaUsed).toBe(1);
  });

  it("invalid wallet signature → 401", async () => {
    resetAgentAuthForTesting();
    configureAgentAuthForTesting({ verifier: async () => false });
    const { app } = use();
    const res = await postVerdict(app, "deliverable-present", sigHeaders());
    expect(res.status).toBe(401);
  });
});

/* ------------------------------ const parity ------------------------------ */

describe("CLASS_EAAS parity", () => {
  it("agent-auth, access-pass-minter and AccessPassNFT.sol all use 8", () => {
    expect(EAAS_MINTER).toBe(8);
    expect(EAAS_AUTH).toBe(8);
    const sol = readFileSync(
      join(
        __dirname,
        "../../../contracts/contracts/AccessPassNFT.sol",
      ),
      "utf8",
    );
    expect(sol).toMatch(/CLASS_EAAS\s*=\s*8/);
  });
});
