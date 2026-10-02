/**
 * SLICE-153-4: venue admin console + evaluator policy.
 *
 * Suite:
 *  - PATCH /instances/:id — owner changes name/policies → visible in GET
 *  - PATCH auth: viewer member → 403; delegate → 200 (AC4)
 *  - createJob pins policies.evaluator on the job (server/owner/custom)
 *  - evaluate from non-policy wallet → 403; policy wallet → 200 (AC3)
 *  - GET /admin — admin-only, stats + audit trail (AC5)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { decodeFunctionData, getAddress } from "viem";
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
  type VenueJob,
} from "../src/server/lib/venue/store";
import {
  createVenue,
  getVenue,
  listAdminAudit,
  type VenueRecord,
} from "../src/server/lib/venue/venues";
import { addVenueMember } from "../src/server/lib/venue/members";

const OWNER = "0x00000000000000000000000000000000000000aa";
const DELEGATE = "0x0000000000000000000000000000000000000dd1";
const VIEWER_W = "0x0000000000000000000000000000000000000cc1";
const STRANGER = "0x00000000000000000000000000000000000000ee";
const CUSTOM_EVAL = "0x0000000000000000000000000000000000000f0a";

const SAVED_DB = process.env.DATABASE_ENABLED;
const SAVED_KEY = process.env.ARC_EVALUATOR_KEY;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  delete process.env.ARC_EVALUATOR_KEY; // server evaluator = zero/treasury
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
  if (SAVED_KEY === undefined) delete process.env.ARC_EVALUATOR_KEY;
  else process.env.ARC_EVALUATOR_KEY = SAVED_KEY;
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

function app(evaluator = STRANGER): Hono {
  const a = new Hono();
  a.route("/", createVenueApiRoutes({
    network: () => testNet,
    onchainJob: async () => ({
      status: 2, // submitted — evaluator may complete
      client: OWNER,
      provider: "0x0000000000000000000000000000000000000bb1",
      evaluator,
    }),
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

const patch = (
  a: Hono, id: string, wallet: string, body: Record<string, unknown>,
) => a.request(`/api/venue/instances/${id}`, {
  method: "PATCH", headers: signedHeaders(wallet), body: JSON.stringify(body),
});

// ─── PATCH + audit (AC1, AC4, AC5) ───────────────────────────────

describe("PATCH /api/venue/instances/:id", () => {
  it("owner patches name + policies → visible in GET /:id", async () => {
    const v = makeVenue();
    const a = app();
    const res = await patch(a, v.id, OWNER, {
      name: "Renamed",
      clientPolicy: "open",
      policies: { evaluator: "owner", takeRateBps: 250 },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { venue: VenueRecord };
    expect(body.venue.name).toBe("Renamed");
    expect(body.venue.clientPolicy).toBe("open");
    expect(body.venue.policies?.evaluator).toBe("owner");
    // read path reflects it
    const got = getVenue(v.id);
    expect(got?.policies?.takeRateBps).toBe(250);
    // audit trail entries
    const audit = listAdminAudit(v.id);
    expect(audit.some((e) =>
      e.field === "name" && e.actor.toLowerCase() === OWNER)).toBe(true);
    expect(audit.some((e) => e.field === "policies.evaluator")).toBe(true);
  });

  it("viewer member → 403; delegate → 200 (AC4)", async () => {
    const v = makeVenue({ delegates: [DELEGATE] });
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const a = app();
    expect((await patch(a, v.id, VIEWER_W, { name: "x" })).status).toBe(403);
    expect((await patch(a, v.id, STRANGER, { name: "x" })).status).toBe(403);
    const ok = await patch(a, v.id, DELEGATE, { name: "By delegate" });
    expect(ok.status).toBe(200);
    expect(getVenue(v.id)?.name).toBe("By delegate");
    expect(listAdminAudit(v.id).at(-1)?.actor.toLowerCase()).toBe(DELEGATE);
  });

  it("invalid evaluator string → 400", async () => {
    const v = makeVenue();
    const res = await patch(app(), v.id, OWNER, {
      policies: { evaluator: "custom:notanaddress" },
    });
    expect(res.status).toBe(400);
  });
});

// ─── Delegates route ─────────────────────────────────────────────

describe("POST /api/venue/instances/:id/delegates", () => {
  it("admin adds/removes delegate wallets", async () => {
    const v = makeVenue();
    const a = app();
    const add = await a.request(`/api/venue/instances/${v.id}/delegates`, {
      method: "POST", headers: signedHeaders(OWNER),
      body: JSON.stringify({ add: DELEGATE }),
    });
    expect(add.status).toBe(200);
    expect(getVenue(v.id)?.delegates.map((d) => d.toLowerCase()))
      .toContain(DELEGATE);
    const rm = await a.request(`/api/venue/instances/${v.id}/delegates`, {
      method: "POST", headers: signedHeaders(OWNER),
      body: JSON.stringify({ remove: DELEGATE }),
    });
    expect(rm.status).toBe(200);
    expect(getVenue(v.id)?.delegates).toHaveLength(0);
  });
});

// ─── Evaluator policy on createJob (AC2) ─────────────────────────

describe("evaluator policy", () => {
  const postJob = (a: Hono, venueId: string) =>
    a.request("/api/venue/jobs", {
      method: "POST", headers: signedHeaders(OWNER),
      body: JSON.stringify({
        venueId, title: "T", description: "d", budgetUsdc: 5,
      }),
    });

  const decodeEvaluator = (data: string): string => {
    const d = decodeFunctionData({ abi: ERC8183_ACP_ABI, data: data as `0x${string}` });
    return (d.args as readonly `0x${string}`[])[1];
  };

  it("default policy → server evaluator (zero when ARC_EVALUATOR_KEY unset)", async () => {
    const v = makeVenue();
    const res = await postJob(app(), v.id);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      job: VenueJob; txs: { createJob: { data: string } };
    };
    expect(body.job.evaluator).toBe(
      "0x0000000000000000000000000000000000000000");
    expect(decodeEvaluator(body.txs.createJob.data).toLowerCase())
      .toBe("0x0000000000000000000000000000000000000000");
  });

  it("policies.evaluator=owner → job + calldata pinned to ownerWallet", async () => {
    const v = makeVenue();
    await patch(app(), v.id, OWNER, { policies: { evaluator: "owner" } });
    const res = await postJob(app(), v.id);
    const body = (await res.json()) as {
      job: VenueJob; txs: { createJob: { data: string } };
    };
    expect(body.job.evaluator.toLowerCase()).toBe(OWNER);
    expect(decodeEvaluator(body.txs.createJob.data).toLowerCase()).toBe(OWNER);
  });

  it("policies.evaluator=custom:addr → pinned to that address", async () => {
    const v = makeVenue();
    await patch(app(), v.id, OWNER, {
      policies: { evaluator: `custom:${CUSTOM_EVAL}` },
    });
    const res = await postJob(app(), v.id);
    const body = (await res.json()) as {
      job: VenueJob; txs: { createJob: { data: string } };
    };
    expect(body.job.evaluator.toLowerCase()).toBe(CUSTOM_EVAL);
    expect(decodeEvaluator(body.txs.createJob.data).toLowerCase())
      .toBe(CUSTOM_EVAL);
  });
});

// ─── Evaluate enforcement (AC3) ──────────────────────────────────

describe("evaluate gating", () => {
  it("non-policy wallet → 403; policy evaluator wallet → 200", async () => {
    const v = makeVenue();
    upsertJob({
      jobId: "j_eval", title: "t", description: "d", budgetUsdc: 1,
      status: "submitted", client: OWNER, venueId: v.id,
      onchainJobId: 9,
      evaluator: getAddress(CUSTOM_EVAL), // pinned by policy
      createdAt: new Date().toISOString(), chainTxs: {},
    });
    const a = app(CUSTOM_EVAL); // onchain evaluator = policy addr
    const bad = await a.request("/api/venue/jobs/j_eval/evaluate", {
      method: "POST", headers: signedHeaders(STRANGER),
      body: JSON.stringify({ verdict: "approve", sign: "calldata" }),
    });
    expect(bad.status).toBe(403);
    const ok = await a.request("/api/venue/jobs/j_eval/evaluate", {
      method: "POST", headers: signedHeaders(CUSTOM_EVAL),
      body: JSON.stringify({ verdict: "approve", sign: "calldata" }),
    });
    expect(ok.status).toBe(200);
  });
});

// ─── GET /admin payload (AC5) ────────────────────────────────────

describe("GET /api/venue/instances/:id/admin", () => {
  it("admin gets record + stats + audit; non-admin → 403", async () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    upsertJob({
      jobId: "j1", title: "t", description: "d", budgetUsdc: 42,
      status: "open", client: OWNER, venueId: v.id,
      evaluator: STRANGER,
      createdAt: new Date().toISOString(), chainTxs: {},
    });
    await patch(app(), v.id, OWNER, { name: "Audited" });
    const a = app();
    const res = await a.request(`/api/venue/instances/${v.id}/admin`, {
      headers: signedHeaders(OWNER),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      venue: VenueRecord;
      members: unknown[];
      stats: { jobCount: number; volumeUsdc: number; memberCount: number };
      audit: { field: string }[];
    };
    expect(body.venue.name).toBe("Audited");
    expect(body.stats.jobCount).toBe(1);
    expect(body.stats.volumeUsdc).toBe(42);
    expect(body.stats.memberCount).toBe(2); // owner + viewer
    expect(body.audit.some((e) => e.field === "name")).toBe(true);
    const denied = await a.request(`/api/venue/instances/${v.id}/admin`, {
      headers: signedHeaders(VIEWER_W),
    });
    expect(denied.status).toBe(403);
  });
});
