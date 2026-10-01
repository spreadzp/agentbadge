/**
 * SLICE-152-2: jobs lifecycle — state machine, actor gating,
 * calldata vs server sign modes. Onchain reads injected (no live RPC).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  getJob,
  resetStoreForTesting,
  upsertJob,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import {
  createVenueApiRoutes,
  type VenueDeps,
} from "../src/server/routes/venue-api";
import {
  assertTransition,
  buildActionTxs,
  deliverableHash,
  serverWalletAllowlist,
} from "../src/server/lib/venue/lifecycle";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetConfigCache } from "../src/config/env";
import { createVenueStore } from "../src/server/lib/attestation-store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import { decodeFunctionData } from "viem";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";

const CLIENT = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const EVALUATOR = "0x3333333333333333333333333333333333333333" as const;
const STRANGER = "0x4444444444444444444444444444444444444444" as const;

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

// ERC-8183 numeric statuses
const S = { open: 0, funded: 1, submitted: 2, completed: 3, rejected: 4, expired: 5 };

const SAVED_DB = process.env.DATABASE_ENABLED;
const SAVED_WALLETS = process.env.ARC_VENUE_SERVER_WALLETS;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
  delete process.env.ARC_VENUE_SERVER_WALLETS;
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
  if (SAVED_WALLETS === undefined) delete process.env.ARC_VENUE_SERVER_WALLETS;
  else process.env.ARC_VENUE_SERVER_WALLETS = SAVED_WALLETS;
  resetConfigCache();
});

function seedJob(over: Partial<VenueJob> = {}): VenueJob {
  const job: VenueJob = {
    jobId: "vj_test1",
    onchainJobId: 42,
    title: "t",
    description: "d",
    budgetUsdc: 10,
    status: "open",
    client: CLIENT,
    provider: undefined,
    evaluator: EVALUATOR,
    createdAt: "2026-10-01T00:00:00.000Z",
    chainTxs: {},
    ...over,
  };
  upsertJob(job);
  return job;
}

interface RawJob {
  status: number;
  client?: string;
  provider?: string;
  evaluator?: string;
  expiredAt?: bigint;
}
let rawJob: RawJob | null = null;

function app(sendTx?: VenueDeps["sendTx"]): Hono {
  const a = new Hono();
  const deps: VenueDeps = {
    network: () => testNet,
    onchainJob: async () => rawJob,
    agentOwner: async () => CLIENT,
    sendTx,
    attestations: createVenueStore(),
  };
  a.route("/", createVenueApiRoutes(deps));
  return a;
}

const post = (a: Hono, path: string, wallet: string, body: object = {}) =>
  a.request(path, {
    method: "POST",
    headers: {
      "x-wallet": wallet,
      "x-sig": "0xdead",
      "x-timestamp": String(Math.floor(Date.now() / 1000)),
      "content-type": "application/json",
    },
    body: JSON.stringify(body),
  });

// ─── State machine unit ──────────────────────────────────────────

describe("lifecycle state machine", () => {
  it("valid transitions", () => {
    expect(assertTransition("open", "claim").ok).toBe(true);
    expect(assertTransition("open", "fund").ok).toBe(true);
    expect(assertTransition("funded", "submit").ok).toBe(true);
    expect(assertTransition("submitted", "complete").ok).toBe(true);
    expect(assertTransition("submitted", "reject").ok).toBe(true);
    expect(assertTransition("expired", "refund").ok).toBe(true);
    expect(assertTransition("funded", "refund", true).ok).toBe(true);
  });

  it("invalid transitions rejected with current status", () => {
    for (const [st, act] of [
      ["open", "submit"], ["open", "complete"], ["funded", "claim"],
      ["funded", "fund"], ["completed", "submit"], ["submitted", "fund"],
      ["funded", "refund"], ["rejected", "complete"],
    ] as const) {
      const chk = assertTransition(st, act);
      expect(chk.ok).toBe(false);
      expect(chk.current).toBe(st);
      expect(chk.expected.length).toBeGreaterThan(0);
    }
  });

  it("buildActionTxs: fund emits approve+fund (acp includes budget)", () => {
    const txs = buildActionTxs(testNet, "fund", {
      onchainJobId: 42n,
      amountUsdc: 10,
    });
    expect(txs).toHaveLength(2);
    expect(txs[0].to).toBe(testNet.chain.usdc);
    expect(txs[0].description).toContain("approve");
    expect(txs[1].to).toBe(testNet.agenticCommerce);
    const dec = decodeFunctionData({ abi: testNet.abi, data: txs[1].data });
    expect(dec.functionName).toBe("fund");
    expect(dec.args[0]).toBe(42n);
    expect(dec.args[1]).toBe(10_000_000n); // acp expectedBudget
  });

  it("buildActionTxs: submit/complete/reject/refund encode right fns", () => {
    const fns: Record<string, string> = {
      claim: "setBudget", submit: "submit",
      complete: "complete", reject: "reject", refund: "claimRefund",
    };
    const args = { onchainJobId: 7n, amountUsdc: 5 };
    for (const [action, fn] of Object.entries(fns)) {
      const txs = buildActionTxs(testNet, action as never, args);
      const dec = decodeFunctionData({ abi: testNet.abi, data: txs[txs.length - 1].data });
      expect(dec.functionName).toBe(fn);
    }
  });

  it("deliverableHash passes bytes32 through, hashes text", () => {
    const b32 = `0x${"ab".repeat(32)}`;
    expect(deliverableHash(b32)).toBe(b32);
    expect(deliverableHash("https://x.dev/result")).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("serverWalletAllowlist parses role:addr list", () => {
    process.env.ARC_VENUE_SERVER_WALLETS = `client:${CLIENT}, provider:${PROVIDER}`;
    const allow = serverWalletAllowlist();
    expect(allow.client).toBe(CLIENT.toLowerCase());
    expect(allow.provider).toBe(PROVIDER.toLowerCase());
  });
});

// ─── API lifecycle ───────────────────────────────────────────────

describe("venue lifecycle api", () => {
  it("claim: Open job → setBudget calldata, provider assigned", async () => {
    seedJob();
    rawJob = { status: S.open, client: CLIENT, evaluator: EVALUATOR, provider: "0x0000000000000000000000000000000000000000" };
    const res = await post(app(), "/api/venue/jobs/vj_test1/claim", PROVIDER, { budgetUsdc: 12 });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { mode: string; txs: { data: string }[] };
    expect(out.mode).toBe("calldata");
    const dec = decodeFunctionData({ abi: testNet.abi, data: out.txs[0].data as `0x${string}` });
    expect(dec.functionName).toBe("setBudget");
    expect(dec.args[1]).toBe(12_000_000n);
  });

  it("claim on Funded job → 409 with current status", async () => {
    seedJob({ provider: PROVIDER });
    rawJob = { status: S.funded, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/claim", PROVIDER, { budgetUsdc: 5 });
    expect(res.status).toBe(409);
    const err = (await res.json()) as { error: string };
    expect(err.error).toContain("funded");
  });

  it("fund: Open → approve+fund calldata for client", async () => {
    seedJob({ provider: PROVIDER });
    rawJob = { status: S.open, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/fund", CLIENT);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { txs: { to: string }[] };
    expect(out.txs).toHaveLength(2);
  });

  it("fund by wrong signer → 403", async () => {
    seedJob({ provider: PROVIDER });
    rawJob = { status: S.open, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/fund", STRANGER);
    expect(res.status).toBe(403);
  });

  it("submit on Open → 409; on Funded → submit calldata + hash", async () => {
    seedJob({ provider: PROVIDER });
    rawJob = { status: S.open, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const early = await post(app(), "/api/venue/jobs/vj_test1/submit", PROVIDER, { deliverable: "x" });
    expect(early.status).toBe(409);

    rawJob = { status: S.funded, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/submit", PROVIDER,
      { deliverable: "ipfs://result-cid" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { deliverableHash: string };
    expect(out.deliverableHash).toMatch(/^0x[0-9a-f]{64}$/);
  });

  it("evaluate approve → complete calldata; reject verdict → reject calldata", async () => {
    seedJob({ provider: PROVIDER, status: "submitted" });
    rawJob = { status: S.submitted, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const ok = await post(app(), "/api/venue/jobs/vj_test1/evaluate", EVALUATOR, { verdict: "approve" });
    expect(ok.status).toBe(200);
    const okOut = (await ok.json()) as { txs: { data: string }[] };
    expect(decodeFunctionData({ abi: testNet.abi, data: okOut.txs[0].data as `0x${string}` }).functionName).toBe("complete");
    expect(getJob("vj_test1")?.verdict).toContain("approved");

    const no = await post(app(), "/api/venue/jobs/vj_test1/evaluate", EVALUATOR,
      { verdict: "reject", reason: "bad output" });
    const noOut = (await no.json()) as { txs: { data: string }[] };
    expect(decodeFunctionData({ abi: testNet.abi, data: noOut.txs[0].data as `0x${string}` }).functionName).toBe("reject");
  });

  it("evaluate by non-evaluator → 403", async () => {
    seedJob({ provider: PROVIDER, status: "submitted" });
    rawJob = { status: S.submitted, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/evaluate", STRANGER, {});
    expect(res.status).toBe(403);
  });

  it("refund: expired → claimRefund calldata; not expired → 409", async () => {
    seedJob({ status: "funded" });
    rawJob = {
      status: S.funded, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR,
      expiredAt: BigInt(Math.floor(Date.now() / 1000) + 86_400), // future
    };
    const early = await post(app(), "/api/venue/jobs/vj_test1/refund", CLIENT);
    expect(early.status).toBe(409);

    rawJob = { ...rawJob, expiredAt: BigInt(1000) }; // long past
    const res = await post(app(), "/api/venue/jobs/vj_test1/refund", CLIENT);
    expect(res.status).toBe(200);
    const out = (await res.json()) as { txs: { data: string }[] };
    expect(decodeFunctionData({ abi: testNet.abi, data: out.txs[0].data as `0x${string}` }).functionName).toBe("claimRefund");
  });

  it("server sign mode sends txs and syncs store", async () => {
    seedJob({ provider: PROVIDER });
    rawJob = { status: S.funded, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const sent: string[] = [];
    const a = app(async (_role, txs) => {
      for (const t of txs) sent.push(t.data);
      return txs.map((_, i) => `0x${String(i + 1).padStart(64, "0")}`) as `0x${string}`[];
    });
    const res = await post(a, "/api/venue/jobs/vj_test1/submit", PROVIDER,
      { deliverable: "done", sign: "server" });
    expect(res.status).toBe(200);
    const out = (await res.json()) as { mode: string; txHashes: string[] };
    expect(out.mode).toBe("server");
    expect(out.txHashes).toHaveLength(1);
    const job = getJob("vj_test1")!;
    expect(job.status).toBe("submitted");
    expect(job.chainTxs.submitted).toBe(out.txHashes[0]);
  });

  it("server sign without sender → 403", async () => {
    seedJob({ provider: PROVIDER });
    rawJob = { status: S.funded, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const a = app(async () => null);
    const res = await post(a, "/api/venue/jobs/vj_test1/submit", PROVIDER,
      { deliverable: "x", sign: "server" });
    expect(res.status).toBe(403);
  });

  it("GET /api/venue/jobs/:id merges store + onchain and syncs status", async () => {
    seedJob({ status: "funded" });
    rawJob = { status: S.completed, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await app().request("/api/venue/jobs/vj_test1");
    expect(res.status).toBe(200);
    const out = (await res.json()) as { job: VenueJob; onchain: RawJob };
    expect(out.onchain.status).toBe(S.completed);
    expect(out.job.status).toBe("completed");
  });

  it("unknown job → 404; no onchainJobId → 409", async () => {
    seedJob({ onchainJobId: undefined });
    const res = await post(app(), "/api/venue/jobs/vj_test1/fund", CLIENT);
    expect(res.status).toBe(409);
    const missing = await post(app(), "/api/venue/jobs/vj_nope/fund", CLIENT);
    expect(missing.status).toBe(404);
  });
});
