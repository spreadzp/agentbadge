/**
 * SLICE-185-4 (EPIC-185): witness layer e2e — enroll → seat → attest →
 * advisory read, refusal matrix, buyer opt-out, rep-emit spy, memo
 * anchor on/off.
 *
 * In-process e2e: real Hono app + real EIP-191 signatures; the chain
 * send seam is a spy (no network).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { decodeFunctionData, keccak256, toBytes } from "viem";
import { createWitnessRoutes } from "../../src/server/routes/witness-api";
import {
  createMemoryWitnessStore,
  type WitnessStore,
} from "../../src/server/lib/witness/store";
import {
  createMemoryAgentRegistrationStore,
  type AgentRegistrationStore,
} from "../../src/server/lib/agent-registration/store";
import { issueApiKey } from "../../src/server/lib/agent-registration/api-keys";
import { buildWitnessPayload } from "../../src/server/lib/witness/attest";
import type { WitnessJobRef } from "../../src/server/lib/witness/jobs";
import {
  createMemoryWitnessAnchorStore,
  createWitnessAnchorer,
  witnessAttestationId,
  witnessMemoId,
  type WitnessAnchorStore,
} from "../../src/server/lib/witness/anchor";
import {
  emitAttestRep,
  type WitnessRepSink,
} from "../../src/server/lib/witness/rep-bridge";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import type { SendAnchorFn } from "../../src/server/lib/eaas/anchor";

const WITNESS = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const SECOND = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const EVIL = privateKeyToAccount(
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
);

const AGENT_1 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:1";
const AGENT_2 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:2";
const AGENT_3 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:3";

const SHA = `0x${"a".repeat(64)}` as const;
const MEMO = "0x1111111111111111111111111111111111111111" as const;
const SELF = "0x2222222222222222222222222222222222222222" as const;

function makeJob(overrides: Partial<WitnessJobRef> = {}): WitnessJobRef {
  return {
    jobId: "job-1",
    requesterWallet: "0x3333333333333333333333333333333333333333",
    buyerWallet: "0x3333333333333333333333333333333333333334",
    evaluatorWallet: "0x4444444444444444444444444444444444444444",
    evaluatorVerdict: "pass",
    deliveredAt: Date.now() - 60_000,
    witnessAllowed: true,
    ...overrides,
  };
}

interface Harness {
  app: Hono;
  store: WitnessStore;
  reg: AgentRegistrationStore;
  jobs: Map<string, WitnessJobRef>;
  keys: Map<string, string>;
  repCalls: { event: string; signal: unknown }[];
  sentTx: { to: string; data: string }[];
  anchorStore: WitnessAnchorStore;
}

function harness(
  jobOverrides: Partial<WitnessJobRef> = {},
  opts: { repSink?: WitnessRepSink; anchor?: boolean; repThrow?: boolean } = {},
): Harness {
  const store = createMemoryWitnessStore();
  const reg = createMemoryAgentRegistrationStore();
  const jobs = new Map<string, WitnessJobRef>();
  const job = makeJob(jobOverrides);
  jobs.set(job.jobId, job);
  const repCalls: Harness["repCalls"] = [];
  const sentTx: Harness["sentTx"] = [];
  const anchorStore = createMemoryWitnessAnchorStore();

  const repSink: WitnessRepSink | undefined = opts.repThrow
    ? { emit: () => { throw new Error("rep sink exploded"); } }
    : (opts.repSink ?? {
      emit: (event, signal) => repCalls.push({ event, signal }),
    });

  let anchorer: ReturnType<typeof createWitnessAnchorer> | undefined;
  if (opts.anchor) {
    // Synchronous scheduler — the attempt runs inside enqueue, so the
    // store reflects its terminal status before the assertion runs.
    const send: SendAnchorFn = async (tx) => {
      sentTx.push(tx);
      return { txHash: `0x${"b".repeat(64)}`, blockNumber: 1n };
    };
    anchorer = createWitnessAnchorer({
      store: anchorStore,
      attestations: store,
      walletFor: async (agentId) => (await store.getEnroll(agentId))?.wallet,
      memo: MEMO,
      selfAddress: SELF,
      send,
      retries: 3,
      backoffMs: 1,
      schedule: (fn) => fn(),
    });
  }

  const app = new Hono().route(
    "/",
    createWitnessRoutes({
      enabled: true,
      store,
      registrationStore: reg,
      getJob: (id) => jobs.get(id),
      windowSec: 3600,
      dailyCap: 10,
      seatDailyCap: 10,
      repSink,
      ...(anchorer ? { anchorer } : {}),
    }),
  );
  return { app, store, reg, jobs, keys: new Map(), repCalls, sentTx, anchorStore };
}

async function regKey(h: Harness, agentId: string): Promise<string> {
  const { key, keyHash } = issueApiKey();
  h.keys.set(agentId, key);
  await h.reg.put({
    agentId,
    registryAddress: "0x8004A169FB4a3325136EB29fA0ceB6D2e539a432",
    registryTx: "0xabc" as `0x${string}`,
    name: agentId,
    keyHash,
    tier: "observer",
    status: "active",
    createdAt: Date.now(),
  });
  return key;
}

const bearer = (key?: string): Record<string, string> =>
  key ? { authorization: `Bearer ${key}` } : {};

const json = (key?: string) => ({
  "content-type": "application/json",
  ...bearer(key),
});

async function enroll(h: Harness, agentId: string, wallet: string) {
  return h.app.request("/api/v1/witness/enroll", {
    method: "POST",
    headers: json(h.keys.get(agentId)),
    body: JSON.stringify({ domains: ["scan"], wallet }),
  });
}

async function seat(h: Harness, agentId: string, jobId = "job-1") {
  return h.app.request(`/api/v1/witness/jobs/${jobId}/seat`, {
    method: "POST",
    headers: bearer(h.keys.get(agentId)),
  });
}

async function attest(
  h: Harness,
  agentId: string,
  account: typeof WITNESS,
  jobId = "job-1",
  verdict: "pass" | "fail" | "inconclusive" = "pass",
) {
  const payload = buildWitnessPayload({
    jobId,
    agentId,
    verdict,
    contentSha256: SHA,
    reason: "verified the deliverable",
  });
  const signature = await account.signMessage({ message: payload });
  return h.app.request(`/api/v1/witness/jobs/${jobId}/attest`, {
    method: "POST",
    headers: json(h.keys.get(agentId)),
    body: JSON.stringify({
      verdict,
      contentSha256: SHA,
      reason: "verified the deliverable",
      signature,
    }),
  });
}

const advisoryRead = (h: Harness, jobId = "job-1") =>
  h.app.request(`/api/v1/witness/jobs/${jobId}`);

/* ------------------------------ happy path ------------------------------ */

