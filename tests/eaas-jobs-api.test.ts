/**
 * SLICE-154-3 tests: external ERC-8183 job evaluation.
 *
 * Covers: contract registration wallet-sig + ABI probe (reject bad
 * contracts, variant detect, owner-only delete), evaluate pipeline
 * (403 allowlist, x402 fee, happy-path settle + artifact, idempotent
 * replay, expired → claimRefund, gas-cap abort 502, non-Submitted 409)
 * and giveFeedback tag1="eaas-eval" write-back.
 *
 * All chain interaction is mocked: escrowFor returns a stub Erc8183,
 * estimateGas/sendTx are spies, verifyWalletSigRequest is overridden.
 */
import { describe, it, expect, afterEach } from "vitest";
import { Hono } from "hono";
import type { Context, Next } from "hono";
import { Wallet } from "ethers";
import type { Hex } from "viem";

import { createEaasJobsRoutes } from "../src/server/routes/eaas-jobs-api";
import {
  createContractRegistry,
  createMemoryContractStore,
} from "../src/server/lib/eaas/contracts";
import {
  createMemoryEvalStore,
  type EvalJobStore,
} from "../src/server/lib/eaas/eval";
import { createVerdictSigner } from "../src/server/lib/eaas/verdict";
import { createJsonVerdictStore } from "../src/server/lib/eaas/store";
import type { PolicyFn } from "../src/server/lib/eaas/policies";
import type { PaymentMiddleware } from "../src/server/routes/identity";
import type { Erc8183, JobView, WriteClient } from "@agentbadge/circle-payments";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CHAIN_ID = 5042002;
const signer = createVerdictSigner(Wallet.createRandom().privateKey, CHAIN_ID);

const OWNER = "0x2222222222222222222222222222222222222222";
const OTHER = "0x3333333333333333333333333333333333333333";
const ESCROW_ADDR = "0x4444444444444444444444444444444444444444";
const SETTLER = "0x5555555555555555555555555555555555555555";
const REGISTRY = "0x6666666666666666666666666666666666666666";
const MEMO = "0x7777777777777777777777777777777777777777";
const PROVIDER = "0x8888888888888888888888888888888888888888";

function jobView(over: Partial<JobView> = {}): JobView {
  return {
    id: 7n,
    client: OWNER,
    provider: PROVIDER,
    evaluator: SETTLER,
    description: "test job",
    budget: 1_000_000n,
    expiredAt: 9_999_999_999n,
    status: "Submitted",
    hook: "0x0000000000000000000000000000000000000000",
    ...over,
  };
}

/** Stub ERC-8183 — records calls, returns canned job. */
function mockEscrow(job: JobView) {
  const calls: { fn: string; jobId: bigint }[] = [];
  const escrow = {
    contract: ESCROW_ADDR,
    getJob: async (id: bigint) => {
      calls.push({ fn: "getJob", jobId: id });
      return job;
    },
    completeJob: async (w: WriteClient, args: { jobId: bigint }) => {
      // Route through the passed wallet so the gas-cap wrapper estimates.
      await w.writeContract({
        address: ESCROW_ADDR,
        abi: [],
        functionName: "complete",
        args: [args.jobId],
      });
      calls.push({ fn: "completeJob", jobId: args.jobId });
      return "0xcomplete" as Hex;
    },
    rejectJob: async (w: WriteClient, args: { jobId: bigint }) => {
      await w.writeContract({
        address: ESCROW_ADDR,
        abi: [],
        functionName: "reject",
        args: [args.jobId],
      });
      calls.push({ fn: "rejectJob", jobId: args.jobId });
      return "0xreject" as Hex;
    },
    claimRefund: async (w: WriteClient, id: bigint) => {
      await w.writeContract({
        address: ESCROW_ADDR,
        abi: [],
        functionName: "claimRefund",
        args: [id],
      });
      calls.push({ fn: "claimRefund", jobId: id });
      return "0xrefund" as Hex;
    },
  } as unknown as Erc8183;
  return { escrow, calls };
}

function makePayMock() {
  const calls: string[] = [];
  const middleware = (priceUsd: string): PaymentMiddleware => {
    const mw = async (c: Context, next: Next) => {
      calls.push(priceUsd);
      if (!c.req.header("payment-signature")) {
        return c.json({ error: "payment required" }, 402);
      }
      c.set("payment", { payer: OWNER, transaction: "0xpaytx" });
      return next();
    };
    return mw as PaymentMiddleware;
  };
  return { calls, middleware };
}

const PASS_POLICY: PolicyFn = async () => ({ pass: true, reason: "ok" });
const FAIL_POLICY: PolicyFn = async () => ({ pass: false, reason: "bad" });

const NOW_SEC = 1_800_000_000; // > any past expiredAt
const NOW_MS = NOW_SEC * 1000;

