/**
 * SLICE-153-3: private jobs — off-chain payload + onchain keccak commitments.
 *
 * Red suite:
 *  - create with privateDetails → onchain description = "bv:<slug>:<tag>",
 *    no plaintext leak; commitment = keccak256(canonical payload)
 *  - members see privateDetails on GET; non-members don't (field absent)
 *  - submit deliverableData → job.deliverableHash = keccak256(data)
 *  - verify-commitment true/false paths (public)
 *  - ARC_BV_MEMO_LINK → extra memo tx in create response
 *  - >256KB private payload → 400
 *  - public-venue POST ignores privateDetails (regression)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { decodeFunctionData, keccak256, toBytes } from "viem";
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
  getJob,
  resetStoreForTesting,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import { createVenue } from "../src/server/lib/venue/venues";
import { addVenueMember } from "../src/server/lib/venue/members";
import {
  buildPrivateJob,
  computeCommitment,
  getPrivateJob,
  savePrivateJob,
} from "../src/server/lib/venue/private-jobs";

const OWNER = "0x00000000000000000000000000000000000000aa";
const PROVIDER_W = "0x0000000000000000000000000000000000000bb1";
const VIEWER_W = "0x0000000000000000000000000000000000000cc1";
const STRANGER = "0x0000000000000000000000000000000000000dd1";

const SAVED_DB = process.env.DATABASE_ENABLED;
const SAVED_MEMO = process.env.ARC_BV_MEMO_LINK;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  delete process.env.ARC_BV_MEMO_LINK; // default = on
  delete process.env.ARC_BV_MAX_PRIVATE_BYTES; // no leaks from cap tests
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
  if (SAVED_DB === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB;
  if (SAVED_MEMO === undefined) delete process.env.ARC_BV_MEMO_LINK;
  else process.env.ARC_BV_MEMO_LINK = SAVED_MEMO;
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

function app(): Hono {
  const a = new Hono();
  a.route("/", createVenueApiRoutes({ network: () => testNet }));
  return a;
}

function lifecycleApp(): Hono {
  const a = new Hono();
  a.route("/", createVenueApiRoutes({
    network: () => testNet,
    onchainJob: async () => ({
      status: 1, // funded — provider may submit
      client: OWNER,
      provider: PROVIDER_W,
      evaluator: STRANGER,
    }),
  } as VenueDeps));
  return a;
}

function jobFixture(over: Partial<VenueJob> = {}): VenueJob {
  return {
    jobId: `vj_${Math.random().toString(16).slice(2)}`,
    title: "t",
    description: "d",
    budgetUsdc: 1,
    status: "open",
    client: OWNER,
    evaluator: STRANGER,
    createdAt: new Date().toISOString(),
    chainTxs: {},
    ...over,
  };
}

function makeVenue(over: Partial<Parameters<typeof createVenue>[0]> = {}) {
  return createVenue({
    name: "Biz",
    slug: `biz-${Math.random().toString(16).slice(2, 8)}`,
    kind: "business",
    ownerWallet: OWNER,
    ...over,
  });
}

/** Decode createJob calldata → arg[3] = onchain description. */
function decodeCreateDescription(data: string): string {
  const d = decodeFunctionData({ abi: ERC8183_ACP_ABI, data: data as `0x${string}` });
  const args = d.args as readonly unknown[];
  return String(args[3]);
}

// ─── Create with privateDetails (AC1) ──────────────────────────────

describe("private job create", () => {
  it("onchain description = bv:<slug>:<tag>, no private leak; commitment stored", async () => {
    const v = makeVenue();
    const a = app();
    const res = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId: v.id,
        title: "Secret audit",
        description: "public teaser",
        budgetUsdc: 10,
        privateDetails: {
          descriptionFull: "Full confidential scope — do not leak",
          terms: "Net-30 escrow",
        },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: VenueJob & { private?: boolean };
      txs: { createJob: { data: string } };
    };
    const onchainDesc = decodeCreateDescription(body.txs.createJob.data);
    expect(onchainDesc.startsWith(`bv:${v.slug}:`)).toBe(true);
    expect(onchainDesc).not.toContain("confidential");
    expect(onchainDesc.length).toBeLessThanOrEqual(128);

    const priv = getPrivateJob(body.job.jobId);
    expect(priv).toBeDefined();
    expect(priv?.descriptionFull).toContain("confidential");
    expect(priv?.terms).toBe("Net-30 escrow");
    expect(priv?.commitment).toMatch(/^0x[0-9a-f]{64}$/);
    expect(body.job.private).toBe(true);
  });

  it("commitment is deterministic — keccak256 of canonical payload", () => {
    const v = makeVenue();
    const payload = {
      jobId: "vj_x",
      venueId: v.id,
      descriptionFull: "Scope ABC",
      terms: "T&C",
    };
    const c1 = computeCommitment(payload);
    // Same content, different key order → same hash (sorted keys).
    const c2 = computeCommitment({
      terms: "T&C",
      venueId: v.id,
      jobId: "vj_x",
      descriptionFull: "Scope ABC",
    });
    expect(c1).toBe(c2);
    expect(c1).toMatch(/^0x[0-9a-f]{64}$/);
    // And differs when content differs.
    expect(computeCommitment({ ...payload, terms: "other" })).not.toBe(c1);
  });

  it("memo link tx appended when ARC_BV_MEMO_LINK unset (default on)", async () => {
    const v = makeVenue();
    const a = app();
    const res = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId: v.id, title: "T", description: "d", budgetUsdc: 5,
        privateDetails: { descriptionFull: "secret" },
      }),
    });
    const body = (await res.json()) as {
      txs: { memoLink?: { to: string; data: string } };
    };
    expect(body.txs.memoLink?.to.toLowerCase()).toBe(testNet.memo.toLowerCase());
  });

  it("memo link suppressed when ARC_BV_MEMO_LINK=0", async () => {
    process.env.ARC_BV_MEMO_LINK = "0";
    resetConfigCache();
    const v = makeVenue();
    const a = app();
    const res = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId: v.id, title: "T", description: "d", budgetUsdc: 5,
        privateDetails: { descriptionFull: "secret" },
      }),
    });
    const body = (await res.json()) as { txs: { memoLink?: unknown } };
    expect(body.txs.memoLink).toBeUndefined();
  });

  it("rejects private payload over ARC_BV_MAX_PRIVATE_BYTES", async () => {
    process.env.ARC_BV_MAX_PRIVATE_BYTES = "64";
    resetConfigCache();
    const v = makeVenue();
    const a = app();
    const res = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId: v.id, title: "T", description: "d", budgetUsdc: 5,
        privateDetails: { descriptionFull: "x".repeat(200) },
      }),
    });
    expect(res.status).toBe(400);
  });
});

