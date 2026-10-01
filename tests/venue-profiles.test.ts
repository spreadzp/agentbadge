/**
 * SLICE-152-6: provider/client profiles — aggregator unit tests,
 * reputation fallback source labels, empty profiles, routes + pages.
 */
import { beforeEach, afterEach, describe, expect, it } from "vitest";
import { Hono } from "hono";

import {
  resetStoreForTesting,
  setVenueBackendForTesting,
  upsertJob,
  upsertOffer,
  useMemoryStoreForTesting,
  type VenueJob,
  type VenueOffer,
} from "../src/server/lib/venue/store";
import {
  getClientProfile,
  getProviderProfile,
  listProviderSummaries,
  type ProviderProfileDeps,
} from "../src/server/lib/venue/profiles";
import { createVenueApiRoutes } from "../src/server/routes/venue-api";
import { createVenuePageRoutes } from "../src/server/routes/venue-pages";
import { createVenueStore } from "../src/server/lib/attestation-store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";

const PROVIDER = "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
const CLIENT = "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const EVAL = "0xcccccccccccccccccccccccccccccccccccccccc";
const NEWBIE = "0xdddddddddddddddddddddddddddddddddddddddd";

const NET = {
  name: "testnet",
  chain: { id: 999999, rpcUrl: "http://unused" },
  agenticCommerce: "0x1000000000000000000000000000000000000001",
  identityRegistry: "0x5000000000000000000000000000000000000005",
  memo: "0x2000000000000000000000000000000000000002",
  reputationRegistry: "0x3000000000000000000000000000000000000003",
  abi: ERC8183_ACP_ABI,
  variant: "acp",
  explorerTx: (h: string) => `https://scan/tx/${h}`,
  explorerAddr: (a: string) => `https://scan/address/${a}`,
} as unknown as VenueNetwork;

function jobFixture(over: Partial<VenueJob> = {}): VenueJob {
  return {
    jobId: `j_${Math.random().toString(36).slice(2, 8)}`,
    title: "job",
    description: "",
    budgetUsdc: 5,
    status: "open",
    client: CLIENT,
    evaluator: EVAL,
    createdAt: new Date().toISOString(),
    chainTxs: {},
    ...over,
  };
}

function offerFixture(over: Partial<VenueOffer> = {}): VenueOffer {
  return {
    id: `vo_${Math.random().toString(36).slice(2, 8)}`,
    providerAddress: PROVIDER,
    name: "bstock-feed",
    description: "market data",
    claimable: true,
    active: true,
    categories: ["market-data"],
    createdAt: new Date().toISOString(),
    ...over,
  };
}

const apiApp = (profiles?: ProviderProfileDeps) => {
  const app = new Hono();
  app.route("/", createVenueApiRoutes({ network: () => NET, profiles }));
  return app;
};

const pageApp = (profiles?: ProviderProfileDeps) => {
  const app = new Hono();
  app.route(
    "/",
    createVenuePageRoutes({
      network: () => NET,
      attestations: createVenueStore(),
      profiles,
    }),
  );
  return app;
};

