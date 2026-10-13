/**
 * SLICE-185-3 (EPIC-185): advisory surface + buyer opt-out tests.
 *
 * - computeWitnessAgreement — all-pass → true, any fail → false,
 *   mixed/inconclusive/empty → null (O4).
 * - GET /api/v1/witness/jobs/:jobId — public read; evaluator verdict +
 *   witness_policy + witness_agreement + witnesses[] public shape.
 *   Reveal is window-gated: while the attest window is open witnesses[]
 *   is withheld so a seated witness cannot peek at peers' verdicts
 *   before submitting (D-185-8 independence).
 * - witnessAllowed flag — parsed on job creation (EaaS evaluate input),
 *   stored in the witness-jobs projection (upsertWitnessJob), echoed in
 *   responses; false → seat claim 409 witness_opt_out.
 * - Drift-gate: settle/escrow lib modules must not import witness modules
 *   (D-185-4 — advisory weight never feeds money paths).
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";
import { privateKeyToAccount } from "viem/accounts";
import { mkdtempSync, readFileSync, readdirSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createWitnessRoutes } from "../src/server/routes/witness-api";
import {
  createMemoryWitnessStore,
  type WitnessAttestation,
} from "../src/server/lib/witness/store";
import { createMemoryAgentRegistrationStore } from "../src/server/lib/agent-registration/store";
import { issueApiKey } from "../src/server/lib/agent-registration/api-keys";
import { buildWitnessPayload } from "../src/server/lib/witness/attest";
import {
  computeWitnessAgreement,
  publicAttestation,
} from "../src/server/lib/witness/advisory";
import {
  upsertWitnessJob,
  WITNESS_JOBS_PATH,
  type WitnessJobRef,
} from "../src/server/lib/witness/jobs";
import { validateEvaluate } from "../src/server/lib/eaas/eval-request";

const WITNESS = privateKeyToAccount(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
);
const OTHER = privateKeyToAccount(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
);

const AGENT_1 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:1";
const AGENT_2 = "eip155:5042:0x8004A169FB4a3325136EB29fA0ceB6D2e539a432:2";
const SHA = `0x${"a".repeat(64)}` as const;

const att = (
  agentId: string,
  verdict: WitnessAttestation["verdict"],
): WitnessAttestation => ({
  jobId: "job-1",
  agentId,
  verdict,
  contentSha256: SHA,
  reason: "r",
  attestedAt: "2026-10-14T00:00:00.000Z",
  signature: `0x${"b".repeat(130)}`,
});

function makeJob(overrides: Partial<WitnessJobRef> = {}): WitnessJobRef {
  return {
    jobId: "job-1",
    requesterWallet: "0x3333333333333333333333333333333333333333",
    evaluatorWallet: "0x4444444444444444444444444444444444444444",
    deliveredAt: Date.now() - 60_000,
    witnessAllowed: true,
    evaluatorVerdict: "pass",
    ...overrides,
  };
}

function harness(jobOverrides: Partial<WitnessJobRef> = {}) {
  const store = createMemoryWitnessStore();
  const reg = createMemoryAgentRegistrationStore();
  const jobs = new Map<string, WitnessJobRef>();
  const job = makeJob(jobOverrides);
  jobs.set(job.jobId, job);
  const keys = new Map<string, string>();
  const app = new Hono().route(
    "/",
    createWitnessRoutes({
      enabled: true,
      store,
      registrationStore: reg,
      getJob: (id) => jobs.get(id),
      windowSec: 3600,
      dailyCap: 20,
    }),
  );
  return { app, store, reg, jobs, keys };
}

async function keyFor(h: ReturnType<typeof harness>, agentId: string) {
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

/** Full pipeline: register → enroll → seat → attest (verdict). */
async function attestAs(
  h: ReturnType<typeof harness>,
  agentId: string,
  account: typeof WITNESS,
  verdict: "pass" | "fail" | "inconclusive",
  jobId = "job-1",
) {
  const key = await keyFor(h, agentId);
  await h.app.request("/api/v1/witness/enroll", {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(key) },
    body: JSON.stringify({ domains: ["scan"], wallet: account.address }),
  });
  await h.app.request(`/api/v1/witness/jobs/${jobId}/seat`, {
    method: "POST",
    headers: bearer(key),
  });
  const payload = buildWitnessPayload({
    jobId,
    agentId,
    verdict,
    contentSha256: SHA,
    reason: "advisory check",
  });
  const signature = await account.signMessage({ message: payload });
  return h.app.request(`/api/v1/witness/jobs/${jobId}/attest`, {
    method: "POST",
    headers: { "content-type": "application/json", ...bearer(key) },
    body: JSON.stringify({
      verdict,
      contentSha256: SHA,
      reason: "advisory check",
      signature,
    }),
  });
}