interface Fixture {
  app: Hono;
  pay: ReturnType<typeof makePayMock>;
  evalStore: EvalJobStore;
  dir: string;
  escrowCalls: { fn: string; jobId: bigint }[];
  gasCalls: number;
  sentTxs: { to: string; data: Hex }[];
}

let dirs: string[] = [];
function mkApp(opts: {
  job?: JobView;
  policy?: PolicyFn;
  estimateGas?: () => Promise<bigint>;
  register?: boolean;
  probeOk?: boolean;
  resolveAgentId?: (p: `0x${string}`) => Promise<bigint | null>;
}): Fixture {
  const dir = mkdtempSync(join(tmpdir(), "eaas-jobs-"));
  dirs.push(dir);
  const job = opts.job ?? jobView();
  const { escrow, calls } = mockEscrow(job);
  const pay = makePayMock();
  const evalStore = createMemoryEvalStore();
  const gasCalls: { n: number } = { n: 0 };
  const sentTxs: { to: string; data: Hex }[] = [];

  const read = {
    readContract: async () => {
      if (opts.probeOk === false) return { status: "not-a-number" };
      return { status: 2, description: "job" }; // "circle" shape
    },
    getBytecode: async () => "0x6001",
    getTransactionReceipt: async () => ({ status: "ok", logs: [] }),
  };

  const contracts = createContractRegistry({
    store: createMemoryContractStore(),
    read: read as never,
    chainId: CHAIN_ID,
    now: () => NOW_MS,
  });

  const wallet: WriteClient = {
    writeContract: async () => "0xwrite" as Hex,
  };

  const app = new Hono();
  app.onError((e, c) => c.json({ error: String(e) }, 500));
  app.route(
    "/",
    createEaasJobsRoutes({
      contracts,
      evalUsd: "$0.10",
      rateRpm: 60,
      chainId: CHAIN_ID,
      paymentForPrice: pay.middleware,
      escrowFor: () => escrow,
      wallet,
      settlerAddress: SETTLER,
      estimateGas: async () => {
        gasCalls.n++;
        return opts.estimateGas ? opts.estimateGas() : 100_000n;
      },
      gasCap: 500_000,
      policy: { pass: PASS_POLICY, fail: FAIL_POLICY },
      signer,
      verdictStore: createJsonVerdictStore(join(dir, "v.json")),
      evalStore,
      reputation: { registry: REGISTRY, memo: MEMO },
      sendTx: async (tx) => {
        sentTxs.push(tx);
        return "0xfbtx" as Hex;
      },
      ...(opts.resolveAgentId ? { resolveAgentId: opts.resolveAgentId } : {}),
      now: () => NOW_MS,
    }),
  );
  return {
    app,
    pay,
    evalStore,
    dir,
    escrowCalls: calls,
    gasCalls: gasCalls.n,
    sentTxs,
  };
}

const SIG = {
  "x-wallet": OWNER,
  "x-sig": "0x" + "aa".repeat(65),
  "x-timestamp": String(Math.floor(Date.now() / 1000)),
};
const PAID = { "payment-signature": "sig" };

const postJson = (app: Hono, path: string, body: unknown, h = {}) =>
  app.request(path, {
    method: "POST",
    headers: { "content-type": "application/json", ...h },
    body: JSON.stringify(body),
  });

async function registerEscrow(app: Hono, addr = ESCROW_ADDR) {
  return postJson(
    app,
    "/api/eaas/contracts",
    { address: addr, chainId: CHAIN_ID },
    SIG,
  );
}

afterEach(() => {
  resetAgentAuthForTesting();
  for (const d of dirs) rmSync(d, { recursive: true, force: true });
  dirs = [];
});

describe("contract registry", () => {
  it("registers a probed contract (wallet-sig)", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app } = mkApp({});
    const res = await registerEscrow(app);
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json.contract.address.toLowerCase()).toBe(ESCROW_ADDR);
    expect(json.contract.ownerWallet.toLowerCase()).toBe(OWNER);
    expect(json.contract.variant).toBe("circle");
    expect(json.contract.active).toBe(true);
  });

  it("rejects registration without a valid signature", async () => {
    configureAgentAuthForTesting({ verifier: async () => false });
    const { app } = mkApp({});
    const res = await registerEscrow(app);
    expect(res.status).toBe(401);
  });

  it("rejects a non-ERC-8183 contract at probe (422)", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app } = mkApp({ probeOk: false });
    const res = await registerEscrow(app);
    expect(res.status).toBe(422);
  });

  it("lists registered contracts publicly", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app } = mkApp({});
    await registerEscrow(app);
    const res = await app.request("/api/eaas/contracts");
    const json = await res.json();
    expect(json.contracts).toHaveLength(1);
  });

  it("delete is owner-only", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app } = mkApp({});
    await registerEscrow(app);
    // another wallet tries to remove
    const bad = await app.request(`/api/eaas/contracts/${ESCROW_ADDR}`, {
      method: "DELETE",
      headers: { ...SIG, "x-wallet": OTHER },
    });
    expect(bad.status).toBe(403);
    const ok = await app.request(`/api/eaas/contracts/${ESCROW_ADDR}`, {
      method: "DELETE",
      headers: SIG,
    });
    expect(ok.status).toBe(200);
    const list = await (await app.request("/api/eaas/contracts")).json();
    expect(list.contracts).toHaveLength(0);
  });
});