describe("e2e: enroll → seat → attest → advisory", () => {
  it("full cycle: attest lands, rep emitted, advisory hides then reveals", async () => {
    const h = harness();
    const key = await regKey(h, AGENT_1);

    // enroll
    const e = await enroll(h, AGENT_1, WITNESS.address);
    expect(e.status).toBe(201);
    const eBody = await e.json();
    expect(eBody.enrollment.wallet).toBe(WITNESS.address);

    // seat
    const s = await seat(h, AGENT_1);
    expect(s.status).toBe(201);

    // attest
    const a = await attest(h, AGENT_1, WITNESS);
    expect(a.status).toBe(201);
    const aBody = await a.json();
    expect(aBody.attestation.agentId).toBe(AGENT_1);
    // D-185-8: response carries ONLY own record — no peer/evaluator data.
    expect(aBody.attestation.evaluatorVerdict).toBeUndefined();
    expect(aBody.witnesses).toBeUndefined();

    // rep emit: attested + agreement (evaluatorVerdict=pass, verdict=pass)
    expect(h.repCalls.map((r) => r.event)).toEqual([
      "witness.attested",
      "witness.agreement",
    ]);

    // advisory read while window open → hidden (independence)
    const open = await advisoryRead(h);
    const openBody = await open.json();
    expect(openBody.witnessesRevealed).toBe(false);
    expect(openBody.witnesses).toEqual([]);
    expect(openBody.evaluatorVerdict).toBeNull();

    // after window close → revealed
    h.jobs.set("job-1", {
      ...makeJob(),
      deliveredAt: Date.now() - 7200_000,
    });
    const closed = await advisoryRead(h);
    const closedBody = await closed.json();
    expect(closedBody.witnessesRevealed).toBe(true);
    expect(closedBody.witnesses).toHaveLength(1);
    expect(closedBody.witnesses[0].verdict).toBe("pass");
    expect(closedBody.evaluatorVerdict).toBe("pass");
    expect(closedBody.witness_agreement).toBe(true);
    void key;
  });
});

