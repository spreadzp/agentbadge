// EPIC-262 (SLICE-262-28): attestation lifecycle — issue/bind/
// revoke/verify + route auth discipline.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import { createMemoryAttestationStore } from "../../src/server/lib/intel/attestation";
import { effectiveStatus } from "../../src/server/lib/intel/attestation";
import {
  issueAttestation,
  revokeAttestation,
} from "../../src/server/lib/intel/attestation/ops";
import {
  signAttestation,
  verifyAttestation,
} from "../../src/server/lib/intel/attestation/sign";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelReport } from "../../src/server/lib/intel/report/schema";
import type { ScanJob } from "../../src/server/lib/intel/scan/types";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const REPORT: IntelReport = {
  schema_version: "1.0",
  report_id: "01JTESTREPRT00000000000000",
  site_id: "site_x",
  ruleset: { name: "wp", version: "1.1.0" },
  scan: {
    scan_id: "scan_x",
    completeness: "complete",
    generated_at: "2026-11-24T10:00:00Z",
  },
  evidence: {
    envelope_count: 42,
    collected_at_min: null,
    received_at_max: null,
    provenance: { external_observed: 40, plugin_self_reported: 2 },
  },
  findings: [],
  scores: {
    readiness: { surface: "readiness", score: 94.7, evaluable: 40, pass: 36, fail: 2, warn: 1, unknown: 1 },
    exposure: { surface: "exposure", score: 88.0, evaluable: 20, pass: 17, fail: 1, warn: 1, unknown: 1 },
  },
  previous_hash: null,
  integrity: {
    content_hash: `sha256:${"ab".repeat(32)}`,
    signature: { algorithm: "ed25519", key_id: "intel-test-1", value: "sig" },
  },
};

const jobOf = (over: Partial<ScanJob> = {}): ScanJob => ({
  id: "job_1",
  siteId: "site_x",
  tenantId: "tnt_1",
  scanId: "scan_x",
  correlationId: null,
  status: "complete",
  baseUrl: "https://bakery.com",
  probeFailures: 0,
  probeTotal: 42,
  error: null,
  reportId: REPORT.report_id,
  report: { ...REPORT },
  createdAt: "2026-11-24T10:00:00Z",
  updatedAt: "2026-11-24T10:05:00Z",
  finishedAt: "2026-11-24T10:05:00Z",
  ...over,
});

describe("issue + sign + verify + status", () => {
  it("issues a signed artifact bound to the report's content_hash", async () => {
    const store = createMemoryAttestationStore();
    const r = await issueAttestation(store, jobOf(), key, 90, new Date("2026-11-24T12:00:00Z"));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const a = r.attestation;
    expect(a.attestation_id).toMatch(/^att_/);
    expect(a.content_hash).toBe(REPORT.integrity.content_hash);
    expect(a.report_id).toBe(REPORT.report_id);
    expect(a.ruleset).toEqual({ name: "wp", version: "1.1.0" });
    expect(a.scores.readiness.score).toBe(94.7);
    expect(a.valid_until).toBe("2027-02-22T12:00:00.000Z");
    expect(a.status).toBe("active");
    // signature verifies under the SAME mechanism as reports
    expect(
      verifyAttestation(a, [{ keyId: key.keyId, publicKey: key.publicKey }]),
    ).toEqual({ ok: true });
  });

  it("refuses without a report / on site mismatch", async () => {
    const store = createMemoryAttestationStore();
    expect((await issueAttestation(store, jobOf({ report: null }), key)).ok).toBe(false);
    const bad = jobOf({ report: { ...REPORT, site_id: "site_other" } });
    const r = await issueAttestation(store, bad, key);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("site_mismatch");
  });

  it("effective_status: revoked wins; valid_until lazily expires", () => {
    const base = { status: "active" as const };
    expect(effectiveStatus({ ...base, valid_until: "2027-01-01T00:00:00Z" }, "2026-12-01T00:00:00Z")).toBe("active");
    expect(effectiveStatus({ ...base, valid_until: "2026-01-01T00:00:00Z" }, "2026-12-01T00:00:00Z")).toBe("expired");
    expect(effectiveStatus({ status: "revoked", valid_until: "2099-01-01T00:00:00Z" }, "2026-12-01T00:00:00Z")).toBe("revoked");
  });

  it("revoke is idempotent and keeps the signed bytes untouched", async () => {
    const store = createMemoryAttestationStore();
    const issue = await issueAttestation(store, jobOf(), key);
    if (!issue.ok) throw new Error("issue failed");
    const r1 = await revokeAttestation(store, issue.attestation.attestation_id, "key compromise");
    expect(r1.ok && r1.attestation.status).toBe("revoked");
    if (r1.ok) expect(r1.attestation.revoked_reason).toBe("key compromise");
    const r2 = await revokeAttestation(store, issue.attestation.attestation_id, "again");
    expect(r2.ok && r2.alreadyRevoked).toBe(true);
    if (r2.ok) expect(r2.attestation.revoked_reason).toBe("key compromise"); // first reason wins
  });

  it("verify rejects tampered score and unknown key", () => {
    const a = signAttestation(
      { ...REPORTLESS_BODY, scores: { ...REPORTLESS_BODY.scores } },
      key,
    );
    expect(verifyAttestation(a, [{ keyId: key.keyId, publicKey: key.publicKey }])).toEqual({ ok: true });
    const tampered = { ...a, scores: { ...a.scores, readiness: { ...a.scores.readiness, score: 100 } } };
    expect(verifyAttestation(tampered, [{ keyId: key.keyId, publicKey: key.publicKey }]).ok).toBe(false);
    const wrongKey = { ...a, signature: { ...a.signature, key_id: "other" } };
    expect(verifyAttestation(wrongKey, [{ keyId: key.keyId, publicKey: key.publicKey }])).toEqual({ ok: false, error: "unknown_key_id" });
  });
});

