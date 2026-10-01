/**
 * SLICE-152-4: venue economics — config parse, feeMode resolution, eval-fee
 * gate (402 until paid), sweep tx build + post-complete sweep wiring.
 * Hook path verified against deployed AgenticCommerce impl (IACPHook);
 * no live RPC — all senders injected.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { Hono } from "hono";
import { decodeFunctionData, parseAbi } from "viem";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import {
  getJob,
  resetStoreForTesting,
  upsertJob,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import {
  buildFeeSweepTx,
  feeQuote,
  resolveFeeMode,
  venueEconomics,
} from "../src/server/lib/venue/economics";
import {
  createVenueApiRoutes,
  type VenueDeps,
} from "../src/server/routes/venue-api";
import { createVenueStore } from "../src/server/lib/attestation-store";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetConfigCache } from "../src/config/env";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";

const CLIENT = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const EVALUATOR = "0x3333333333333333333333333333333333333333" as const;
const TREASURY = "0x4444444444444444444444444444444444444444" as const;

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
  explorerTx: (h) => `https://testnet.arcscan.app/tx/${h}`,
  explorerAddr: (a) => `https://testnet.arcscan.app/address/${a}`,
};

const ENV_KEYS = [
  "DATABASE_ENABLED", "ARC_VENUE_TAKE_BPS", "ARC_EVAL_FEE_USDC",
  "ARC_TREASURY_ADDRESS", "ARC_VENUE_FEE_HOOK", "ARC_VENUE_SERVER_WALLETS",
  "ARC_VENUE_PROVIDER_KEY", "DEPLOYER_PRIVATE_KEY",
] as const;
const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const k of ENV_KEYS) savedEnv[k] = process.env[k];
  process.env.DATABASE_ENABLED = "false";
  delete process.env.ARC_VENUE_FEE_HOOK;
  delete process.env.ARC_EVAL_FEE_USDC;
  delete process.env.ARC_TREASURY_ADDRESS;
  delete process.env.CIRCLE_TREASURY_ADDRESS;
  delete process.env.ARC_VENUE_PROVIDER_KEY;
  delete process.env.DEPLOYER_PRIVATE_KEY;
  delete process.env.ARC_VENUE_SERVER_WALLETS;
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  configureAgentAuthForTesting({ verifier: async () => true });
  resetVenueEventsForTests();
});
afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  resetStoreForTesting();
  resetAgentAuthForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  resetConfigCache();
});

function seedJob(over: Partial<VenueJob> = {}): VenueJob {
  const job: VenueJob = {
    jobId: "vj_econ1",
    onchainJobId: 7,
    title: "t",
    description: "d",
    budgetUsdc: 100,
    status: "submitted",
    client: CLIENT,
    provider: PROVIDER,
    evaluator: EVALUATOR,
    createdAt: "2026-10-01T00:00:00.000Z",
    chainTxs: {},
    ...over,
  };
  upsertJob(job);
  return job;
}

// ─── config parse ────────────────────────────────────────────────

describe("venueEconomics", () => {
  it("defaults: 250bps, no eval fee, no treasury, no hook", () => {
    const e = venueEconomics();
    expect(e.takeRateBps).toBe(250);
    expect(e.evalFeeAtomic).toBe(0n);
    expect(e.treasury).toBeNull();
    expect(e.feeHook).toBeNull();
  });

  it("parses env: bps, eval fee atomic, treasury, hook", () => {
    process.env.ARC_VENUE_TAKE_BPS = "500";
    process.env.ARC_EVAL_FEE_USDC = "100000";
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    process.env.ARC_VENUE_FEE_HOOK = "0x5555555555555555555555555555555555555555";
    const e = venueEconomics();
    expect(e.takeRateBps).toBe(500);
    expect(e.evalFeeAtomic).toBe(100000n);
    expect(e.treasury).toBe(TREASURY);
    expect(e.feeHook).toBe("0x5555555555555555555555555555555555555555");
  });

  it("invalid envs fall back to safe defaults", () => {
    process.env.ARC_VENUE_TAKE_BPS = "99999";
    process.env.ARC_EVAL_FEE_USDC = "abc";
    process.env.ARC_TREASURY_ADDRESS = "not-an-address";
    const e = venueEconomics();
    expect(e.takeRateBps).toBe(250);
    expect(e.evalFeeAtomic).toBe(0n);
    expect(e.treasury).toBeNull();
  });
});

// ─── feeMode resolution + quote ──────────────────────────────────

describe("resolveFeeMode + feeQuote", () => {
  it("hook wins when ARC_VENUE_FEE_HOOK configured", () => {
    process.env.ARC_VENUE_FEE_HOOK = "0x5555555555555555555555555555555555555555";
    const job = seedJob();
    expect(resolveFeeMode(job, venueEconomics(), testNet)).toBe("hook");
  });

  it("sweep only when provider is a server signer EOA", () => {
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    const job = seedJob(); // provider=PROVIDER, no provider key → none
    expect(resolveFeeMode(job, venueEconomics(), testNet)).toBe("none");
  });

  it("none when no treasury or takeRateBps=0", () => {
    process.env.ARC_VENUE_TAKE_BPS = "0";
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    const job = seedJob();
    expect(resolveFeeMode(job, venueEconomics(), testNet)).toBe("none");
  });

  it("feeQuote splits budget: 250bps of 100 USDC = 2.5 fee / 97.5 provider", () => {
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    const q = feeQuote(100, venueEconomics(), "sweep");
    expect(q.feeAtomic).toBe("2500000");
    expect(q.providerAtomic).toBe("97500000");
    expect(q.feeBps).toBe(250);
    expect(q.treasury).toBe(TREASURY);
  });

  it("feeQuote mode=none → full budget to provider", () => {
    const q = feeQuote(100, venueEconomics(), "none");
    expect(q.feeAtomic).toBe("0");
    expect(q.providerAtomic).toBe("100000000");
  });
});

// ─── sweep tx builder ────────────────────────────────────────────

describe("buildFeeSweepTx", () => {
  it("builds USDC transfer(treasury, fee) to chain usdc", () => {
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    const job = seedJob({ budgetUsdc: 100 });
    const tx = buildFeeSweepTx(job, venueEconomics(), testNet)!;
    expect(tx.to).toBe(testNet.chain.usdc);
    const dec = decodeFunctionData({
      abi: parseAbi(["function transfer(address,uint256)"]),
      data: tx.data,
    });
    expect(dec.functionName).toBe("transfer");
    expect(dec.args[0]).toBe(TREASURY);
    expect(dec.args[1]).toBe(2500000n);
  });

  it("null without treasury", () => {
    const job = seedJob();
    expect(buildFeeSweepTx(job, venueEconomics(), testNet)).toBeNull();
  });
});

// ─── routes: economics endpoint + eval-fee gate + sweep ─────────

describe("venue economics routes", () => {
  const S = { submitted: 2, completed: 3 };

  function app(sendTx?: VenueDeps["sendTx"], onchainStatus = S.submitted): Hono {
    const a = new Hono();
    a.route("/", createVenueApiRoutes({
      network: () => testNet,
      onchainJob: async () => ({
        status: onchainStatus, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR,
      }),
      agentOwner: async () => CLIENT,
      sendTx,
      attestations: createVenueStore(),
    }));
    return a;
  }

  const post = (a: Hono, path: string, wallet: string, body: object) =>
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

  it("GET /api/venue/economics returns config + feeModes", async () => {
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    process.env.ARC_EVAL_FEE_USDC = "100000";
    const res = await app().request("/api/venue/economics");
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      takeRateBps: number; evalFeeAtomic: string; treasury: string;
      feeHook: string | null; feeModes: { hook: boolean; sweep: boolean };
    };
    expect(j.takeRateBps).toBe(250);
    expect(j.evalFeeAtomic).toBe("100000");
    expect(j.treasury).toBe(TREASURY);
    expect(j.feeModes.sweep).toBe(true);
    expect(j.feeModes.hook).toBe(false);
  });

  it("createJob wires feeHook + marks evalFee.required when fee set", async () => {
    process.env.ARC_VENUE_FEE_HOOK = "0x5555555555555555555555555555555555555555";
    process.env.ARC_EVAL_FEE_USDC = "100000";
    const res = await post(app(), "/api/venue/jobs", CLIENT, {
      title: "t", description: "d", budgetUsdc: 50,
    });
    expect(res.status).toBe(200);
    const j = (await res.json()) as {
      job: VenueJob;
      txs: { createJob: { data: string } };
    };
    expect(j.job.feeMode).toBe("hook");
    expect(j.job.evalFee?.required).toBe(true);
    const dec = decodeFunctionData({ abi: ERC8183_ACP_ABI, data: j.txs.createJob.data as `0x${string}` });
    expect(dec.args[4]).toBe("0x5555555555555555555555555555555555555555");
  });

  it("evaluate → 402 PAYMENT_REQUIRED while evalFee unpaid", async () => {
    seedJob({ evalFee: { required: true, paid: false, amountAtomic: "100000" } });
    const res = await post(app(async () => ["0x9" as `0x${string}`]),
      "/api/venue/jobs/vj_econ1/evaluate", EVALUATOR,
      { verdict: "approve", sign: "server" });
    expect(res.status).toBe(402);
    const j = (await res.json()) as { error: string; code: string };
    expect(j.code).toBe("PAYMENT_REQUIRED");
  });

  it("attach evalFee tx → evaluate passes (paid gate)", async () => {
    seedJob({ evalFee: { required: true, paid: false, amountAtomic: "100000" } });
    const a = app(async (_r, txs) =>
      txs.map((_, i) => `0x${String(i + 1).padStart(64, "0")}`) as `0x${string}`[]);
    const attach = await a.request("/api/venue/jobs/vj_econ1/tx", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ hash: `0x${"77".repeat(32)}`, phase: "evalFee" }),
    });
    expect(attach.status).toBe(200);
    expect(getJob("vj_econ1")!.evalFee?.paid).toBe(true);
    const res = await post(a, "/api/venue/jobs/vj_econ1/evaluate", EVALUATOR,
      { verdict: "approve", sign: "server" });
    expect(res.status).toBe(200);
  });

  it("completed + feeMode=sweep → provider signer sweeps to treasury", async () => {
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    seedJob({ status: "completed", feeMode: "sweep" });
    const sent: { role: string; txs: { to: string; data: string }[] }[] = [];
    const a = app(async (role, txs) => {
      sent.push({ role, txs: txs as { to: string; data: string }[] });
      return [`0x${"aa".repeat(32)}`];
    }, S.completed);
    const res = await a.request("/api/venue/jobs/vj_econ1");
    expect(res.status).toBe(200);
    expect(sent).toHaveLength(1);
    expect(sent[0].role).toBe("provider");
    const dec = decodeFunctionData({
      abi: parseAbi(["function transfer(address,uint256)"]),
      data: sent[0].txs[0].data as `0x${string}`,
    });
    expect(dec.args[0]).toBe(TREASURY);
    expect(dec.args[1]).toBe(2500000n);
    const job = getJob("vj_econ1")!;
    expect(job.fee?.status).toBe("swept");
    expect(job.fee?.tx).toBe(`0x${"aa".repeat(32)}`);
  });

  it("feeMode=none job → fee record skipped with reason", async () => {
    seedJob({ status: "completed", feeMode: "none" });
    const a = app(async () => [`0x${"bb".repeat(32)}`], S.completed);
    await a.request("/api/venue/jobs/vj_econ1");
    const job = getJob("vj_econ1")!;
    expect(job.fee?.status).toBe("skipped");
    expect(job.fee?.reason).toContain("none");
  });

  it("sweep idempotent — second GET does not resend", async () => {
    process.env.ARC_TREASURY_ADDRESS = TREASURY;
    seedJob({ status: "completed", feeMode: "sweep" });
    let calls = 0;
    const a = app(async () => { calls++; return [`0x${"cc".repeat(32)}`]; }, S.completed);
    await a.request("/api/venue/jobs/vj_econ1");
    await a.request("/api/venue/jobs/vj_econ1");
    expect(calls).toBe(1);
  });
});
