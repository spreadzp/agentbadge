/**
 * SLICE-185-2 (EPIC-185): witness API tests — enroll / seat / attest.
 *
 * Real EIP-191 signatures via viem privateKeyToAccount + the same
 * canonical payload the server verifies (D-185-3). Job fixtures are
 * injected through the getJob dep (WitnessJobRef) — producers land in
 * 185-3.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { createWitnessRoutes } from "../src/server/routes/witness-api";
import {
  createMemoryWitnessStore,
  type WitnessStore,
} from "../src/server/lib/witness/store";
import {
  createMemoryAgentRegistrationStore,
  type AgentRegistrationStore,
} from "../src/server/lib/agent-registration/store";
import { issueApiKey } from "../src/server/lib/agent-registration/api-keys";
import { buildWitnessPayload } from "../src/server/lib/witness/attest";
import type { WitnessJobRef } from "../src/server/lib/witness/jobs";

const WITNESS = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const OTHER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);
const THIRD = privateKeyToAccount(
  "0x47e179ec197488593b187f80a00eb0da91f1b9d0b13f8733639f19c30a34926a",
);

const AGENT_1 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:1";
const AGENT_2 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:2";
const AGENT_3 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:3";

const SHA = `0x${"a".repeat(64)}` as const;

function makeJob(overrides: Partial<WitnessJobRef> = {}): WitnessJobRef {
  return {
    jobId: "job-1",
    requesterWallet: "0x3333333333333333333333333333333333333333",
    buyerWallet: "0x3333333333333333333333333333333333333333",
    evaluatorWallet: "0x4444444444444444444444444444444444444444",
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
}

function harness(jobOverrides: Partial<WitnessJobRef> = {}): Harness {
  const store = createMemoryWitnessStore();
  const reg = createMemoryAgentRegistrationStore();
  const jobs = new Map<string, WitnessJobRef>();
  const job = makeJob(jobOverrides);
  jobs.set(job.jobId, job);
  const app = new Hono().route(
    "/",
    createWitnessRoutes({
      enabled: true,
      store,
      registrationStore: reg,
      getJob: (id) => jobs.get(id),
      windowSec: 3600,
      dailyCap: 3,
    }),
  );
  return { app, store, reg, jobs, keys: new Map() };
}

/** Register an agent → returns its Bearer agb_ key. */
async function regKey(h: Harness, agentId: string): Promise<string> {
  const { key, keyHash } = issueApiKey();
  h.keys.set(agentId, key);
  await h.reg.put({
    agentId,
    keyHash,
    tier: "observer",
    status: "active",
    createdAt: Date.now(),
  });
  return key;
}

const bearer = (key?: string) =>
  key ? { authorization: `Bearer ${key}` } : {};

async function enroll(h: Harness, agentId: string, wallet: string) {
  return h.app.request("/api/v1/witness/enroll", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...bearer(h.keys.get(agentId)),
    },
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
  overrides: Record<string, unknown> = {},
) {
  const payload = buildWitnessPayload({
    jobId,
    agentId,
    verdict: "pass",
    contentSha256: SHA,
    reason: "verified the deliverable",
  });
  const signature = await account.signMessage({ message: payload });
  return h.app.request(`/api/v1/witness/jobs/${jobId}/attest`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...bearer(h.keys.get(agentId)),
    },
    body: JSON.stringify({
      verdict: "pass",
      contentSha256: SHA,
      reason: "verified the deliverable",
      signature,
      ...overrides,
    }),
  });
}

/** Full happy path helper: register key → enroll → seat. */
async function seated(h: Harness, agentId: string, account: typeof WITNESS) {
  await regKey(h, agentId);
  await enroll(h, agentId, account.address);
  return seat(h, agentId);
}

/* --------------------------------- enroll -------------------------------- */

