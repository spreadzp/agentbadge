/**
 * SLICE-153-6: client rating — subjective ERC-8004 channel.
 *
 * Suite:
 *  - POST /jobs/:id/rate → giveFeedback calldata (decode round-trip),
 *    job.rating stored, tx attach via phase "rated" (AC1)
 *  - non-client → 403; non-completed → 409; invalid score → 400;
 *    no providerAgentId → 409 (AC2)
 *  - repeat rate → 409 (AC3)
 *  - provider profile clientRating {avg,count,source:index} (AC4)
 *  - scoped route /instances/:id/jobs/:jobId/rate (AC5)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { decodeFunctionData } from "viem";
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
import {
  ERC8004_ABI,
  ERC8183_ACP_ABI,
} from "@agentbadge/circle-payments";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import {
  upsertJob,
  resetStoreForTesting,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import { createVenue, type VenueRecord } from "../src/server/lib/venue/venues";
import { getProviderProfile } from "../src/server/lib/venue/profiles";

const CLIENT = "0x00000000000000000000000000000000000000aa";
const PROVIDER = "0x0000000000000000000000000000000000000bb1";
const STRANGER = "0x0000000000000000000000000000000000000cc1";

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
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

let onchainStatus = 3; // completed
let onchainClient = CLIENT;
function app(): Hono {
  const a = new Hono();
  a.route("/", createVenueApiRoutes({
    network: () => testNet,
    onchainJob: async () => ({
      status: onchainStatus,
      client: onchainClient,
      provider: PROVIDER,
      evaluator: "0x00000000000000000000000000000000000000ee",
      budget: 5_000_000n,
      expiredAt: 0n,
    }),
  } as VenueDeps));
  return a;
}

const jobFixture = (over: Partial<VenueJob> = {}): VenueJob => ({
  jobId: `vj_rate_${Math.random().toString(36).slice(2, 8)}`,
  title: "t", description: "d", budgetUsdc: 5,
  status: "completed",
  client: CLIENT,
  provider: PROVIDER,
  evaluator: "0x00000000000000000000000000000000000000ee",
  onchainJobId: 7,
  providerAgentId: 42,
  createdAt: new Date().toISOString(),
  chainTxs: {},
  ...over,
});

const rate = (a: Hono, jobId: string, wallet: string, score = 5) =>
  a.request(`/api/venue/jobs/${jobId}/rate`, {
    method: "POST", headers: signedHeaders(wallet),
    body: JSON.stringify({ score, comment: "solid" }),
  });

describe("POST /api/venue/jobs/:id/rate", () => {
  it("client rates completed job → calldata decodes to giveFeedback (AC1)", async () => {
    onchainStatus = 3; onchainClient = CLIENT;
    const job = jobFixture({ verdict: "approved" });
    upsertJob(job);
    const res = await rate(app(), job.jobId, CLIENT, 5);
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      tx: { to: string; data: `0x${string}` };
      job: VenueJob;
    };
    expect(out.tx.to).toBe(testNet.reputationRegistry);
    const decoded = decodeFunctionData({
      abi: ERC8004_ABI,
      data: out.tx.data,
    });
    expect(decoded.functionName).toBe("giveFeedback");
    const [agentId, value, decimals, tag1, tag2, endpoint, uri, hash] =
      decoded.args as unknown[];
    expect(agentId).toBe(42n);
    expect(value).toBe(5n);
    expect(decimals).toBe(0);
    expect(tag1).toBe("venue-client-rating");
    expect(tag2).toBe("escrow-verdict"); // fixture verdict set
    expect(endpoint).toBe(`/market/jobs/${job.jobId}`);
    expect(String(uri)).toContain("data:application/json;base64,");
    expect(String(hash)).toMatch(/^0x[0-9a-fA-F]{64}$/);
    // stored — idempotency anchor
    expect(out.job.rating?.score).toBe(5);
    expect(out.job.rating?.comment).toBe("solid");
    expect(out.job.rating?.txHash).toBeUndefined();
  });

  it("attach rated tx via POST /jobs/:id/tx phase=rated", async () => {
    onchainStatus = 3; onchainClient = CLIENT;
    const job = jobFixture();
    upsertJob(job);
    const a = app();
    await rate(a, job.jobId, CLIENT);
    const txRes = await a.request(`/api/venue/jobs/${job.jobId}/tx`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        hash: "0x" + "cd".repeat(32), phase: "rated",
      }),
    });
    expect(txRes.status).toBe(200);
    const out = (await txRes.json()) as { job: VenueJob };
    expect(out.job.chainTxs.rated).toBe("0x" + "cd".repeat(32));
    expect(out.job.rating?.txHash).toBe("0x" + "cd".repeat(32));
  });

  it("non-client → 403; non-completed → 409; bad score → 400 (AC2)", async () => {
    onchainStatus = 3; onchainClient = CLIENT;
    const job = jobFixture();
    upsertJob(job);
    const a = app();
    expect((await rate(a, job.jobId, STRANGER)).status).toBe(403);

    // fresh job, onchain submitted → 409
    onchainStatus = 2;
    const job2 = jobFixture();
    upsertJob(job2);
    expect((await rate(a, job2.jobId, CLIENT)).status).toBe(409);
    onchainStatus = 3;

    // bad score
    const job3 = jobFixture();
    upsertJob(job3);
    const res = await a.request(`/api/venue/jobs/${job3.jobId}/rate`, {
      method: "POST", headers: signedHeaders(CLIENT),
      body: JSON.stringify({ score: 9 }),
    });
    expect(res.status).toBe(400);
  });

  it("no providerAgentId → 409", async () => {
    onchainStatus = 3; onchainClient = CLIENT;
    const job = jobFixture({ providerAgentId: undefined });
    upsertJob(job);
    expect((await rate(app(), job.jobId, CLIENT)).status).toBe(409);
  });

  it("repeat rate → 409 idempotency (AC3)", async () => {
    onchainStatus = 3; onchainClient = CLIENT;
    const job = jobFixture();
    upsertJob(job);
    const a = app();
    expect((await rate(a, job.jobId, CLIENT)).status).toBe(200);
    expect((await rate(a, job.jobId, CLIENT)).status).toBe(409);
  });

  it("scoped route /instances/:id/jobs/:jobId/rate (AC5)", async () => {
    onchainStatus = 3; onchainClient = CLIENT;
    const venue = createVenue({
      name: "Biz", slug: "rate-v", kind: "business",
      ownerWallet: CLIENT,
    });
    const job = jobFixture({ venueId: venue.id });
    upsertJob(job);
    const a = app();
    const res = await a.request(
      `/api/venue/instances/${venue.id}/jobs/${job.jobId}/rate`,
      {
        method: "POST", headers: signedHeaders(CLIENT),
        body: JSON.stringify({ score: 4 }),
      },
    );
    expect(res.status).toBe(200);
    // wrong venue → 404
    const other: VenueRecord = createVenue({
      name: "Other", slug: "rate-o", kind: "business",
      ownerWallet: CLIENT,
    });
    const res2 = await a.request(
      `/api/venue/instances/${other.id}/jobs/${job.jobId}/rate`,
      {
        method: "POST", headers: signedHeaders(CLIENT),
        body: JSON.stringify({ score: 4 }),
      },
    );
    expect(res2.status).toBe(404);
  });
});

describe("provider profile clientRating (AC4)", () => {
  it("aggregates avg+count over rated completed jobs, source=index", async () => {
    const a = app();
    for (const score of [5, 3]) {
      const job = jobFixture({ verdict: "approved" });
      upsertJob(job);
      onchainStatus = 3; onchainClient = CLIENT;
      await rate(a, job.jobId, CLIENT, score);
    }
    const profile = await getProviderProfile(PROVIDER, {
      network: () => testNet,
      agentLookup: async () => ({ owner: PROVIDER, metadataURI: null }),
    });
    expect(profile.stats.clientRating).toEqual({
      avg: 4, count: 2, source: "index",
    });
  });
});