// ─── Member-only private details on GET (AC2) ──────────────────────

describe("private details visibility", () => {
  it("member GET sees privateDetails; non-member on open venue does not (field absent)", async () => {
    const v = makeVenue({ clientPolicy: "open" });
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const a = app();
    const created = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId: v.id, title: "T", description: "d", budgetUsdc: 5,
        privateDetails: { descriptionFull: "inner scope", terms: "SLA" },
      }),
    });
    const { job } = (await created.json()) as { job: VenueJob };

    const memberView = await a.request(`/api/venue/jobs/${job.jobId}`, {
      headers: signedHeaders(VIEWER_W),
    });
    const mBody = (await memberView.json()) as {
      job: VenueJob & { privateDetails?: { descriptionFull?: string } };
    };
    expect(mBody.job.privateDetails?.descriptionFull).toBe("inner scope");

    const strangerView = await a.request(`/api/venue/jobs/${job.jobId}`, {
      headers: signedHeaders(STRANGER),
    });
    const sBody = (await strangerView.json()) as {
      job: VenueJob & { privateDetails?: unknown };
    };
    expect("privateDetails" in sBody.job).toBe(false);
  });
});

// ─── Submit deliverableData → hash onchain (AC3) ───────────────────

describe("submit deliverableData", () => {
  it("stores data off-chain, submits keccak256(deliverableData) onchain", async () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: PROVIDER_W, role: "provider", addedBy: OWNER });
    upsertJob(jobFixture({
      jobId: "j_priv", venueId: v.id, onchainJobId: 7,
      status: "funded", provider: PROVIDER_W, private: true,
    }));
    savePrivateJob(buildPrivateJob({
      jobId: "j_priv", venue: v, details: { descriptionFull: "scope" },
    }));
    const a = lifecycleApp();
    const res = await a.request("/api/venue/jobs/j_priv/submit", {
      method: "POST",
      headers: signedHeaders(PROVIDER_W),
      body: JSON.stringify({
        sign: "calldata",
        deliverableData: "final report bytes…",
      }),
    });
    expect(res.status).toBe(200);
    const job = getJob("j_priv");
    const expected = keccak256(toBytes("final report bytes…"));
    expect(job?.deliverableHash).toBe(expected);
    const priv = getPrivateJob("j_priv");
    expect(priv?.deliverableData).toBe("final report bytes…");
  });
});

// ─── verify-commitment (AC4) ───────────────────────────────────────

describe("verify-commitment", () => {
  it("valid payload → match:true; tampered → match:false (public route)", async () => {
    const v = makeVenue();
    const a = app();
    const created = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId: v.id, title: "T", description: "d", budgetUsdc: 5,
        privateDetails: { descriptionFull: "the real scope", terms: "T&C" },
      }),
    });
    const { job } = (await created.json()) as { job: VenueJob };
    const url = `/api/venue/instances/${v.id}/jobs/${job.jobId}/verify-commitment`;

    const good = await a.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" }, // no wallet — public
      body: JSON.stringify({
        descriptionFull: "the real scope",
        terms: "T&C",
      }),
    });
    expect((await good.json()).match).toBe(true);

    const bad = await a.request(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ descriptionFull: "tampered", terms: "T&C" }),
    });
    expect((await bad.json()).match).toBe(false);
  });
});

// ─── Public venue regression (AC6) ─────────────────────────────────

describe("public venue regression", () => {
  it("public POST /api/venue/jobs ignores privateDetails, description unchanged", async () => {
    const a = app();
    const res = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        title: "Pub", description: "public desc", budgetUsdc: 3,
        privateDetails: { descriptionFull: "ignored" },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: VenueJob & { private?: boolean };
      txs: { createJob: { data: string } };
    };
    expect(body.job.private).not.toBe(true);
    expect(decodeCreateDescription(body.txs.createJob.data))
      .toContain("public desc");
  });
});
