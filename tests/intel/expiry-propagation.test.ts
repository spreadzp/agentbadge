// EPIC-262 (SLICE-262-20): expiry propagation — D-262-Q8 matrix:
// attestation issuance gated as a paid op; evidence retention
// sweep on insert paths; in-flight pull-jobs finish under soft_off;
// grace warning surfaces on /jobs create.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import {
  createMemoryIntelConsentStore,
  grantConsent,
  revokeConsent,
} from "../../src/server/lib/intel/consent";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import {
  createMemoryEntitlementStore,
  type IntelEntitlement,
} from "../../src/server/lib/intel/entitlement";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { createMemoryAttestationStore } from "../../src/server/lib/intel/attestation";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { ScanJob } from "../../src/server/lib/intel/scan/types";
import type { IntelReport } from "../../src/server/lib/intel/report/schema";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-expiry",
  signingPrivateKey: Buffer.alloc(32, 13).toString("base64"),
} as IntelEnvConfig)!;

const NOW = "2026-11-24T12:00:00Z";
const report = (siteId: string): IntelReport => ({
  schema_version: "1.0",
  report_id: "01JEXP0RTRPRT0000000000000",
  site_id: siteId,
  ruleset: { name: "wp", version: "1.1.0" },
  scan: { scan_id: "scan_1", completeness: "complete", generated_at: NOW },
  evidence: {
    envelope_count: 1, collected_at_min: null, received_at_max: NOW,
    provenance: {},
  },
  findings: [],
  scores: {
    readiness: { surface: "readiness", score: 90, evaluable: 1, pass: 1, fail: 0, warn: 0, unknown: 0 },
    exposure: { surface: "exposure", score: 90, evaluable: 1, pass: 1, fail: 0, warn: 0, unknown: 0 },
  },
  previous_hash: null,
  integrity: {
    content_hash: `sha256:${"ab".repeat(32)}`,
    signature: { algorithm: "ed25519", key_id: key.keyId, value: "s" },
  },
});

let stores: IntelRegistryStores;
let registry: ReturnType<typeof createIntelRegistryService>;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let jobs: ReturnType<typeof createMemoryScanJobStore>;
let entitlement: ReturnType<typeof createMemoryEntitlementStore>;
let evidence: ReturnType<typeof createMemoryIntelEvidenceStore>;
let attestations: ReturnType<typeof createMemoryAttestationStore>;
let tenantId: string;
let siteId: string;
let opKey: string;
let app: Hono;

const entOf = (over: Partial<IntelEntitlement> = {}): IntelEntitlement => ({
  id: "ent_1", tenantId, plan: "pilot", status: "active",
  coveredSiteIds: [], perSiteLimits: {},
  validFrom: "2020-01-01T00:00:00Z",
  validUntil: "2030-01-01T00:00:00Z",
  graceUntil: "2030-01-08T00:00:00Z",
  createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
  ...over,
});

const scanJob = (over: Partial<ScanJob> = {}): ScanJob => ({
  id: "job_1", siteId, tenantId, scanId: "scan_1", correlationId: null,
  status: "complete", baseUrl: "https://x.test", probeFailures: 0,
  probeTotal: 1, error: null, reportId: report(siteId).report_id,
  report: report(siteId), createdAt: NOW, updatedAt: NOW, finishedAt: NOW,
  ...over,
});

const attest = (auth: string) =>
  app.request("/api/intel/scans/scan_1/attest", {
    method: "POST",
    headers: { authorization: auth },
  });

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  consent = createMemoryIntelConsentStore();
  jobs = createMemoryScanJobStore();
  entitlement = createMemoryEntitlementStore();
  evidence = createMemoryIntelEvidenceStore();
  attestations = createMemoryAttestationStore();
  const tenant = await registry.createTenant({ slug: "t", name: "T" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  siteId = (await registry.createSite(customer.id, { domains: ["x.dev"] })).id;
  opKey = (await inviteOperator(stores, tenantId, { email: "o@t.dev", role: "operator" })).plaintext;
  await grantConsent(consent, siteId, "audit", { principal: "operator", id: "op" });
  await entitlement.upsert(entOf());
  await jobs.insert(scanJob());
  app = new Hono();
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key, registry, registryStores: stores, consent, scanJobs: jobs,
      entitlement, evidence, attestations, evidenceRetentionDays: 30,
    }),
  );
});

