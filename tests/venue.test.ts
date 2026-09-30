/**
 * SLICE-151-9: venue hub — store, API (mocked chain), pages, ownerOf gate.
 * Chain layer is injected (VenueDeps) — no live RPC in tests.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  getJob,
  getOffer,
  listJobs,
  listOffers,
  resetStoreForTesting,
  upsertJob,
  upsertOffer,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import { createVenueApiRoutes } from "../src/server/routes/venue-api";
import { createVenuePageRoutes } from "../src/server/routes/venue-pages";
import { createVenueStore } from "../src/server/lib/attestation-store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import { configureAgentAuthForTesting, resetAgentAuthForTesting } from "../src/server/middleware/agent-auth";

const WALLET = "0x1111111111111111111111111111111111111111" as const;
const OTHER = "0x2222222222222222222222222222222222222222" as const;

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
  variant: "acp",
  abi: ERC8183_ACP_ABI,
  explorerTx: (h) => `https://testnet.arcscan.app/tx/${h}`,
  explorerAddr: (a) => `https://testnet.arcscan.app/address/${a}`,
};

function jobFixture(over: Partial<VenueJob> = {}): VenueJob {
  return {
    jobId: "vj_test1",
    title: "Scan my API",
    description: "Run readiness scan",
    budgetUsdc: 10,
    status: "pending",
    client: WALLET,
    evaluator: OTHER,
    createdAt: "2026-09-30T12:00:00.000Z",
    chainTxs: {},
    ...over,
  };
}

beforeEach(() => {
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
});
afterEach(() => {
  resetStoreForTesting();
  resetAgentAuthForTesting();
});

const signedHeaders = {
  "x-wallet": WALLET,
  "x-sig": "0xdead",
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
  "content-type": "application/json",
};

// ─── Store ───────────────────────────────────────────────────────

describe("VenueStore (JSON impl, memStore override)", () => {
  it("upserts and lists jobs newest-first with filters", () => {
    upsertJob(jobFixture({ jobId: "a", createdAt: "2026-01-01T00:00:00Z" }));
    upsertJob(
      jobFixture({
        jobId: "b",
        createdAt: "2026-02-01T00:00:00Z",
        status: "funded",
        category: "scanner",
      }),
    );
    expect(listJobs()[0].jobId).toBe("b");
    expect(listJobs({ status: "funded" }).map((j) => j.jobId)).toEqual(["b"]);
    expect(listJobs({ category: "scanner" })).toHaveLength(1);
    expect(getJob("a")?.title).toBe("Scan my API");
  });

  it("upserts offers keyed by provider address (lowercase)", () => {
    upsertOffer({
      providerAddress: WALLET,
      agentId: 7,
      name: "bstock",
      description: "market data",
      endpoint: "https://agentbadge.xyz/mcp/bstock",
      categories: ["market-data"],
      createdAt: "2026-09-30T12:00:00Z",
    });
    expect(getOffer(WALLET.toLowerCase())?.agentId).toBe(7);
    expect(listOffers()).toHaveLength(1);
  });
});

// ─── API ─────────────────────────────────────────────────────────

function apiApp(agentOwner?: (id: number) => Promise<`0x${string}` | null>) {
  const app = new Hono();
  app.route(
    "/",
    createVenueApiRoutes({
      network: () => testNet,
      onchainJob: async () => ({ status: 1 }),
      agentOwner: agentOwner ?? (async () => WALLET),
      attestations: createVenueStore(),
    }),
  );
  return app;
}

describe("venue api", () => {
  it("GET /api/venue/jobs lists with filters + network", async () => {
    upsertJob(jobFixture({ status: "open" }));
    const res = await apiApp().request("/api/venue/jobs?status=open");
    const body = (await res.json()) as { jobs: VenueJob[]; network: string };
    expect(res.status).toBe(200);
    expect(body.jobs).toHaveLength(1);
    expect(body.network).toBe("testnet");
  });

  it("POST /api/venue/jobs rejects unsigned requests", async () => {
    const res = await apiApp().request("/api/venue/jobs", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ title: "t", description: "d", budgetUsdc: 5 }),
    });
    expect(res.status).toBe(401);
  });

  it("POST /api/venue/jobs creates record + returns createJob calldata", async () => {
    const res = await apiApp().request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders,
      body: JSON.stringify({
        title: "Bounty job",
        description: "do the thing",
        budgetUsdc: 12.5,
        category: "scanner",
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: VenueJob;
      txs: { createJob: { to: string; data: string } };
    };
    expect(body.job.status).toBe("pending");
    expect(body.job.client.toLowerCase()).toBe(WALLET);
    expect(body.txs.createJob.to.toLowerCase()).toBe(
      testNet.agenticCommerce.toLowerCase(),
    );
    expect(body.txs.createJob.data.startsWith("0x")).toBe(true);
    expect(getJob(body.job.jobId)?.title).toBe("Bounty job");
  });

  it("POST /api/venue/jobs validates budget", async () => {
    const res = await apiApp().request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders,
      body: JSON.stringify({ title: "t", description: "d", budgetUsdc: -1 }),
    });
    expect(res.status).toBe(400);
  });

  it("POST /api/venue/jobs/:id/tx attaches phase tx", async () => {
    upsertJob(jobFixture());
    const hash = `0x${"a".repeat(64)}`;
    const res = await apiApp().request("/api/venue/jobs/vj_test1/tx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hash, phase: "created" }),
    });
    expect(res.status).toBe(200);
    expect(getJob("vj_test1")?.chainTxs.created).toBe(hash);
    expect(getJob("vj_test1")?.status).toBe("open");
  });

  it("GET /api/venue/jobs/:id/status syncs onchain status", async () => {
    upsertJob(jobFixture({ onchainJobId: 3, status: "open" }));
    const res = await apiApp().request("/api/venue/jobs/vj_test1/status");
    const body = (await res.json()) as { job: VenueJob };
    expect(res.status).toBe(200);
    expect(body.job.status).toBe("funded"); // mocked status 1 → funded
    expect(getJob("vj_test1")?.status).toBe("funded");
  });

  it("POST /api/venue/offers requires ownerOf match (403 on mismatch)", async () => {
    const payload = JSON.stringify({
      agentId: 7,
      name: "svc",
      description: "d",
      endpoint: "https://x.dev",
    });
    const bad = await apiApp(async () => OTHER).request("/api/venue/offers", {
      method: "POST",
      headers: signedHeaders,
      body: payload,
    });
    expect(bad.status).toBe(403);

    const good = await apiApp(async () => WALLET).request("/api/venue/offers", {
      method: "POST",
      headers: signedHeaders,
      body: payload,
    });
    expect(good.status).toBe(200);
    expect(getOffer(WALLET)?.name).toBe("svc");
  });

  it("GET /api/venue/stats returns totals", async () => {
    upsertJob(jobFixture({ status: "open", budgetUsdc: 8 }));
    const res = await apiApp().request("/api/venue/stats");
    const body = (await res.json()) as {
      jobs: number;
      jobsOpen: number;
      usdcVolume: number;
    };
    expect(body.jobs).toBe(1);
    expect(body.jobsOpen).toBe(1);
    expect(body.usdcVolume).toBe(8);
  });
});

// ─── Pages ───────────────────────────────────────────────────────

function pageApp() {
  const app = new Hono();
  app.route(
    "/",
    createVenuePageRoutes({
      network: () => testNet,
      onchainJob: async () => ({
        client: WALLET,
        provider: OTHER,
        evaluator: OTHER,
        budget: 0n,
        status: 3,
        expiredAt: 0n,
      }),
      attestations: createVenueStore(),
    }),
  );
  return app;
}

describe("venue pages", () => {
  it("GET /market renders hub with stats + tabs", async () => {
    upsertJob(jobFixture({ status: "open" }));
    const res = await pageApp().request("/market");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Agent");
    expect(html).toContain("/market/jobs");
    expect(html).toContain("/market/providers");
    expect(html).toContain("/market/attestations");
  });

  it("GET /market/jobs renders board with job card", async () => {
    upsertJob(jobFixture({ title: "BoardJob" }));
    const res = await pageApp().request("/market/jobs");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Jobs Board");
    expect(html).toContain("BoardJob");
    expect(html).toContain("/ui/venue/jobs-fragment");
  });

  it("GET /ui/venue/jobs-fragment returns card html", async () => {
    upsertJob(jobFixture());
    const res = await pageApp().request("/ui/venue/jobs-fragment");
    const html = await res.text();
    expect(res.status).toBe(200);
    expect(html).toContain("Scan my API");
  });

  it("GET /market/jobs/:id renders detail, 404 for unknown", async () => {
    upsertJob(jobFixture({ onchainJobId: 5 }));
    const ok = await pageApp().request("/market/jobs/vj_test1");
    expect(ok.status).toBe(200);
    expect(await ok.text()).toContain("Lifecycle");
    const miss = await pageApp().request("/market/jobs/nope");
    expect(miss.status).toBe(404);
  });

  it("GET /market/jobs/new + /market/providers/new render forms", async () => {
    const j = await pageApp().request("/market/jobs/new");
    expect((await j.text())).toContain("Post a Job");
    const p = await pageApp().request("/market/providers/new");
    expect((await p.text())).toContain("Register a Provider Offer");
  });

  it("GET /market/providers + /market/attestations render", async () => {
    const p = await pageApp().request("/market/providers");
    expect((await p.text())).toContain("Providers");
    const a = await pageApp().request("/market/attestations");
    expect((await a.text()).toString()).toContain("Attestations");
  });

  it("routes absent without mount (gate-off = 404)", async () => {
    const bare = new Hono();
    const res = await bare.request("/api/venue/jobs");
    expect(res.status).toBe(404);
  });
});