describe("POST /api/v1/witness/enroll", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("no api key → 401 agent_key_invalid", async () => {
    const res = await h.app.request("/api/v1/witness/enroll", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ domains: ["scan"], wallet: WITNESS.address }),
    });
    expect(res.status).toBe(401);
    expect((await res.json()).code).toBe("agent_key_invalid");
  });

  it("observer key + valid body → 201 enrollment", async () => {
    await regKey(h, AGENT_1);
    const res = await enroll(h, AGENT_1, WITNESS.address);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.enrollment.agentId).toBe(AGENT_1);
    expect(body.enrollment.wallet).toBe(WITNESS.address);
    expect(body.enrollment.status).toBe("active");
  });

  it("duplicate enroll → 409 witness_already_enrolled", async () => {
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await enroll(h, AGENT_1, OTHER.address);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_already_enrolled");
    // wallet unchanged
    expect((await h.store.getEnroll(AGENT_1))?.wallet).toBe(WITNESS.address);
  });

  it("invalid domains → 400 witness_invalid_domains", async () => {
    await regKey(h, AGENT_1);
    const res = await h.app.request("/api/v1/witness/enroll", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...bearer(h.keys.get(AGENT_1)),
      },
      body: JSON.stringify({ domains: ["bogus"], wallet: WITNESS.address }),
    });
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("witness_invalid_domains");
  });

  it("invalid wallet → 400 witness_invalid_wallet", async () => {
    await regKey(h, AGENT_1);
    const res = await enroll(h, AGENT_1, "not-an-address");
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("witness_invalid_wallet");
  });
});

/* --------------------------------- seat ---------------------------------- */

describe("POST /api/v1/witness/jobs/:jobId/seat", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("seat claim → 201 with seatNo", async () => {
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.seat.seatNo).toBe(1);
    expect(body.seat.claimed).toBe(true);
  });

  it("unenrolled agent → 409 witness_not_enrolled", async () => {
    await regKey(h, AGENT_1);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_not_enrolled");
  });

  it("unknown job → 404 witness_job_not_found", async () => {
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1, "nope");
    expect(res.status).toBe(404);
    expect((await res.json()).code).toBe("witness_job_not_found");
  });

  it("buyer opt-out job → 409 witness_opt_out", async () => {
    h = harness({ witnessAllowed: false });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_opt_out");
  });

  it("COI by wallet (witness == requester wallet) → 409 witness_conflict", async () => {
    h = harness({ requesterWallet: WITNESS.address });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_conflict");
  });

  it("COI by agentId (witness == evaluator agentId) → 409 witness_conflict", async () => {
    h = harness({ evaluatorAgentId: AGENT_1 });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_conflict");
  });

  it("expired window → 409 witness_window_closed", async () => {
    h = harness({ deliveredAt: Date.now() - 3700_000 });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_window_closed");
  });

  it("undelivered job → 409 witness_not_delivered", async () => {
    h = harness({ deliveredAt: undefined });
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await seat(h, AGENT_1);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_not_delivered");
  });

  it("third claimer → 409 witness_no_seats; repeat claim is idempotent", async () => {
    for (const [agent, acct] of [
      [AGENT_1, WITNESS],
      [AGENT_2, OTHER],
      [AGENT_3, THIRD],
    ] as const) {
      await regKey(h, agent);
      await enroll(h, agent, acct.address);
    }
    expect((await seat(h, AGENT_1)).status).toBe(201);
    expect((await seat(h, AGENT_2)).status).toBe(201);
    // repeat claim → idempotent 200 with the same seat
    const again = await seat(h, AGENT_1);
    expect(again.status).toBe(200);
    expect((await again.json()).seat.seatNo).toBe(1);
    const third = await seat(h, AGENT_3);
    expect(third.status).toBe(409);
    expect((await third.json()).code).toBe("witness_no_seats");
  });
});

/* --------------------------------- attest -------------------------------- */

