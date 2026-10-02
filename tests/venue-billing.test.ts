/**
 * SLICE-153-5: subscription billing + per-venue take rate.
 *
 * Suite:
 *  - POST /:id/subscribe (mock x402 settle) → expiresAt extends additively
 *    from max(now, expiry); payment lands in the venue ledger (AC1)
 *  - expired venue → POST /jobs 402, reads still work (AC2)
 *  - grace window: in-flight claim works, new jobs allowed until past
 *    grace (AC3)
 *  - subscriber take rate: active → ARC_BV_SUBSCRIBER_TAKE_BPS, expired →
 *    default, policies.takeRateBps override wins (AC4)
 *  - checkVenueSubscriptions persists active→grace→expired transitions
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import {
  createVenueApiRoutes,
  type VenueDeps,
} from "../src/server/routes/venue-api";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import {
  upsertJob,
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/venue/store";
import {
  createVenue,
  getVenue,
  updateVenue,
  type VenueRecord,
} from "../src/server/lib/venue/venues";
import { addVenueMember } from "../src/server/lib/venue/members";
import {
  checkVenueSubscriptions,
  listVenuePayments,
  subscriptionStatus,
} from "../src/server/lib/venue/billing";

const OWNER = "0x00000000000000000000000000000000000000aa";
const PROVIDER_W = "0x0000000000000000000000000000000000000bb1";

const ENV_KEYS = [
  "DATABASE_ENABLED",
  "ARC_BV_MONTHLY_USD",
  "ARC_BV_SUBSCRIBER_TAKE_BPS",
  "ARC_BV_GRACE_DAYS",
  "ARC_VENUE_TAKE_BPS",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.DATABASE_ENABLED = "false";
  process.env.ARC_BV_MONTHLY_USD = "1000000"; // $1/mo for cheap math
  process.env.ARC_BV_SUBSCRIBER_TAKE_BPS = "150";
  process.env.ARC_BV_GRACE_DAYS = "3";
  process.env.ARC_VENUE_TAKE_BPS = "250";
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  resetVenueEventsForTests();
});
afterEach(() => {
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigCache();
});

const signedHeaders = (wallet: string) => ({
  "x-wallet": wallet,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
});

const testNet: VenueNetwork = {
  name: "testnet",
  chain: {
    name: "arc-testnet",
    caip2: "eip155:5042002",
    chainId: 5042002,
    usdc: "0x3600000000000000000000000000000000000000",
    usdcDecimals: 6,
    rpcUrl: "https://rpc.test",
  },
  agenticCommerce: "0x0747EEf0706327138c69792bF28Cd525089e4583",
  identityRegistry: "0x8004A818BFB912233c491871b3d84c89A494BD9e",
  reputationRegistry: "0x8004B663056A597Dffe9eCcC1965A193B7388713",
  memo: "0x5294E9927c3306DcBaDb03fe70b92e01cCede505",
  variant: "acp",
  abi: ERC8183_ACP_ABI,
  explorerTx: (h: string) => `https://testnet.arcscan.app/tx/${h}`,
  explorerAddr: (a: string) => `https://testnet.arcscan.app/address/${a}`,
} as VenueNetwork;

function app(settleAmount = "1000000", onchainStatus = 2): Hono {
  const a = new Hono();
  a.route("/", createVenueApiRoutes({
    network: () => testNet,
    onchainJob: async () => ({
      status: onchainStatus,
      client: OWNER,
      provider: "0x0000000000000000000000000000000000000000",
      evaluator: "0x00000000000000000000000000000000000000ee",
    }),
    billing: {
      subscriptionSettle: async (_c, _v) => ({
        payer: OWNER as `0x${string}`,
        amountAtomic: settleAmount,
        tx: "0x" + "ab".repeat(32),
      }),
    },
  } as VenueDeps));
  return a;
}

const makeVenue = (
  over: Partial<Parameters<typeof createVenue>[0]> = {},
): VenueRecord =>
  createVenue({
    name: "Biz", slug: `biz-${Math.random().toString(36).slice(2, 8)}`,
    kind: "business", ownerWallet: OWNER, ...over,
  });

const DAY = 86_400;
const nowSec = () => Math.floor(Date.now() / 1000);

const subscribe = (a: Hono, id: string, wallet = OWNER) =>
  a.request(`/api/venue/instances/${id}/subscribe`, {
    method: "POST", headers: signedHeaders(wallet),
    body: JSON.stringify({}),
  });

const postJob = (a: Hono, venueId: string, wallet = OWNER) =>
  a.request("/api/venue/jobs", {
    method: "POST", headers: signedHeaders(wallet),
    body: JSON.stringify({
      venueId, title: "T", description: "d", budgetUsdc: 5,
    }),
  });

// ─── Subscribe (AC1) ─────────────────────────────────────────────

describe("POST /:id/subscribe", () => {
  it("settled payment extends expiresAt ~30d, records ledger + audit", async () => {
    const v = makeVenue();
    const res = await subscribe(app(), v.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      expiresAt: number; durationSec: number;
      subscription: { status: string; lastPaymentTx?: string };
    };
    const after = getVenue(v.id);
    expect(body.subscription.status).toBe("active");
    expect(body.expiresAt).toBe(after?.subscription?.expiresAt);
    expect(body.durationSec).toBe(30 * DAY);
    expect(body.subscription.lastPaymentTx).toBe("0x" + "ab".repeat(32));
    const payments = listVenuePayments(v.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].amountAtomic).toBe("1000000");
    expect(payments[0].durationSec).toBe(30 * DAY);
  });

  it("renew is additive from max(now, expiry) — no lost paid time", async () => {
    const v = makeVenue();
    const future = nowSec() + 10 * DAY;
    updateVenue(v.id, {
      subscription: { status: "active", expiresAt: future },
    });
    const res = await subscribe(app(), v.id);
    const body = (await res.json()) as { expiresAt: number };
    expect(body.expiresAt).toBe(future + 30 * DAY);
  });

  it("no settle backend + no ARC_BV_DIRECT_SUBSCRIBE → 402", async () => {
    const v = makeVenue();
    const a = new Hono();
    a.route("/", createVenueApiRoutes({ network: () => testNet }));
    const res = await subscribe(a, v.id);
    expect(res.status).toBe(402);
  });
});

// ─── Expired venue (AC2, AC3) ────────────────────────────────────

describe("subscription enforcement", () => {
  it("expired past grace → POST /jobs 402, GET still 200 (read-only)", async () => {
    const v = makeVenue();
    updateVenue(v.id, {
      subscription: { status: "expired", expiresAt: nowSec() - 10 * DAY },
    });
    const a = app();
    const res = await postJob(a, v.id);
    expect(res.status).toBe(402);
    const read = await a.request(`/api/venue/instances/${v.id}`);
    expect(read.status).toBe(200);
    const econ = await a.request(`/api/venue/instances/${v.id}/economics`);
    expect(econ.status).toBe(200);
  });

  it("within grace → new jobs still allowed", async () => {
    const v = makeVenue();
    updateVenue(v.id, {
      subscription: { status: "grace", expiresAt: nowSec() - DAY },
    });
    const res = await postJob(app(), v.id);
    expect(res.status).toBe(200);
  });

  it("in-flight lifecycle ops never blocked — claim on expired venue works", async () => {
    const v = makeVenue();
    updateVenue(v.id, {
      subscription: { status: "expired", expiresAt: nowSec() - 10 * DAY },
    });
    addVenueMember(v.id, {
      wallet: PROVIDER_W, role: "provider", addedBy: OWNER,
    });
    upsertJob({
      jobId: "j_flight", title: "t", description: "d", budgetUsdc: 1,
      status: "open", client: OWNER, venueId: v.id, onchainJobId: 7,
      evaluator: "0x00000000000000000000000000000000000000ee",
      createdAt: new Date().toISOString(), chainTxs: {},
    });
    const a = app("1000000", 0); // onchain status open
    const res = await a.request("/api/venue/jobs/j_flight/claim", {
      method: "POST", headers: signedHeaders(PROVIDER_W),
      body: JSON.stringify({ sign: "calldata" }),
    });
    expect(res.status).toBe(200); // NOT 402 — escrow must finish
  });

  it("never-subscribed venue stays unmetered (no 402)", async () => {
    const v = makeVenue();
    const res = await postJob(app(), v.id);
    expect(res.status).toBe(200);
  });
});

// ─── Take rate (AC4) ─────────────────────────────────────────────

describe("per-venue take rate", () => {
  it("active subscriber → ARC_BV_SUBSCRIBER_TAKE_BPS (150)", async () => {
    const v = makeVenue();
    await subscribe(app(), v.id);
    const res = await app().request(`/api/venue/instances/${v.id}/economics`);
    const body = (await res.json()) as {
      takeRateBps: number; takeRateSource: string; subscriptionStatus: string;
    };
    expect(body.subscriptionStatus).toBe("active");
    expect(body.takeRateBps).toBe(150);
    expect(body.takeRateSource).toBe("subscriber");
  });

  it("expired venue falls back to default 250", async () => {
    const v = makeVenue();
    updateVenue(v.id, {
      subscription: { status: "expired", expiresAt: nowSec() - 10 * DAY },
    });
    const res = await app().request(`/api/venue/instances/${v.id}/economics`);
    const body = (await res.json()) as {
      takeRateBps: number; takeRateSource: string;
    };
    expect(body.takeRateBps).toBe(250);
    expect(body.takeRateSource).toBe("default");
  });

  it("policies.takeRateBps override wins even while subscribed", async () => {
    const v = makeVenue();
    await subscribe(app(), v.id);
    await app().request(`/api/venue/instances/${v.id}`, {
      method: "PATCH", headers: signedHeaders(OWNER),
      body: JSON.stringify({ policies: { takeRateBps: 400 } }),
    });
    const res = await app().request(`/api/venue/instances/${v.id}/economics`);
    const body = (await res.json()) as {
      takeRateBps: number; takeRateSource: string;
    };
    expect(body.takeRateBps).toBe(400);
    expect(body.takeRateSource).toBe("override");
  });
});

// ─── Sweeper ─────────────────────────────────────────────────────

describe("checkVenueSubscriptions", () => {
  it("persists active→grace→expired transitions on the stored record", async () => {
    const v = makeVenue();
    updateVenue(v.id, {
      subscription: { status: "active", expiresAt: nowSec() - DAY },
    });
    const r1 = await checkVenueSubscriptions();
    expect(r1.transitions).toHaveLength(1);
    expect(r1.transitions[0]).toMatchObject({ from: "active", to: "grace" });
    expect(getVenue(v.id)?.subscription?.status).toBe("grace");

    updateVenue(v.id, {
      subscription: {
        ...getVenue(v.id)!.subscription!, expiresAt: nowSec() - 10 * DAY,
      },
    });
    const r2 = await checkVenueSubscriptions();
    expect(r2.transitions[0]).toMatchObject({ from: "grace", to: "expired" });
    expect(getVenue(v.id)?.subscription?.status).toBe("expired");
    expect(subscriptionStatus(getVenue(v.id))).toBe("expired");
  });
});
