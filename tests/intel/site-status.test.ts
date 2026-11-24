// EPIC-262: GET /api/intel/site/status — site_key-scoped snapshot the
// plugin pulls on a cadence and caches locally. Latest attestation
// (effective_status + signature_valid) + latest report findings.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import { createMemoryAttestationStore } from "../../src/server/lib/intel/attestation";
import { issueAttestation } from "../../src/server/lib/intel/attestation/ops";
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
  findings: [
    {
      rule_id: "wp.exposure.xmlrpc_enabled",
      rule_version: "1.0.0",
      surface: "exposure",
      severity: "high",
      name: "XML-RPC enabled",
      claim: "xmlrpc.php reachable",
      evidence_ids: ["env_1", "env_2"],
      status: "fail",
      reason: "endpoint responds",
    },
  ],
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

describe("GET /api/intel/site/status", () => {
  let app: Hono;
  let siteKey: string;
  let siteId: string;
  let opKey: string;
  let foreignSiteKey: string;
  let attestations: ReturnType<typeof createMemoryAttestationStore>;

  beforeEach(async () => {
    const stores = createMemoryIntelRegistry();
    const registry = createIntelRegistryService(stores);
    attestations = createMemoryAttestationStore();
    const scanJobs = createMemoryScanJobStore();
    const tenant = await registry.createTenant({ slug: "t1", name: "T1" });
    const customer = await registry.createCustomer(tenant.id, { name: "C" });
    const site = await registry.createSite(customer.id, { domains: ["bakery.com"] });
    siteId = site.id;
    siteKey = (await registry.mintSiteKey(site.id)).plaintext;
    opKey = (await inviteOperator(stores, tenant.id, { email: "o@t1.dev", role: "operator" })).plaintext;

    const t2 = await registry.createTenant({ slug: "t2", name: "T2" });
    const c2 = await registry.createCustomer(t2.id, { name: "C2" });
    const s2 = await registry.createSite(c2.id, { domains: ["other.com"] });
    foreignSiteKey = (await registry.mintSiteKey(s2.id)).plaintext;

    const job = jobOf({
      siteId,
      tenantId: tenant.id,
      report: { ...REPORT, site_id: siteId },
    });
    await scanJobs.insert(job);
    await issueAttestation(attestations, job, key, 90, new Date("2026-11-24T12:00:00Z"));

    app = new Hono();
    app.route("/api/intel", createIntelApiRoutes({
      key, registry, registryStores: stores,
      scanJobs, attestations, attestationValidityDays: 90,
    }));
  });

  it("401 on missing / unknown / foreign-invalid site_key", async () => {
    expect((await app.request("/api/intel/site/status")).status).toBe(401);
    expect(
      (await app.request("/api/intel/site/status", {
        headers: { authorization: "Bearer absk_" + "x".repeat(32) },
      })).status,
    ).toBe(401);
  });

  it("returns own-site snapshot: attestation + findings", async () => {
    const res = await app.request("/api/intel/site/status", {
      headers: { authorization: `Bearer ${siteKey}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.site_id).toBe(siteId);
    expect(body.attestation.attestation_id).toMatch(/^att_/);
    expect(body.attestation.effective_status).toBe("active");
    expect(body.attestation.signature_valid).toBe(true);
    expect(body.attestation.scores.readiness.score).toBe(94.7);
    expect(body.report.scan_id).toBe("scan_x");
    expect(body.report.findings).toHaveLength(1);
    expect(body.report.findings[0].rule_id).toBe("wp.exposure.xmlrpc_enabled");
    expect(body.report.findings[0].evidence_count).toBe(2);
  });

  it("foreign site_key sees only its own (empty) status", async () => {
    const res = await app.request("/api/intel/site/status", {
      headers: { authorization: `Bearer ${foreignSiteKey}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.attestation).toBeNull();
    expect(body.report).toBeNull();
  });

  it("operator keys are rejected — this surface is site_key-only", async () => {
    const res = await app.request("/api/intel/site/status", {
      headers: { authorization: `Bearer ${opKey}` },
    });
    expect(res.status).toBe(401);
  });
});
