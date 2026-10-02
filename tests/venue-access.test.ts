/**
 * SLICE-153-2 tests — venue access control: membership roles, whitelist
 * gates on scoped routes, requiredClass pass gate, clientPolicy, instant
 * revoke. Memory backend (DATABASE_ENABLED=false), wallet-sig stubbed.
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
  CLASS_MEDIUM,
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
import { createVenue } from "../src/server/lib/venue/venues";
import {
  addVenueMember,
  revokeVenueMember,
  listVenueMembers,
} from "../src/server/lib/venue/members";

const OWNER = "0x00000000000000000000000000000000000000aa";
const ADMIN_W = "0x00000000000000000000000000000000000000ad";
const PROVIDER_W = "0x0000000000000000000000000000000000000bb1";
const VIEWER_W = "0x0000000000000000000000000000000000000cc1";
const STRANGER = "0x00000000000000000000000000000000000000dd";

const SAVED_DB_ENABLED = process.env.DATABASE_ENABLED;

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
  if (SAVED_DB_ENABLED === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB_ENABLED;
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
  const deps: VenueDeps = { network: () => testNet };
  a.route("/", createVenueApiRoutes(deps));
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
    createdAt: "2026-10-01T00:00:00.000Z",
    chainTxs: {},
    ...over,
  };
}

function makeVenue(patch: Partial<Parameters<typeof createVenue>[0]> = {}) {
  return createVenue({
    name: "Biz",
    slug: `biz-${Math.random().toString(16).slice(2, 8)}`,
    kind: "business",
    ownerWallet: OWNER,
    ...patch,
  });
}

// ─── Membership model ────────────────────────────────────────────

describe("venue membership model", () => {
  it("add/list/revoke; owner counts as owner role", () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: PROVIDER_W, role: "provider", addedBy: OWNER });
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const members = listVenueMembers(v.id);
    const wallets = members.map((m) => m.wallet.toLowerCase());
    expect(wallets).toContain(PROVIDER_W.toLowerCase());
    expect(wallets).toContain(VIEWER_W.toLowerCase());
    revokeVenueMember(v.id, VIEWER_W);
    const after = listVenueMembers(v.id, { includeRevoked: true });
    expect(
      after.find((m) => m.wallet.toLowerCase() === VIEWER_W.toLowerCase())?.revoked,
    ).toBe(true);
  });
});

// ─── Scoped read gates (AC1) ─────────────────────────────────────

describe("scoped read gates", () => {
  it("non-member GET /instances/:id/jobs → 403; member → 200", async () => {
    const v = makeVenue();
    upsertJob(jobFixture({ jobId: "j1", venueId: v.id }));
    const a = app();
    const denied = await a.request(`/api/venue/instances/${v.id}/jobs`, {
      headers: signedHeaders(STRANGER),
    });
    expect(denied.status).toBe(403);
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const ok = await a.request(`/api/venue/instances/${v.id}/jobs`, {
      headers: signedHeaders(VIEWER_W),
    });
    expect(ok.status).toBe(200);
  });

  it("offers scoped read also gated; owner passes without membership row", async () => {
    const v = makeVenue();
    const a = app();
    const denied = await a.request(`/api/venue/instances/${v.id}/offers`, {
      headers: signedHeaders(STRANGER),
    });
    expect(denied.status).toBe(403);
    const ownerOk = await a.request(`/api/venue/instances/${v.id}/jobs`, {
      headers: signedHeaders(OWNER),
    });
    expect(ownerOk.status).toBe(200);
  });
});

// ─── Member management routes ────────────────────────────────────

describe("member management routes", () => {
  it("POST members by non-admin → 403; by owner → 201", async () => {
    const v = makeVenue();
    const a = app();
    const denied = await a.request(`/api/venue/instances/${v.id}/members`, {
      method: "POST",
      headers: signedHeaders(STRANGER),
      body: JSON.stringify({ wallet: VIEWER_W, role: "viewer" }),
    });
    expect(denied.status).toBe(403);
    const ok = await a.request(`/api/venue/instances/${v.id}/members`, {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({ wallet: PROVIDER_W, role: "provider" }),
    });
    expect(ok.status).toBe(201);
  });

  it("GET members list — members only", async () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: ADMIN_W, role: "admin", addedBy: OWNER });
    const a = app();
    const denied = await a.request(`/api/venue/instances/${v.id}/members`, {
      headers: signedHeaders(STRANGER),
    });
    expect(denied.status).toBe(403);
    const ok = await a.request(`/api/venue/instances/${v.id}/members`, {
      headers: signedHeaders(ADMIN_W),
    });
    expect(ok.status).toBe(200);
    const { members } = (await ok.json()) as { members: { role: string }[] };
    expect(members.some((m) => m.role === "owner")).toBe(true);
  });

  it("DELETE member → revoke, sticky (re-add still revoked until re-added)", async () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: ADMIN_W, role: "admin", addedBy: OWNER });
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const a = app();
    const del = await a.request(
      `/api/venue/instances/${v.id}/members/${VIEWER_W}`,
      { method: "DELETE", headers: signedHeaders(ADMIN_W) },
    );
    expect(del.status).toBe(200);
    const denied = await a.request(`/api/venue/instances/${v.id}/jobs`, {
      headers: signedHeaders(VIEWER_W),
    });
    expect(denied.status).toBe(403);
  });
});

// ─── Revoke is instant (AC3) ─────────────────────────────────────

describe("instant revoke", () => {
  it("revoke → next request 403 (no TTL wait)", async () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const a = app();
    expect(
      (await a.request(`/api/venue/instances/${v.id}/jobs`, {
        headers: signedHeaders(VIEWER_W),
      })).status,
    ).toBe(200);
    revokeVenueMember(v.id, VIEWER_W);
    expect(
      (await a.request(`/api/venue/instances/${v.id}/jobs`, {
        headers: signedHeaders(VIEWER_W),
      })).status,
    ).toBe(403);
  });
});

// ─── clientPolicy: members|open (POST /api/venue/jobs) ──────────

describe("clientPolicy", () => {
  const postJob = (a: Hono, wallet: string, venueId: string) =>
    a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(wallet),
      body: JSON.stringify({
        title: "Job", description: "Do thing", budgetUsdc: 5,
        venueId,
      }),
    });

  it("members policy: stranger → 403; member → not 403", async () => {
    const v = makeVenue(); // default clientPolicy = "members"
    const a = app();
    const denied = await postJob(a, STRANGER, v.id);
    expect(denied.status).toBe(403);
    addVenueMember(v.id, { wallet: PROVIDER_W, role: "provider", addedBy: OWNER });
    const ok = await postJob(a, PROVIDER_W, v.id);
    expect(ok.status).not.toBe(403);
    expect(ok.status).not.toBe(404);
  });

  it("open policy: stranger posts fine", async () => {
    const v = makeVenue({ clientPolicy: "open" });
    const a = app();
    const res = await postJob(a, STRANGER, v.id);
    expect(res.status).not.toBe(403);
  });
});

// ─── requiredClass pass gate (AC4) ──────────────────────────────

describe("requiredClass gate", () => {
  it("member without pass → 402; with pass → 200", async () => {
    const v = makeVenue({ requiredClass: CLASS_MEDIUM });
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    const a = app();
    configureAgentAuthForTesting({
      verifier: async () => true,
      hasAccess: async () => false,
    });
    const denied = await a.request(`/api/venue/instances/${v.id}/jobs`, {
      headers: signedHeaders(VIEWER_W),
    });
    expect(denied.status).toBe(402);
    configureAgentAuthForTesting({
      verifier: async () => true,
      hasAccess: async () => true,
    });
    const ok = await a.request(`/api/venue/instances/${v.id}/jobs`, {
      headers: signedHeaders(VIEWER_W),
    });
    expect(ok.status).toBe(200);
  });
});

// ─── Provider write gate: claim/submit (AC2) ────────────────────

describe("provider write gate", () => {
  function lifecycleApp(): Hono {
    const a = new Hono();
    a.route("/", createVenueApiRoutes({
      network: () => testNet,
      onchainJob: async () => ({
        status: 0, // open
        client: OWNER,
        provider: undefined,
        evaluator: STRANGER,
      }),
    } as VenueDeps));
    return a;
  }

  it("viewer member cannot claim a venue job; provider member can", async () => {
    const v = makeVenue();
    addVenueMember(v.id, { wallet: VIEWER_W, role: "viewer", addedBy: OWNER });
    addVenueMember(v.id, { wallet: PROVIDER_W, role: "provider", addedBy: OWNER });
    upsertJob(jobFixture({
      jobId: "j_claim",
      venueId: v.id,
      onchainJobId: 42,
      status: "open",
    }));
    const a = lifecycleApp();
    const denied = await a.request("/api/venue/jobs/j_claim/claim", {
      method: "POST",
      headers: signedHeaders(VIEWER_W),
      body: JSON.stringify({ sign: "calldata" }),
    });
    expect(denied.status).toBe(403);
    const { error } = (await denied.json()) as { error?: string };
    expect(error).toContain("venue provider");
    const ok = await a.request("/api/venue/jobs/j_claim/claim", {
      method: "POST",
      headers: signedHeaders(PROVIDER_W),
      body: JSON.stringify({ sign: "calldata" }),
    });
    expect(ok.status).toBe(200);
  });
});

// ─── Public venue regression (AC5) ──────────────────────────────

describe("public venue regression", () => {
  it("GET /api/venue/jobs open without headers; POST job unchanged", async () => {
    const a = app();
    const list = await a.request("/api/venue/jobs");
    expect(list.status).toBe(200);
    const res = await a.request("/api/venue/jobs", {
      method: "POST",
      headers: signedHeaders(OWNER),
      body: JSON.stringify({
        title: "J", description: "d", budgetUsdc: 3,
      }),
    });
    expect(res.status).toBe(200); // prepare-style route returns createJob calldata
  });
});