/* ---------------------------- refusal matrix ---------------------------- */

describe("e2e: refusal matrix", () => {
  it("no key → 401; not enrolled → 409 witness_not_enrolled", async () => {
    const h = harness();
    const noKey = await h.app.request("/api/v1/witness/enroll", {
      method: "POST",
      headers: json(),
      body: JSON.stringify({ domains: ["scan"], wallet: WITNESS.address }),
    });
    expect(noKey.status).toBe(401);

    await regKey(h, AGENT_1);
    const r = await seat(h, AGENT_1);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("witness_not_enrolled");
  });

  it("opt-out job blocks seats with witness_opt_out", async () => {
    const h = harness({ witnessAllowed: false });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const r = await seat(h, AGENT_1);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("witness_opt_out");
  });

  it("COI: enrolled wallet == evaluator wallet → witness_conflict", async () => {
    const h = harness({ evaluatorWallet: WITNESS.address });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const r = await seat(h, AGENT_1);
    expect(r.status).toBe(409);
    expect((await r.json()).code).toBe("witness_conflict");
  });

  it("attest without seat → 409 witness_no_seats; duplicate → witness_duplicate", async () => {
    const h = harness();
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);

    const noSeat = await attest(h, AGENT_1, WITNESS);
    expect(noSeat.status).toBe(409);
    expect((await noSeat.json()).code).toBe("witness_no_seats");

    await seat(h, AGENT_1);
    expect((await attest(h, AGENT_1, WITNESS)).status).toBe(201);
    const dup = await attest(h, AGENT_1, WITNESS);
    expect(dup.status).toBe(409);
    expect((await dup.json()).code).toBe("witness_duplicate");
  });

  it("window closed → witness_window_closed for both seat and attest", async () => {
    const h = harness({ deliveredAt: Date.now() - 7200_000 });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    expect((await seat(h, AGENT_1)).status).toBe(409);
    const a = await attest(h, AGENT_1, WITNESS);
    // no seat was ever claimed → no_seats wins before the window check
    expect(a.status).toBe(409);
  });

  it("two seats max — third witness gets witness_no_seats", async () => {
    const h = harness();
    for (const [agent, acct] of [
      [AGENT_1, WITNESS],
      [AGENT_2, SECOND],
      [AGENT_3, EVIL],
    ] as const) {
      await regKey(h, agent);
      await enroll(h, agent, acct.address);
    }
    expect((await seat(h, AGENT_1)).status).toBe(201);
    expect((await seat(h, AGENT_2)).status).toBe(201);
    const third = await seat(h, AGENT_3);
    expect(third.status).toBe(409);
    expect((await third.json()).code).toBe("witness_no_seats");
  });
});

/* ------------------------------- rep bridge ----------------------------- */

