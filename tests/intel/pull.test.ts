// EPIC-262 (SLICE-262-16): pull-protocol ops — lifecycle, lease
// generation binding, idempotency, consent mid-flight, and the three
// advisor gates G1/G3 (G2 is plugin-side).
import { describe, it, expect, beforeEach } from "vitest";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import {
  createMemoryIntelConsentStore,
  grantConsent,
  revokeConsent,
  type IntelConsentStore,
} from "../../src/server/lib/intel/consent";
import {
  createMemoryPullJobStore,
  createMemorySecurityEventStore,
  createPullJob,
  claimPullJob,
  submitPullResult,
  peekPullJobs,
  deriveJobsKey,
  verifyJobBody,
  jobSignedBody,
  type PullDeps,
  type PullJob,
} from "../../src/server/lib/intel/pull";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import {
  runScanJob,
  SCAN_PLAN,
  type ScanJob,
  type ScanFetch,
  type ScanObservation,
} from "../../src/server/lib/intel/scan";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import type { IntelEnvConfig } from "../../src/config/env";

const signKey = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;
const jobsKey = deriveJobsKey(signKey);

const SITE = "site_t";
const NOW = new Date("2026-11-24T12:00:00.000Z");
let clock = NOW;

let consent: IntelConsentStore;
let deps: PullDeps;

beforeEach(async () => {
  clock = new Date(NOW);
  consent = createMemoryIntelConsentStore();
  await grantConsent(consent, SITE, "inside_diagnostics", {
    principal: "operator",
    id: "op_1",
  });
  deps = {
    pullJobs: createMemoryPullJobStore(),
    securityEvents: createMemorySecurityEventStore(),
    evidence: createMemoryIntelEvidenceStore(),
    consent,
    jobsKey,
    signKey,
    now: () => clock,
  };
});

const createJob = async (
  probeId = "const_read",
  params: Record<string, unknown> = { name: "WP_DEBUG" },
) =>
  createPullJob(deps, {
    siteId: SITE,
    tenantId: "tnt_t",
    probeId,
    params,
  });

describe("pull-job create", () => {
  it("signs canonical body with the intel:jobs sub-key", async () => {
    const r = await createJob();
    expect(r.ok).toBe(true);
    const j = (r as { ok: true; job: PullJob }).job;
    expect(j.sig.algorithm).toBe("ed25519");
    expect(j.keyId).toBe(jobsKey.keyId);
    // domain separation: the envelope key does NOT verify job sigs
    expect(verifyJobBody(jobSignedBody(j), j.sig, signKey.publicKey)).toBe(false);
    expect(verifyJobBody(jobSignedBody(j), j.sig, jobsKey.publicKey)).toBe(true);
    // tampered body fails
    expect(
      verifyJobBody(
        { ...jobSignedBody(j), params: { name: "DB_PASSWORD" } },
        j.sig,
        jobsKey.publicKey,
      ),
    ).toBe(false);
  });

  it("rejects params outside the whitelist", async () => {
    expect((await createJob("const_read", { name: "DB_PASSWORD" })).ok).toBe(false);
    expect((await createJob("unknown_probe", {})).ok).toBe(false);
    expect((await createJob("phpinfo_summary", { evil: 1 })).ok).toBe(false);
    expect((await createJob("option_read", { name: "siteurl" })).ok).toBe(true);
  });
});

describe("claim", () => {
  it("denies claim without inside_diagnostics consent", async () => {
    const r = await createJob();
    const j = (r as { ok: true; job: PullJob }).job;
    await revokeConsent(consent, SITE, "inside_diagnostics", {
      principal: "operator",
      id: "op_1",
    });
    const c = await claimPullJob(deps, j.id, SITE);
    expect(c).toEqual({ ok: false, reason: "consent_denied" });
  });

  it("issues a lease + generation; retry returns the SAME context (R3)", async () => {
    const r = await createJob();
    const j = (r as { ok: true; job: PullJob }).job;
    const c1 = await claimPullJob(deps, j.id, SITE);
    expect(c1.ok).toBe(true);
    const job1 = (c1 as { ok: true; job: PullJob }).job;
    expect(job1.leaseGeneration).toBe(1);
    expect(job1.leaseToken).toMatch(/^lt_/);

    const c2 = await claimPullJob(deps, j.id, SITE);
    const job2 = (c2 as { ok: true; job: PullJob }).job;
    expect((c2 as { retry: boolean }).retry).toBe(true);
    expect(job2.leaseToken).toBe(job1.leaseToken);
    expect(job2.leaseGeneration).toBe(1);
  });

  it("expired lease requeues with reclaimCount; >maxReclaims expires", async () => {
    const r = await createJob();
    const j = (r as { ok: true; job: PullJob }).job;
    for (let gen = 1; gen <= 3; gen++) {
      const c = await claimPullJob(deps, j.id, SITE);
      const job = (c as { ok: true; job: PullJob }).job;
      clock = new Date(Date.parse(job.leaseExpiresAt!) + 1); // lease lapses
      const next = await claimPullJob(deps, j.id, SITE);
      if (gen <= 2) {
        expect(next.ok).toBe(true);
        const nj = (next as { ok: true; job: PullJob }).job;
        expect(nj.reclaimCount).toBe(gen);
        expect(nj.leaseGeneration).toBe(gen + 1);
      } else {
        expect(next.ok).toBe(false);
      }
    }
    const final = await deps.pullJobs.byId(j.id);
    expect(final!.status).toBe("expired");
    expect(final!.reclaimCount).toBe(3);
  });
});