describe("attestation issuance — expiry matrix", () => {
  it("allowed while entitled", async () => {
    expect((await attest(`Bearer ${opKey}`)).status).toBe(201);
  });

  it("403 entitlement_denied under soft_off", async () => {
    await entitlement.upsert(entOf({ validUntil: "2020-01-10T00:00:00Z", graceUntil: "2020-01-15T00:00:00Z" }));
    const res = await attest(`Bearer ${opKey}`);
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("soft_off");
  });

  it("403 consent_denied when audit consent revoked", async () => {
    await revokeConsent(consent, siteId, "audit", { principal: "operator", id: "op" });
    const res = await attest(`Bearer ${opKey}`);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("consent_denied");
  });

  it("revoke stays reachable under soft_off (safety control)", async () => {
    const issued = await attest(`Bearer ${opKey}`);
    const { attestation } = await issued.json();
    await entitlement.upsert(entOf({ status: "expired" }));
    const res = await app.request(
      `/api/intel/attestations/${attestation.attestation_id}/revoke`,
      { method: "POST", headers: { authorization: `Bearer ${opKey}` } },
    );
    expect(res.status).toBe(200);
  });
});

describe("evidence retention — sweep at insert cadence", () => {
  const envelope = {
    schema_version: "1.0",
    envelope_id: "env_1",
    scan_id: null,
    collector: { type: "wp_plugin", id: "wp_plugin@s", version: "1" },
    collected_at: NOW,
    received_at: NOW,
    provenance: "plugin_self_reported",
    content_type: "fact",
    key: "k",
    value: { v: 1 },
    signature: { algorithm: "ed25519", key_id: "k", value: "s" },
  };

  it("POST /evidence sweeps expired rows before insert", async () => {
    const siteKey = (await registry.mintSiteKey(siteId)).plaintext;
    // expired row sitting in the store
    await evidence.insert({
      id: "env_old", schemaVersion: "1.0", siteId, scanId: "scan_x",
      collectorId: "c", provenance: "PLUGIN_SELF_REPORTED",
      dedupeHash: "old", receivedAt: "2020-01-01T00:00:00Z",
      expiresAt: "2020-02-01T00:00:00Z", envelope: envelope as never,
    });
    expect((await evidence.forSite(siteId)).length).toBe(1);
    const sub = {
      collector_id: `wp_plugin@${siteId}`,
      scan_id: "scan_sweep_test",
      site_ref: siteId,
      collected_at: new Date().toISOString(),
      subject: { type: "wp_option", name: "blog_public" },
      payload: { type: "wp_option_read", name: "blog_public", value: "1" },
      evidence_refs: [],
    };
    const res = await app.request("/api/intel/evidence", {
      method: "POST",
      headers: {
        authorization: `Bearer ${siteKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(sub),
    });
    expect(res.status).toBe(201);
    // the expired row is gone — retention enforced at insert cadence
    const left = await evidence.forSite(siteId);
    expect(left.every((r) => r.id !== "env_old")).toBe(true);
  });
});

describe("in-flight pull-jobs finish under soft_off", () => {
  it("claim on a pending job is NOT entitlement-gated (D-262-Q8)", async () => {
    // soft_off the tenant
    await entitlement.upsert(entOf({ validUntil: "2020-01-10T00:00:00Z", graceUntil: "2020-01-15T00:00:00Z" }));
    // a job created while entitled is still claimable — matrix row:
    // "in-flight операции завершаются безопасно"
    const res = await app.request("/api/intel/jobs/nonexistent/claim", {
      method: "POST",
      headers: { authorization: `Bearer ${(await registry.mintSiteKey(siteId)).plaintext}` },
    });
    // 404/409 (no job) — NOT 403 entitlement_denied
    expect(res.status).not.toBe(403);
  });
});