/* ------------------------ agreement computation ------------------------ */

describe("computeWitnessAgreement", () => {
  it("empty → null", () => {
    expect(computeWitnessAgreement([])).toBeNull();
  });
  it("all pass → true", () => {
    expect(computeWitnessAgreement([att(AGENT_1, "pass")])).toBe(true);
    expect(
      computeWitnessAgreement([att(AGENT_1, "pass"), att(AGENT_2, "pass")]),
    ).toBe(true);
  });
  it("any fail → false", () => {
    expect(computeWitnessAgreement([att(AGENT_1, "fail")])).toBe(false);
    expect(
      computeWitnessAgreement([att(AGENT_1, "pass"), att(AGENT_2, "fail")]),
    ).toBe(false);
  });
  it("inconclusive/mixed → null", () => {
    expect(
      computeWitnessAgreement([
        att(AGENT_1, "pass"),
        att(AGENT_2, "inconclusive"),
      ]),
    ).toBeNull();
    expect(computeWitnessAgreement([att(AGENT_1, "inconclusive")])).toBeNull();
  });
});

/* ----------------------- public attestation shape ----------------------- */

describe("publicAttestation", () => {
  it("exposes only the consumer-verifiable fields", () => {
    const p = publicAttestation(att(AGENT_1, "pass"));
    expect(Object.keys(p).sort()).toEqual(
      [
        "agentId",
        "attestedAt",
        "contentSha256",
        "reason",
        "signature",
        "verdict",
      ].sort(),
    );
  });
});

/* --------------------- public GET /jobs/:jobId ------------------------- */

describe("GET /api/v1/witness/jobs/:jobId", () => {
  it("unknown job → 404 witness_job_not_found", async () => {
    const h = harness();
    const res = await h.app.request("/api/v1/witness/jobs/nope");
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("witness_job_not_found");
    expect(body.charged).toBe(false);
  });

  it("public — no auth needed; advisory block fields present", async () => {
    const h = harness();
    const res = await h.app.request("/api/v1/witness/jobs/job-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.jobId).toBe("job-1");
    expect(body.evaluatorVerdict).toBe("pass");
    expect(body.witness_policy).toBe("advisory");
    expect(body.witnessAllowed).toBe(true);
    expect(body).toHaveProperty("witness_agreement");
    expect(body).toHaveProperty("witnesses");
  });

  it("window open → witnesses withheld (independence); agreement null", async () => {
    const h = harness({ deliveredAt: Date.now() - 1000 });
    expect((await attestAs(h, AGENT_1, WITNESS, "pass")).status).toBe(201);
    const res = await h.app.request("/api/v1/witness/jobs/job-1");
    const body = await res.json();
    expect(body.witnesses).toEqual([]);
    expect(body.witnessesRevealed).toBe(false);
    expect(body.witness_agreement).toBeNull();
  });

  it("window closed → witnesses revealed; agreement all-pass → true", async () => {
    const h = harness({ deliveredAt: Date.now() - 7_200_000 });
    // Attest refused post-window (409) by design — inject the settled
    // attestations directly; this test covers the read surface.
    await h.store.putAttestation(att(AGENT_1, "pass"));
    await h.store.putAttestation(att(AGENT_2, "pass"));
    const res = await h.app.request("/api/v1/witness/jobs/job-1");
    const body = await res.json();
    expect(body.witnessesRevealed).toBe(true);
    expect(body.witnesses).toHaveLength(2);
    expect(body.witnesses[0].agentId).toBe(AGENT_1);
    expect(body.witnesses[0].verdict).toBe("pass");
    expect(body.witnesses[0].signature).toMatch(/^0x[0-9a-f]+$/i);
    expect(body.witness_agreement).toBe(true);
  });

  it("window closed + one fail → agreement false", async () => {
    const h = harness({ deliveredAt: Date.now() - 7_200_000 });
    await h.store.putAttestation(att(AGENT_1, "pass"));
    await h.store.putAttestation(att(AGENT_2, "fail"));
    const body = await (
      await h.app.request("/api/v1/witness/jobs/job-1")
    ).json();
    expect(body.witness_agreement).toBe(false);
  });

  it("window closed + pass+inconclusive → agreement null", async () => {
    const h = harness({ deliveredAt: Date.now() - 7_200_000 });
    await h.store.putAttestation(att(AGENT_1, "pass"));
    await h.store.putAttestation(att(AGENT_2, "inconclusive"));
    const body = await (
      await h.app.request("/api/v1/witness/jobs/job-1")
    ).json();
    expect(body.witness_agreement).toBeNull();
  });

  it("opt-out job → flag echoed, witnesses empty", async () => {
    const h = harness({ witnessAllowed: false });
    const res = await h.app.request("/api/v1/witness/jobs/job-1");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.witnessAllowed).toBe(false);
    expect(body.witnesses).toEqual([]);
  });
});