describe("result submit", () => {
  const claimJob = async (probeId = "const_read", params = { name: "WP_DEBUG" }) => {
    const r = await createJob(probeId, params);
    const j = (r as { ok: true; job: PullJob }).job;
    const c = await claimPullJob(deps, j.id, SITE);
    return (c as { ok: true; job: PullJob }).job;
  };
  const validResult = { name: "WP_DEBUG", defined: true, value: true };

  it("accepts a valid result → done + PLUGIN_SELF_REPORTED envelope", async () => {
    const j = await claimJob();
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: validResult,
    }, "site:" + SITE);
    expect(r.ok).toBe(true);
    const row = await deps.pullJobs.byId(j.id);
    expect(row!.status).toBe("done");
    expect(row!.resultEnvelopeId).toMatch(/^env_/);
    const all = await deps.evidence.forSite(SITE);
    expect(all).toHaveLength(1);
    expect(all[0].provenance).toBe("PLUGIN_SELF_REPORTED");
    expect(all[0].envelope.payload).toMatchObject({
      type: "wp_option_read",
      name: "WP_DEBUG",
      value: true,
    });
  });

  it("G1: stale lease (old generation) cannot submit — reclaim wins", async () => {
    const j = await claimJob();
    const oldToken = j.leaseToken!;
    clock = new Date(Date.parse(j.leaseExpiresAt!) + 1); // lease lapses
    const reclaim = await claimPullJob(deps, j.id, SITE);
    const newer = (reclaim as { ok: true; job: PullJob }).job;
    expect(newer.leaseGeneration).toBe(j.leaseGeneration + 1);
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: oldToken,
      result: validResult,
    }, "site:" + SITE);
    expect(r.ok).toBe(false);
    expect((r as { http: number }).http).toBe(409);
    expect((r as { reason: string }).reason).toBe("lease_expired");
    const evs = await deps.securityEvents.forSite(SITE);
    expect(evs.some((e) => e.eventType === "lease_stale")).toBe(true);
  });

  it("lease token mismatch on live job → 409 + security event", async () => {
    const j = await claimJob();
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: "lt_forged",
      result: validResult,
    }, "site:" + SITE);
    expect((r as { http: number }).http).toBe(409);
    const evs = await deps.securityEvents.forSite(SITE);
    expect(evs).toHaveLength(1);
    expect(evs[0].eventType).toBe("lease_stale");
  });

  it("consent revoked mid-flight → result rejected 403", async () => {
    const j = await claimJob();
    await revokeConsent(consent, SITE, "inside_diagnostics", {
      principal: "operator",
      id: "op_1",
    });
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: validResult,
    }, "site:" + SITE);
    expect((r as { http: number }).http).toBe(403);
    expect((await deps.pullJobs.byId(j.id))!.status).toBe("claimed");
  });

  it("idempotent replay: same canonical body → same envelope, no dup", async () => {
    const j = await claimJob();
    const r1 = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: validResult,
    }, "site:" + SITE);
    const r2 = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: { ...validResult },
    }, "site:" + SITE);
    expect(r2.ok).toBe(true);
    expect((r2 as { deduplicated: boolean }).deduplicated).toBe(true);
    expect((r2 as { envelopeId: string }).envelopeId).toBe(
      (r1 as { envelopeId: string }).envelopeId,
    );
    expect(await deps.evidence.forSite(SITE)).toHaveLength(1);
  });

  it("conflicting body on done job → 409 + security event", async () => {
    const j = await claimJob();
    await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: validResult,
    }, "site:" + SITE);
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: { ...validResult, value: false },
    }, "site:" + SITE);
    expect((r as { http: number }).http).toBe(409);
    expect((r as { reason: string }).reason).toBe("conflict");
    const evs = await deps.securityEvents.forSite(SITE);
    expect(evs.some((e) => e.eventType === "result_conflict")).toBe(true);
    // original envelope untouched
    expect((await deps.pullJobs.byId(j.id))!.result).toEqual(validResult);
  });

  it("malformed result → 400 (never an envelope)", async () => {
    const j = await claimJob();
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: { unexpected: "shape" },
    }, "site:" + SITE);
    expect((r as { http: number }).http).toBe(400);
    expect(await deps.evidence.forSite(SITE)).toHaveLength(0);
  });

  it("job TTL lapsed → 409", async () => {
    const j = await claimJob();
    clock = new Date(Date.parse(j.exp) + 1);
    const r = await submitPullResult(deps, j.id, SITE, {
      lease_token: j.leaseToken,
      result: validResult,
    }, "site:" + SITE);
    expect((r as { http: number }).http).toBe(409);
  });
});