describe("e2e: rep bridge", () => {
  it("sink failure does not break 201", async () => {
    const h = harness({}, { repThrow: true });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    await seat(h, AGENT_1);
    const a = await attest(h, AGENT_1, WITNESS);
    expect(a.status).toBe(201);
  });

  it("disagreement event when witness verdict differs from evaluator", async () => {
    const h = harness({ evaluatorVerdict: "fail" });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    await seat(h, AGENT_1);
    await attest(h, AGENT_1, WITNESS, "job-1", "pass");
    expect(h.repCalls.map((r) => r.event)).toEqual([
      "witness.attested",
      "witness.disagreement",
    ]);
  });

  it("no evaluatorVerdict → only attested", async () => {
    const h = harness({ evaluatorVerdict: undefined });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    await seat(h, AGENT_1);
    await attest(h, AGENT_1, WITNESS);
    expect(h.repCalls.map((r) => r.event)).toEqual(["witness.attested"]);
  });

  it("emitAttestRep is a no-op without a sink", () => {
    expect(() =>
      emitAttestRep(undefined, {
        agentId: AGENT_1,
        jobId: "j",
        verdict: "pass",
      }),
    ).not.toThrow();
  });
});

/* -------------------------------- anchor -------------------------------- */

describe("e2e: memo anchor (WITNESS_ANCHOR_ENABLED)", () => {
  it("off → zero send calls, no anchor records", async () => {
    const h = harness({}, { anchor: false });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    await seat(h, AGENT_1);
    expect((await attest(h, AGENT_1, WITNESS)).status).toBe(201);
    expect(h.sentTx).toHaveLength(0);
    expect(h.anchorStore.list()).toHaveLength(0);
  });

  it("on → memo tx carries memoIdFor('witness', attestationId) + payloadHash", async () => {
    const h = harness({}, { anchor: true });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    await seat(h, AGENT_1);
    expect((await attest(h, AGENT_1, WITNESS)).status).toBe(201);

    expect(h.sentTx).toHaveLength(1);
    expect(h.sentTx[0].to).toBe(MEMO);

    const decoded = decodeFunctionData({
      abi: MEMO_ABI,
      data: h.sentTx[0].data as `0x${string}`,
    });
    const attestationId = witnessAttestationId("job-1", AGENT_1);
    // args: [target, data, memoId, contextHash]
    expect(decoded.args[0]).toBe(WITNESS.address); // attributable to witness
    expect(decoded.args[2]).toBe(witnessMemoId(attestationId));
    expect(decoded.args[2]).toBe(memoIdFor("witness", attestationId));
    const att = await h.store.getAttestation("job-1", AGENT_1);
    expect(decoded.args[3]).toBe(
      keccak256(toBytes(buildWitnessPayload(att!))),
    );

    const rec = h.anchorStore.get(attestationId);
    expect(rec?.status).toBe("anchored");
    expect(rec?.txHash).toBe(`0x${"b".repeat(64)}`);
  });

  it("anchor retries on send failure then marks failed", async () => {
    const anchorStore = createMemoryWitnessAnchorStore();
    const store = createMemoryWitnessStore();
    const sends: number[] = [];
    const send: SendAnchorFn = async () => {
      sends.push(1);
      throw new Error("rpc down");
    };
    const anchorer = createWitnessAnchorer({
      store: anchorStore,
      attestations: store,
      walletFor: async () => WITNESS.address,
      memo: MEMO,
      selfAddress: SELF,
      send,
      retries: 2,
      backoffMs: 1,
      schedule: (fn) => fn(),
    });
    const att = {
      jobId: "j1",
      agentId: AGENT_1,
      verdict: "pass" as const,
      contentSha256: SHA,
      reason: "r",
      attestedAt: new Date().toISOString(),
      signature: `0x${"c".repeat(130)}` as `0x${string}`,
    };
    anchorer.enqueue(att);
    // allow the async attempt chain to settle
    await new Promise((r) => setTimeout(r, 10));
    const rec = anchorStore.get(witnessAttestationId("j1", AGENT_1));
    expect(sends).toHaveLength(2);
    expect(rec?.status).toBe("failed");
    expect(rec?.attempts).toBe(2);
  });
});