describe("jobs/evaluate", () => {
  it("403 for non-allowlisted contract", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app } = mkApp({});
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    expect(res.status).toBe(403);
  });

  it("402 without payment-signature on allowlisted contract", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, pay } = mkApp({});
    await registerEscrow(app);
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
    );
    expect(res.status).toBe(402);
    expect(pay.calls).toEqual(["$0.10"]);
  });

  it("happy path: complete() settles, artifact signed, feedback tagged eaas-eval", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, escrowCalls, sentTxs } = mkApp({
      resolveAgentId: async () => 42n,
    });
    await registerEscrow(app);
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.verdict.verdict).toBe("approve");
    expect(json.verdict.txHash).toBe("0xcomplete");
    expect(json.artifact.evaluator.toLowerCase()).toBe(SETTLER);
    expect(json.artifact.kind).toBe("approve");
    expect(escrowCalls.map((c) => c.fn)).toContain("completeJob");
    // feedback sent — tag1 "eaas-eval" (0x65616173... tail of ascii)
    expect(sentTxs).toHaveLength(1);
    expect(sentTxs[0].to.toLowerCase()).toBe(MEMO);
    expect(sentTxs[0].data).toContain("65616173"); // "eaas"
    expect(json.feedbackTx).toBe("0xfbtx");
  });

  it("idempotent: second evaluate returns stored verdict free (no settle, no pay)", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, escrowCalls, pay } = mkApp({});
    await registerEscrow(app);
    const first = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    expect(first.status).toBe(200);
    const completes = escrowCalls.filter((c) => c.fn === "completeJob").length;
    pay.calls.length = 0;
    const second = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      // no payment header — replay is free
    );
    expect(second.status).toBe(200);
    const json = await second.json();
    expect(json.duplicate).toBe(true);
    expect(
      escrowCalls.filter((c) => c.fn === "completeJob").length,
    ).toBe(completes);
    expect(pay.calls).toHaveLength(0);
  });

  it("reject policy → reject() settles", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, escrowCalls } = mkApp({});
    await registerEscrow(app);
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "fail" },
      PAID,
    );
    const json = await res.json();
    expect(json.verdict.verdict).toBe("reject");
    expect(escrowCalls.map((c) => c.fn)).toContain("rejectJob");
  });

  it("expired job → claimRefund, verdict=expired", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, escrowCalls } = mkApp({
      job: jobView({ expiredAt: 1n }),
    });
    await registerEscrow(app);
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    const json = await res.json();
    expect(json.verdict.verdict).toBe("expired");
    expect(escrowCalls.map((c) => c.fn)).toContain("claimRefund");
  });

  it("gas-cap: estimateGas over cap aborts with 502, no settle call", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, escrowCalls } = mkApp({
      estimateGas: async () => 600_000n, // > 500k cap
    });
    await registerEscrow(app);
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    expect(res.status).toBe(502);
    const json = await res.json();
    expect(json.error).toMatch(/exceeds cap/);
    expect(escrowCalls.map((c) => c.fn)).not.toContain("completeJob");
  });

  it("non-Submitted non-expired job → 409", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app } = mkApp({
      job: jobView({ status: "Completed" }),
    });
    await registerEscrow(app);
    const res = await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    expect(res.status).toBe(409);
  });

  it("400 on malformed body before payment", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, pay } = mkApp({});
    await registerEscrow(app);
    const res = await postJson(app, "/api/eaas/jobs/evaluate", {
      contract: "not-an-address",
      jobId: "7",
    });
    expect(res.status).toBe(400);
    expect(pay.calls).toHaveLength(0);
  });

  it("noFeedback term skips reputation write-back", async () => {
    configureAgentAuthForTesting({ verifier: async () => true });
    const { app, sentTxs } = mkApp({ resolveAgentId: async () => 42n });
    // register with noFeedback
    const res = await postJson(
      app,
      "/api/eaas/contracts",
      {
        address: ESCROW_ADDR,
        chainId: CHAIN_ID,
        terms: { noFeedback: true },
      },
      SIG,
    );
    expect(res.status).toBe(201);
    await postJson(
      app,
      "/api/eaas/jobs/evaluate",
      { contract: ESCROW_ADDR, jobId: "7", policy: "pass" },
      PAID,
    );
    expect(sentTxs).toHaveLength(0);
  });
});