describe("peek", () => {
  it("is read-only and lists pending jobs in wire shape", async () => {
    const r = await createJob();
    const j = (r as { ok: true; job: PullJob }).job;
    const peek = await peekPullJobs(deps, SITE);
    expect(peek).toHaveLength(1);
    expect(peek[0].job_id).toBe(j.id);
    expect(peek[0].sig.value).toBe(j.sig.value);
    // expired jobs drop out of peek
    clock = new Date(Date.parse(j.exp) + 1);
    expect(await peekPullJobs(deps, SITE)).toHaveLength(0);
  });
});

// ─── gate G3: late evidence cannot mutate a signed report ─────────
describe("G3 — report immutability", () => {
  const canned = (status = 200, body = "ok"): ScanObservation => ({
    status,
    headers: {},
    bodyText: body,
    resolvedIp: "203.0.113.5",
  });
  const happyFetch: ScanFetch = async () => canned();

  it("pull result arriving AFTER report signs → envelope only, report bytes identical", async () => {
    const scanJobs = createMemoryScanJobStore();
    const scanJob: ScanJob = {
      id: "job_s1",
      siteId: SITE,
      tenantId: "tnt_t",
      scanId: "scan_late",
      status: "queued",
      baseUrl: "https://bakery.com",
      probeFailures: 0,
      probeTotal: SCAN_PLAN.length,
      error: null,
      reportId: null,
      report: null,
      createdAt: NOW.toISOString(),
      updatedAt: NOW.toISOString(),
      finishedAt: null,
    };
    const done = await runScanJob(scanJob, {
      fetch: happyFetch,
      evidence: deps.evidence, // shared with pull deps — same store
      jobs: scanJobs,
      key: signKey,
      ruleset: INTEL_WP_PROFILE_V1,
      now: () => clock,
    });
    expect(done.report).not.toBeNull();
    const hashBefore = done.report!.integrity.content_hash;
    const rulesBefore = JSON.stringify(done.report!.findings);

    // a pull-job result lands AFTER the report was signed
    clock = new Date(NOW.getTime() + 60_000);
    const r = await createPullJob(deps, {
      siteId: SITE,
      tenantId: "tnt_t",
      probeId: "const_read",
      params: { name: "WP_DEBUG" },
      scanId: "scan_late",
    });
    const j = (r as { ok: true; job: PullJob }).job;
    const c = await claimPullJob(deps, j.id, SITE);
    const claimed = (c as { ok: true; job: PullJob }).job;
    const sub = await submitPullResult(deps, j.id, SITE, {
      lease_token: claimed.leaseToken,
      result: { name: "WP_DEBUG", defined: true, value: true },
    }, "site:" + SITE);
    expect(sub.ok).toBe(true);

    // the signed report is byte-identical; the fact lives as an
    // envelope for the NEXT scan — never a retro-mutation
    const after = await scanJobs.byId(scanJob.id);
    expect(after!.report!.integrity.content_hash).toBe(hashBefore);
    expect(JSON.stringify(after!.report!.findings)).toBe(rulesBefore);
    const siteEvidence = await deps.evidence.forSite(SITE);
    expect(
      siteEvidence.some(
        (e) =>
          e.provenance === "PLUGIN_SELF_REPORTED" &&
          e.envelope.payload.type === "wp_option_read" &&
          (e.envelope.payload as { name?: string }).name === "WP_DEBUG",
      ),
    ).toBe(true);
  });
});