describe("SLICE-152-6 provider profiles", () => {
  beforeEach(() => useMemoryStoreForTesting());
  afterEach(() => {
    resetStoreForTesting();
    setVenueBackendForTesting(null);
    delete process.env.ARC_VENUE_RATE_CLIENTS;
  });

  it("aggregates identity + stats + offers + recent jobs", async () => {
    upsertOffer(offerFixture({ agentId: 7 }));
    upsertJob(
      jobFixture({
        status: "completed",
        provider: PROVIDER,
        feedback: { status: "sent", txHash: "0xabc" },
      }),
    );
    upsertJob(jobFixture({ status: "funded", provider: PROVIDER }));
    upsertJob(jobFixture({ status: "open" })); // no provider — not counted

    const profile = await getProviderProfile(PROVIDER, {
      network: () => NET,
      agentLookup: async () => ({
        owner: PROVIDER as `0x${string}`,
        metadataURI: "ipfs://meta.json",
      }),
    });

    expect(profile.address).toBe(PROVIDER);
    expect(profile.agentId).toBe(7);
    expect(profile.owner).toBe(PROVIDER);
    expect(profile.metadataURI).toBe("ipfs://meta.json");
    expect(profile.stats.jobsDone).toBe(1);
    expect(profile.stats.jobsActive).toBe(1);
    expect(profile.stats.feedbackScore).toBe(1);
    expect(profile.stats.feedbackSource).toBe("index");
    expect(profile.offers).toHaveLength(1);
    expect(profile.recentJobs).toHaveLength(2);
  });

  it("reputationRead seam switches feedbackSource to onchain", async () => {
    upsertOffer(offerFixture({ agentId: 9 }));
    upsertJob(
      jobFixture({
        status: "completed",
        provider: PROVIDER,
        feedback: { status: "sent" },
      }),
    );
    const profile = await getProviderProfile(PROVIDER, {
      network: () => NET,
      agentLookup: async () => ({ owner: null, metadataURI: null }),
      reputationRead: async () => ({ score: 42, count: 3 }),
    });
    expect(profile.stats.feedbackScore).toBe(42);
    expect(profile.stats.feedbackSource).toBe("onchain");
  });

  it("reputationRead null/throw falls back to index source", async () => {
    upsertJob(
      jobFixture({
        status: "completed",
        provider: PROVIDER,
        providerAgentId: 3,
        feedback: { status: "sent" },
      }),
    );
    const profile = await getProviderProfile(PROVIDER, {
      network: () => NET,
      agentLookup: async () => ({ owner: null, metadataURI: null }),
      reputationRead: async () => {
        throw new Error("no read fn");
      },
    });
    expect(profile.agentId).toBe(3); // resolved from job.providerAgentId
    expect(profile.stats.feedbackSource).toBe("index");
    expect(profile.stats.feedbackScore).toBe(1);
  });

  it("empty profile: new address → zeros, no throw", async () => {
    const profile = await getProviderProfile(NEWBIE, {
      network: () => NET,
      agentLookup: async () => ({ owner: null, metadataURI: null }),
    });
    expect(profile.agentId).toBeUndefined();
    expect(profile.stats.jobsDone).toBe(0);
    expect(profile.stats.feedbackScore).toBe(0);
    expect(profile.offers).toEqual([]);
    expect(profile.recentJobs).toEqual([]);
  });

  it("listProviderSummaries: distinct providers from offers+jobs", () => {
    upsertOffer(offerFixture({ agentId: 5 }));
    upsertJob(jobFixture({ status: "completed", provider: PROVIDER }));
    upsertJob(jobFixture({ status: "funded", provider: NEWBIE }));
    const list = listProviderSummaries();
    expect(list).toHaveLength(2);
    const p = list.find((s) => s.address === PROVIDER.toLowerCase());
    expect(p?.agentId).toBe(5);
    expect(p?.jobsDone).toBe(1);
    expect(p?.name).toBe("bstock-feed");
    expect(p?.offersActive).toBe(1);
  });

  it("getClientProfile: posted/funded/completed + fundedRate + rated flag", () => {
    upsertJob(jobFixture({ status: "completed" }));
    upsertJob(jobFixture({ status: "funded" }));
    upsertJob(jobFixture({ status: "open" }));
    process.env.ARC_VENUE_RATE_CLIENTS = "1";
    const p = getClientProfile(CLIENT);
    expect(p.stats.jobsPosted).toBe(3);
    expect(p.stats.jobsFunded).toBe(2);
    expect(p.stats.jobsCompleted).toBe(1);
    expect(p.stats.fundedRate).toBeCloseTo(2 / 3);
    expect(p.stats.rated).toBe(true);
  });

  it("GET /api/venue/providers + /:address + /clients/:address", async () => {
    upsertOffer(offerFixture({ agentId: 11 }));
    upsertJob(jobFixture({ status: "completed", provider: PROVIDER }));
    const app = apiApp({
      network: () => NET,
      agentLookup: async () => ({
        owner: PROVIDER as `0x${string}`,
        metadataURI: null,
      }),
    });

    const list = await app.request("/api/venue/providers");
    const listBody = (await list.json()) as { providers: unknown[] };
    expect(listBody.providers).toHaveLength(1);

    const detail = await app.request(`/api/venue/providers/${PROVIDER}`);
    const dBody = (await detail.json()) as {
      agentId: number;
      owner: string;
      stats: { jobsDone: number; feedbackSource: string };
      offers: unknown[];
    };
    expect(detail.status ?? 200);
    expect(dBody.agentId).toBe(11);
    expect(dBody.owner).toBe(PROVIDER);
    expect(dBody.stats.jobsDone).toBe(1);
    expect(dBody.stats.feedbackSource).toBe("index");
    expect(dBody.offers).toHaveLength(1);

    const client = await app.request(`/api/venue/clients/${CLIENT}`);
    const cBody = (await client.json()) as { stats: { jobsPosted: number } };
    expect(cBody.stats.jobsPosted).toBe(1);

    const bad = await app.request("/api/venue/providers/0xzz");
    expect(bad.status).toBe(400);
  });

  it("/market/providers renders profile cards + detail page", async () => {
    upsertOffer(offerFixture({ agentId: 13, name: "bstock-feed" }));
    upsertJob(jobFixture({ status: "completed", provider: PROVIDER }));
    const app = pageApp({
      network: () => NET,
      agentLookup: async () => ({ owner: null, metadataURI: null }),
    });

    const list = await app.request("/market/providers");
    const html = await list.text();
    expect(list.status).toBe(200);
    expect(html).toContain("bstock-feed");
    expect(html).toContain(`href="/market/providers/${PROVIDER.toLowerCase()}"`);

    const detail = await app.request(`/market/providers/${PROVIDER}`);
    const dHtml = await detail.text();
    expect(detail.status).toBe(200);
    expect(dHtml).toContain("#13");
    expect(dHtml).toContain("jobs done");
    expect(dHtml).toContain("venue index");
  });
});