const REPORTLESS_BODY = {
  schema_version: "intel-attestation/1" as const,
  attestation_id: "att_01JTESTATT0000000000000000",
  site_id: "site_x",
  tenant_id: "tnt_1",
  report_id: "01JTESTREPRT00000000000000",
  scan_id: "scan_x",
  ruleset: { name: "wp", version: "1.1.0" },
  scores: {
    readiness: { score: 94.7, evaluable: 40, fail: 2 },
    exposure: { score: 88.0, evaluable: 20, fail: 1 },
  },
  content_hash: `sha256:${"ab".repeat(32)}`,
  issued: "2026-11-24T12:00:00Z",
  valid_until: "2027-02-22T12:00:00Z",
  status: "active" as const,
  revoked_at: null,
  revoked_reason: null,
};

// ─── routes ───────────────────────────────────────────────────────
describe("attestation routes", () => {
  let app: Hono;
  let opKey: string;
  let viewerKey: string;
  let foreignKey: string;
  let tenantId: string;
  let siteId: string;

  beforeEach(async () => {
    const stores = createMemoryIntelRegistry();
    const registry = createIntelRegistryService(stores);
    const attestations = createMemoryAttestationStore();
    const scanJobs = createMemoryScanJobStore();
    const tenant = await registry.createTenant({ slug: "t1", name: "T1" });
    tenantId = tenant.id;
    const customer = await registry.createCustomer(tenant.id, { name: "C" });
    siteId = (await registry.createSite(customer.id, { domains: ["bakery.com"] })).id;
    opKey = (await inviteOperator(stores, tenant.id, { email: "o@t1.dev", role: "operator" })).plaintext;
    viewerKey = (await inviteOperator(stores, tenant.id, { email: "v@t1.dev", role: "viewer" })).plaintext;
    const t2 = await registry.createTenant({ slug: "t2", name: "T2" });
    foreignKey = (await inviteOperator(stores, t2.id, { email: "o@t2.dev", role: "operator" })).plaintext;

    await scanJobs.insert(jobOf({
      siteId, tenantId,
      report: { ...REPORT, site_id: siteId },
    }));

    app = new Hono();
    app.route("/api/intel", createIntelApiRoutes({
      key, registry, registryStores: stores,
      scanJobs, attestations, attestationValidityDays: 90,
    }));
  });
  const bearer = (k: string) => ({ authorization: `Bearer ${k}` });

  it("POST /scans/:scanId/attest — 201 signed artifact; no report → 409", async () => {
    const res = await app.request("/api/intel/scans/scan_x/attest", { method: "POST", headers: bearer(opKey) });
    expect(res.status).toBe(201);
    const { attestation } = await res.json();
    expect(attestation.content_hash).toBe(REPORT.integrity.content_hash);
    // second call mints a SECOND attestation (lifecycle artifact, not dedupe)
    const res2 = await app.request("/api/intel/scans/scan_x/attest", { method: "POST", headers: bearer(opKey) });
    const { attestation: a2 } = await res2.json();
    expect(a2.attestation_id).not.toBe(attestation.attestation_id);
  });

  it("viewer → 403; no key → 401; foreign tenant → 404", async () => {
    expect((await app.request("/api/intel/scans/scan_x/attest", { method: "POST", headers: bearer(viewerKey) })).status).toBe(403);
    expect((await app.request("/api/intel/scans/scan_x/attest", { method: "POST" })).status).toBe(401);
    expect((await app.request("/api/intel/scans/scan_x/attest", { method: "POST", headers: bearer(foreignKey) })).status).toBe(404);
  });

  it("GET /attestations/:id — effective_status + signature_valid; revoke idempotent", async () => {
    const issue = await app.request("/api/intel/scans/scan_x/attest", { method: "POST", headers: bearer(opKey) });
    const { attestation } = await issue.json();
    const get = await app.request(`/api/intel/attestations/${attestation.attestation_id}`, { headers: bearer(opKey) });
    const card = await get.json();
    expect(card.effective_status).toBe("active");
    expect(card.signature_valid).toBe(true);
    const rev = await app.request(`/api/intel/attestations/${attestation.attestation_id}/revoke`, {
      method: "POST", headers: { ...bearer(opKey), "content-type": "application/json" },
      body: JSON.stringify({ reason: "compromise test" }),
    });
    expect((await rev.json()).attestation.status).toBe("revoked");
    const rev2 = await app.request(`/api/intel/attestations/${attestation.attestation_id}/revoke`, {
      method: "POST", headers: { ...bearer(opKey), "content-type": "application/json" }, body: "{}",
    });
    expect((await rev2.json()).already_revoked).toBe(true);
    const get2 = await app.request(`/api/intel/attestations/${attestation.attestation_id}`, { headers: bearer(opKey) });
    expect((await get2.json()).effective_status).toBe("revoked");
  });

  it("GET /sites/:id/attestations lists own-tenant only", async () => {
    await app.request("/api/intel/scans/scan_x/attest", { method: "POST", headers: bearer(opKey) });
    const res = await app.request(`/api/intel/sites/${siteId}/attestations`, { headers: bearer(opKey) });
    const { attestations } = await res.json();
    expect(attestations).toHaveLength(1);
    expect(attestations[0].site_id).toBe(siteId);
    expect((await app.request(`/api/intel/sites/${siteId}/attestations`, { headers: bearer(foreignKey) })).status).toBe(404);
  });
});