/* ------------------------- witnessAllowed flag ------------------------- */

describe("witnessAllowed flag", () => {
  const app = new Hono().post("/x", async (c) => {
    const r = validateEvaluate(await c.req.json(), c);
    if (r instanceof Response) return r;
    return c.json({ witnessAllowed: r.witnessAllowed });
  });
  const CONTRACT = "0x9999999999999999999999999999999999999999";

  it("EaaS evaluate parses witnessAllowed:false", async () => {
    const res = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        contract: CONTRACT,
        jobId: "7",
        witnessAllowed: false,
      }),
    });
    expect((await res.json()).witnessAllowed).toBe(false);
  });

  it("EaaS evaluate defaults witnessAllowed undefined → true semantics", async () => {
    const res = await app.request("/x", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ contract: CONTRACT, jobId: "7" }),
    });
    const body = await res.json();
    expect(body.witnessAllowed === undefined || body.witnessAllowed === true).toBe(true);
  });

  it("upsertWitnessJob persists flag + merges fields", async () => {
    const dir = mkdtempSync(join(tmpdir(), "wj-"));
    const path = join(dir, "witness-jobs.json");
    await upsertWitnessJob(path, {
      jobId: "j1",
      requesterWallet: "0x3333333333333333333333333333333333333333",
      witnessAllowed: false,
    });
    await upsertWitnessJob(path, {
      jobId: "j1",
      deliveredAt: 123,
      evaluatorVerdict: "fail",
    });
    const raw = JSON.parse(readFileSync(path, "utf8"));
    expect(raw.jobs.j1.witnessAllowed).toBe(false);
    expect(raw.jobs.j1.deliveredAt).toBe(123);
    expect(raw.jobs.j1.evaluatorVerdict).toBe("fail");
    expect(raw.jobs.j1.requesterWallet).toBe(
      "0x3333333333333333333333333333333333333333",
    );
    expect(WITNESS_JOBS_PATH).toContain("witness-jobs.json");
  });
});

/* ------------------------- independence guard -------------------------- */

describe("independence guard (D-185-8)", () => {
  it("attest response contains only the caller's own record", async () => {
    const h = harness();
    expect((await attestAs(h, AGENT_1, WITNESS, "pass")).status).toBe(201);
    const res = await attestAs(h, AGENT_2, OTHER, "fail");
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.attestation.agentId).toBe(AGENT_2);
    expect(body).not.toHaveProperty("witnesses");
  });

  it("/me never exposes other agents' attestations", async () => {
    const h = harness();
    await attestAs(h, AGENT_1, WITNESS, "pass");
    const key = await keyFor(h, AGENT_2);
    const res = await h.app.request("/api/v1/witness/me", {
      headers: bearer(key),
    });
    const body = await res.json();
    expect(body.enrolled).toBe(false);
    expect(JSON.stringify(body)).not.toContain(AGENT_1);
  });
});

/* ----------------------------- drift-gate ------------------------------ */

describe("drift-gate (D-185-4): settle/escrow paths never import witness", () => {
  const libRoot = join(
    dirname(fileURLToPath(import.meta.url)),
    "..",
    "src",
    "server",
    "lib",
  );

  function* walk(dir: string): Generator<string> {
    for (const e of readdirSync(dir)) {
      const p = join(dir, e);
      if (statSync(p).isDirectory()) yield* walk(p);
      else if (p.endsWith(".ts")) yield p;
    }
  }

  it("no lib module outside lib/witness imports witness modules", () => {
    const offenders: string[] = [];
    for (const file of walk(libRoot)) {
      if (file.includes(`${join("lib", "witness")}`)) continue;
      const src = readFileSync(file, "utf8");
      for (const line of src.split("\n")) {
        // Match module specifiers under the witness dir (./witness/…,
        // ../lib/witness/…) — not filenames like error-catalog-witness.
        if (/^\s*import\s/.test(line) && /["'][^"']*\/witness\//.test(line)) {
          offenders.push(`${file}: ${line.trim()}`);
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
