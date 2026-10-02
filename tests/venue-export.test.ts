/**
 * SLICE-153-7: self-serve onboarding (trial) + audit export.
 *
 *  - business venue create → trial subscription (ARC_BV_FREE_TRIAL_DAYS,
 *    default 14), active; trial 0 → draft until subscribe (AC1)
 *  - GET /instances/:id/export — admin+ only, JSON manifest sha256
 *    self-verifying, CSV flatten, expired venue still exports (AC2/3)
 *  - GET /api/venue/stats?kind=business — business-scoped metrics (AC5)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createHash } from "node:crypto";
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
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import {
  upsertJob,
  resetStoreForTesting,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import {
  createVenue,
  updateVenue,
  type VenueRecord,
} from "../src/server/lib/venue/venues";
import { addVenueMember } from "../src/server/lib/venue/members";
import { subscriptionStatus } from "../src/server/lib/venue/billing";

const OWNER = "0x00000000000000000000000000000000000000aa";
const MEMBER = "0x0000000000000000000000000000000000000bb1";
const STRANGER = "0x0000000000000000000000000000000000000cc1";

const DAY = 86_400;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  delete process.env.ARC_BV_FREE_TRIAL_DAYS;
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
  delete process.env.ARC_BV_FREE_TRIAL_DAYS;
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
  a.route("/", createVenueApiRoutes({ network: () => testNet } as VenueDeps));
  return a;
}

function mkVenue(slug = "biz-a"): VenueRecord {
  return createVenue({
    name: "Biz A", slug, kind: "business", ownerWallet: OWNER,
  });
}

const jobFixture = (venueId: string): VenueJob => ({
  jobId: `vj_exp_${Math.random().toString(36).slice(2, 8)}`,
  title: "t", description: "d", budgetUsdc: 5,
  status: "completed",
  client: OWNER,
  provider: MEMBER,
  evaluator: "0x00000000000000000000000000000000000000ee",
  onchainJobId: 7,
  createdAt: new Date().toISOString(),
  chainTxs: { created: "0x" + "ab".repeat(32) },
  venueId,
  private: true,
});

const createViaApi = (a: Hono, slug = "biz-api") =>
  a.request("/api/venue/instances", {
    method: "POST", headers: signedHeaders(OWNER),
    body: JSON.stringify({ name: "Biz API", slug, clientPolicy: "open" }),
  });

describe("trial onboarding (AC1)", () => {
  it("createVenue business → trial subscription, active", () => {
    const v = mkVenue();
    expect(v.active).toBe(true);
    expect(v.subscription?.plan).toBe("trial");
    expect(v.subscription?.status).toBe("active");
    const now = Math.floor(Date.now() / 1000);
    expect(v.subscription!.expiresAt).toBeGreaterThanOrEqual(now + 13 * DAY);
    expect(subscriptionStatus(v)).toBe("active");
  });

  it("ARC_BV_FREE_TRIAL_DAYS=0 → draft until subscribe", () => {
    process.env.ARC_BV_FREE_TRIAL_DAYS = "0";
    const v = mkVenue("biz-draft");
    expect(v.active).toBe(false);
    expect(v.subscription).toBeUndefined();
  });

  it("POST /instances → venue + trial flag + clientPolicy", async () => {
    const res = await createViaApi(app());
    expect(res.status).toBe(201);
    const out = (await res.json()) as {
      venue: VenueRecord; trial: boolean;
    };
    expect(out.trial).toBe(true);
    expect(out.venue.clientPolicy).toBe("open");
    expect(out.venue.subscription?.plan).toBe("trial");
  });
});

describe("GET /api/venue/instances/:id/export (AC2/3)", () => {
  it("admin → JSON with sha256 manifest, verifiable", async () => {
    const v = mkVenue();
    addVenueMember(v.id, { wallet: MEMBER, role: "provider", addedBy: OWNER });
    upsertJob(jobFixture(v.id));
    const res = await app().request(
      `/api/venue/instances/${v.id}/export`,
      { headers: signedHeaders(OWNER) },
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as Record<string, unknown> & {
      manifest: { canonicalJsonSha256: string; counts: Record<string, number> };
    };
    expect(out.schema).toBe("agentbadge.venue-export.v1");
    expect(out.jobs).toHaveLength(1);
    expect((out.jobs as VenueJob[])[0].chainTxs.created)
      .toBe("0x" + "ab".repeat(32));
    expect(out.members).toHaveLength(2); // owner + provider
    expect(out.manifest.counts.jobs).toBe(1);
    // manifest is sha256 over the canonical payload (minus manifest itself)
    const { manifest, ...rest } = out;
    const canon = (x: unknown): unknown => Array.isArray(x)
      ? x.map(canon)
      : x && typeof x === "object"
        ? Object.fromEntries(Object.keys(x as object).sort()
          .map((k) => [k, canon((x as Record<string, unknown>)[k])]))
        : x;
    const sha = createHash("sha256")
      .update(JSON.stringify(canon(rest))).digest("hex");
    expect(manifest.canonicalJsonSha256).toBe(sha);
  });

  it("non-member → 403; viewer member → 403 (admin+ required)", async () => {
    const v = mkVenue("biz-b");
    addVenueMember(v.id, { wallet: MEMBER, role: "viewer", addedBy: OWNER });
    const a = app();
    expect((await a.request(`/api/venue/instances/${v.id}/export`,
      { headers: signedHeaders(STRANGER) })).status).toBe(403);
    expect((await a.request(`/api/venue/instances/${v.id}/export`,
      { headers: signedHeaders(MEMBER) })).status).toBe(403);
  });

  it("expired venue still exports (read-only)", async () => {
    const v = mkVenue("biz-c");
    updateVenue(v.id, {
      subscription: {
        status: "expired",
        expiresAt: Math.floor(Date.now() / 1000) - 10 * DAY,
      },
    });
    const res = await app().request(
      `/api/venue/instances/${v.id}/export`,
      { headers: signedHeaders(OWNER) },
    );
    expect(res.status).toBe(200);
    const out = (await res.json()) as { subscriptionStatus: string };
    expect(out.subscriptionStatus).toBe("expired");
  });

  it("format=csv → flattened sections + manifest line", async () => {
    const v = mkVenue("biz-d");
    upsertJob(jobFixture(v.id));
    const res = await app().request(
      `/api/venue/instances/${v.id}/export?format=csv`,
      { headers: signedHeaders(OWNER) },
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const csv = await res.text();
    expect(csv).toContain("# jobs");
    expect(csv).toContain("# members");
    expect(csv).toContain("# payments");
    expect(csv).toContain("# audit");
    expect(csv).toMatch(/# manifest [0-9a-f]{64}/);
    expect(csv).toContain(v.slug);
  });
});

describe("stats?kind=business (AC5)", () => {
  it("business scope — venues count, jobs, private share", async () => {
    const v = mkVenue("biz-e");
    upsertJob(jobFixture(v.id)); // business + private
    upsertJob({ ...jobFixture(v.id), venueId: "public", private: undefined });
    const res = await app().request("/api/venue/stats?kind=business");
    const out = (await res.json()) as {
      kind: string; venues: number; jobs: number; privateJobs: number;
    };
    expect(out.kind).toBe("business");
    expect(out.venues).toBe(1);
    expect(out.jobs).toBe(1);
    expect(out.privateJobs).toBe(1);
    // default stats unaffected
    const all = await app().request("/api/venue/stats");
    const allOut = (await all.json()) as { kind: string; jobs: number };
    expect(allOut.kind).toBe("all");
    expect(allOut.jobs).toBe(2);
  });
});