describe("POST /api/v1/witness/jobs/:jobId/attest", () => {
  let h: Harness;
  beforeEach(() => {
    h = harness();
  });

  it("valid EIP-191 signature → 201 with the signed record", async () => {
    await seated(h, AGENT_1, WITNESS);
    const res = await attest(h, AGENT_1, WITNESS);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attestation.jobId).toBe("job-1");
    expect(body.attestation.agentId).toBe(AGENT_1);
    expect(body.attestation.verdict).toBe("pass");
    expect(body.attestation.contentSha256).toBe(SHA);
    expect(body.attestation.signature).toMatch(/^0x[0-9a-fA-F]{130}$/);
    // D-185-8 independence: response contains ONLY this witness's record
    expect(body.witnesses).toBeUndefined();
  });

  it("signature from another wallet → 400 witness_bad_signature", async () => {
    await seated(h, AGENT_1, WITNESS);
    const res = await attest(h, AGENT_1, OTHER); // enrolled WITNESS, signed OTHER
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe("witness_bad_signature");
  });

  it("attest without a claimed seat → 409 witness_no_seats", async () => {
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    const res = await attest(h, AGENT_1, WITNESS);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_no_seats");
  });

  it("duplicate attest → 409 witness_duplicate", async () => {
    await seated(h, AGENT_1, WITNESS);
    expect((await attest(h, AGENT_1, WITNESS)).status).toBe(201);
    const res = await attest(h, AGENT_1, WITNESS);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_duplicate");
  });

  it("expired window → 409 witness_window_closed", async () => {
    h = harness({ deliveredAt: Date.now() - 1000 });
    // seat must exist before window closes: claim with long window then
    // re-mount routes with a short window
    const job = makeJob({ deliveredAt: Date.now() - 3700_000 });
    h.jobs.set(job.jobId, job);
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    // claimSeat also refuses past window — seed the seat directly
    await h.store.claimSeat("job-1", AGENT_1, Date.now() + 60_000);
    const res = await attest(h, AGENT_1, WITNESS);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_window_closed");
  });

  it("daily cap exceeded → 429 witness_daily_cap with hint", async () => {
    await regKey(h, AGENT_1);
    await enroll(h, AGENT_1, WITNESS.address);
    // cap is 3: burn 3 successful attests on distinct jobs
    for (let i = 0; i < 3; i++) {
      const jid = `cap-${i}`;
      h.jobs.set(jid, makeJob({ jobId: jid }));
      await seat(h, AGENT_1, jid);
      expect((await attest(h, AGENT_1, WITNESS, jid)).status).toBe(201);
    }
    const jid = "cap-over";
    h.jobs.set(jid, makeJob({ jobId: jid }));
    await seat(h, AGENT_1, jid);
    const res = await attest(h, AGENT_1, WITNESS, jid);
    expect(res.status).toBe(429);
    const body = await res.json();
    expect(body.code).toBe("witness_daily_cap");
    expect(body.hint).toBeTruthy();
  });

  it("COI by wallet on attest → 409 witness_conflict", async () => {
    await seated(h, AGENT_1, WITNESS);
    // job edited post-seat to conflict (attest re-checks COI)
    h.jobs.set("job-1", makeJob({ buyerWallet: WITNESS.address }));
    const res = await attest(h, AGENT_1, WITNESS);
    expect(res.status).toBe(409);
    expect((await res.json()).code).toBe("witness_conflict");
  });
});

/* ---------------------------------- me ----------------------------------- */

describe("GET /api/v1/witness/me", () => {
  it("returns enrollment + today's credit usage", async () => {
    const h = harness();
    await seated(h, AGENT_1, WITNESS);
    await attest(h, AGENT_1, WITNESS);
    const res = await h.app.request("/api/v1/witness/me", {
      headers: bearer(h.keys.get(AGENT_1)),
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.enrolled).toBe(true);
    expect(body.enrollment.agentId).toBe(AGENT_1);
    expect(body.credits.used).toBe(1);
    expect(body.credits.cap).toBe(3);
  });

  it("unenrolled agent → enrolled:false", async () => {
    const h = harness();
    await regKey(h, AGENT_1);
    const res = await h.app.request("/api/v1/witness/me", {
      headers: bearer(h.keys.get(AGENT_1)),
    });
    expect(res.status).toBe(200);
    expect((await res.json()).enrolled).toBe(false);
  });

  it("no key → 401", async () => {
    const h = harness();
    const res = await h.app.request("/api/v1/witness/me");
    expect(res.status).toBe(401);
  });
});
