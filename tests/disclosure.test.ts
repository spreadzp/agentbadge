/**
 * SLICE-181-4 tests: disclosure fields on unilateral decisions.
 *
 * AC coverage:
 *  - withDisclosure() stamps disclosure{decided_by, appeal, basis}
 *  - disclosure does not clobber existing body fields
 *  - venue job evaluate→reject + reject responses carry disclosure
 *    (escrow logic untouched — calldata shape unchanged apart from
 *    the additive `disclosure` key)
 *  - verification.md links the refusal contract
 */

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { Hono } from "hono";
import { decodeFunctionData } from "viem";

import { withDisclosure } from "../src/server/lib/disclosure";
import {
  resetStoreForTesting,
  upsertJob,
  useMemoryStoreForTesting,
  type VenueJob,
} from "../src/server/lib/venue/store";
import {
  createVenueApiRoutes,
  type VenueDeps,
} from "../src/server/routes/venue-api";
import { createVenueStore } from "../src/server/lib/attestation-store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ERC8183_ACP_ABI } from "@agentbadge/circle-payments";
import {
  configureAgentAuthForTesting,
  resetAgentAuthForTesting,
} from "../src/server/middleware/agent-auth";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";

// ─── withDisclosure unit ─────────────────────────────────────────

describe("withDisclosure", () => {
  it("stamps disclosure {decided_by, appeal, basis}", () => {
    const out = withDisclosure(
      { status: "rejected" },
      {
        decidedBy: "platform",
        appeal: "/contact",
        basis: "evaluator verdict: reject",
      },
    );
    expect(out.disclosure).toEqual({
      decided_by: "platform",
      appeal: "/contact",
      basis: "evaluator verdict: reject",
    });
    expect(out.status).toBe("rejected");
  });

  it("preserves existing body fields and returns a new object", () => {
    const body = { job: { jobId: "x" }, mode: "calldata" };
    const out = withDisclosure(body, {
      decidedBy: "platform",
      appeal: "/contact",
      basis: "manual review",
    });
    expect(out.job).toEqual({ jobId: "x" });
    expect(out.mode).toBe("calldata");
    expect(body).not.toHaveProperty("disclosure");
  });
});

// ─── venue reject surface (additive disclosure, escrow untouched) ──

const CLIENT = "0x1111111111111111111111111111111111111111" as const;
const PROVIDER = "0x2222222222222222222222222222222222222222" as const;
const EVALUATOR = "0x3333333333333333333333333333333333333333" as const;

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

const S = { open: 0, funded: 1, submitted: 2, completed: 3, rejected: 4 };
interface RawJob {
  status: number;
  client?: string;
  provider?: string;
  evaluator?: string;
  expiredAt?: bigint;
}
let rawJob: RawJob | null = null;

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

function app(): Hono {
  const a = new Hono();
  const deps: VenueDeps = {
    network: () => testNet,
    onchainJob: async () => rawJob,
    agentOwner: async () => CLIENT,
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

describe("venue unilateral decisions carry disclosure", () => {
  it("evaluate verdict:reject → disclosure {decided_by, appeal, basis}", async () => {
    seedJob();
    rawJob = { status: S.submitted, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/evaluate", EVALUATOR, {
      verdict: "reject",
      reason: "bad output",
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      txs: { data: string }[];
      disclosure?: { decided_by: string; appeal: string; basis: string };
    };
    // escrow path unchanged — reject calldata still produced
    expect(
      decodeFunctionData({ abi: testNet.abi, data: out.txs[0].data as `0x${string}` })
        .functionName,
    ).toBe("reject");
    expect(out.disclosure?.decided_by).toBe("evaluator");
    expect(out.disclosure?.appeal).toBeTruthy();
    expect(out.disclosure?.basis).toBeTruthy();
  });

  it("POST /jobs/:id/reject → disclosure on the response", async () => {
    seedJob();
    rawJob = { status: S.submitted, client: CLIENT, provider: PROVIDER, evaluator: EVALUATOR };
    const res = await post(app(), "/api/venue/jobs/vj_test1/reject", EVALUATOR, {
      reason: "scope mismatch",
    });
    expect(res.status).toBe(200);
    const out = (await res.json()) as {
      disclosure?: { decided_by: string; appeal: string; basis: string };
    };
    expect(out.disclosure?.decided_by).toBe("evaluator");
    expect(out.disclosure?.appeal).toBeTruthy();
  });
});

// ─── verification.md links refusal contract ──────────────────────

describe("verification-docs", () => {
  it("/verification.md references /api/meta/refusal-contract", async () => {
    const { verificationDocsRoutes } = await import(
      "../src/server/routes/well-known/verification-docs"
    );
    const a = new Hono();
    a.route("/", verificationDocsRoutes);
    const res = await a.request("/verification.md");
    expect(res.status).toBe(200);
    const md = await res.text();
    expect(md).toContain("/api/meta/refusal-contract");
  });
});
