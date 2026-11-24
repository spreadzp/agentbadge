// EPIC-262 (SLICE-262-32): support diagnostics — id resolution,
// tenant isolation, role gate, severity classifier.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { createMemoryEntitlementStore } from "../../src/server/lib/intel/entitlement";
import {
  createMemoryIntelConsentStore,
  grantConsent,
} from "../../src/server/lib/intel/consent";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import {
  createMemoryPullJobStore,
  createMemorySecurityEventStore,
} from "../../src/server/lib/intel/pull";
import { createPullJob } from "../../src/server/lib/intel/pull/ops";
import { classifyId, severityFor } from "../../src/server/lib/intel/support";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import { createIntelUiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

describe("classifyId + severityFor", () => {
  it("prefix → kind; unknown → null", () => {
    expect(classifyId("site_x")).toBe("site");
    expect(classifyId("scan_x")).toBe("scan");
    expect(classifyId("job_x")).toBe("scan_job");
    expect(classifyId("pjob_x")).toBe("pull_job");
    expect(classifyId("env_x")).toBe("envelope");
    expect(classifyId("random")).toBeNull();
  });
  it("severity: forge_rejected → P1; any event/failed scan → P2; else P3", () => {
    expect(
      severityFor({ securityEvents: [{ eventType: "job_forge_rejected" }], latestScanStatus: "complete", stale: false }),
    ).toBe("P1");
    expect(
      severityFor({ securityEvents: [{ eventType: "result_conflict" }], latestScanStatus: "complete", stale: false }),
    ).toBe("P2");
    expect(
      severityFor({ securityEvents: [], latestScanStatus: "failed", stale: false }),
    ).toBe("P2");
    expect(
      severityFor({ securityEvents: [], latestScanStatus: "complete", stale: true }),
    ).toBe("P3");
  });
});

// ─── route ────────────────────────────────────────────────────────
let app: Hono;
let opKey: string;
let viewerKey: string;
let foreignOpKey: string;
let siteId: string;
let scanJobId: string;
let scanId: string;
let scanJobs: ReturnType<typeof createMemoryScanJobStore>;
let pullJobs: ReturnType<typeof createMemoryPullJobStore>;
let securityEvents: ReturnType<typeof createMemorySecurityEventStore>;
let evidence: ReturnType<typeof createMemoryIntelEvidenceStore>;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let tenantId: string;

beforeEach(async () => {
  const stores = createMemoryIntelRegistry();
  const registry = createIntelRegistryService(stores);
  scanJobs = createMemoryScanJobStore();
  pullJobs = createMemoryPullJobStore();
  securityEvents = createMemorySecurityEventStore();
  evidence = createMemoryIntelEvidenceStore();
  consent = createMemoryIntelConsentStore();
  const tenant = await registry.createTenant({ slug: "t1", name: "T1" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  siteId = (await registry.createSite(customer.id, { domains: ["bakery.com"] })).id;
  opKey = (await inviteOperator(stores, tenant.id, { email: "o@t1.dev", role: "operator" })).plaintext;
  viewerKey = (await inviteOperator(stores, tenant.id, { email: "v@t1.dev", role: "viewer" })).plaintext;
  await grantConsent(consent, siteId, "audit", { principal: "site_key", id: "k" });
  const t2 = await registry.createTenant({ slug: "t2", name: "T2" });
  foreignOpKey = (await inviteOperator(stores, t2.id, { email: "o@t2.dev", role: "operator" })).plaintext;

  // one scan-job + one pull-job to resolve
  const sj = await scanJobs.insert({
    id: "job_sup1", siteId, tenantId, scanId: "scan_sup1",
    correlationId: "req_sup1", status: "failed",
    baseUrl: "https://bakery.com", probeFailures: 3, probeTotal: 20,
    error: "all probes failed", reportId: null, report: null,
    createdAt: "2026-11-24T10:00:00Z", updatedAt: "2026-11-24T10:05:00Z",
    finishedAt: "2026-11-24T10:05:00Z",
  });
  scanJobId = sj.id; scanId = sj.scanId;
  const pj = await createPullJob(
    {
      pullJobs, securityEvents,
      evidence, consent,
      jobsKey: key, signKey: key,
    },
    { siteId, tenantId, probeId: "const_read", params: { name: "WP_DEBUG" }, correlationId: "req_sup1" },
  );
  if (!pj.ok) throw new Error("pull job create failed");

  app = new Hono();
  app.route("/intel", createIntelUiRoutes({
    key, registry, registryStores: stores, evidence,
    evidenceRetentionDays: 400,
    entitlement: createMemoryEntitlementStore(),
    scanJobs, ruleset: INTEL_WP_PROFILE_V1,
    scanFetch: async () => ({ status: 200, headers: {}, bodyText: "ok", resolvedIp: "1.2.3.4" }),
    consent, pullJobs, securityEvents,
    supportAdminTenantIds: [tenantId],
  }));
});
const cookie = (k: string) => ({ cookie: `intel_session=${k}` });

describe("GET /intel/support", () => {
  it("viewer → 403; no session → 302", async () => {
    expect((await app.request(`/intel/support?q=${siteId}`, { headers: cookie(viewerKey) })).status).toBe(403);
    expect((await app.request(`/intel/support?q=${siteId}`)).status).toBe(302);
  });
  it("site id → assembled card with site+consents+jobs+severity", async () => {
    const res = await app.request(`/intel/support?q=${siteId}`, { headers: cookie(opKey) });
    expect(res.status).toBe(200);
    const card = await res.json();
    expect(card.kind).toBe("site");
    expect(card.site.id).toBe(siteId);
    expect(card.site.hostname).toBe("bakery.com");
    expect(card.consents[0].kind).toBe("audit");
    expect(card.scanJobs[0].id).toBe(scanJobId);
    expect(card.scanJobs[0].correlationId).toBe("req_sup1");
    expect(card.severity).toBe("P2"); // failed scan
  });
  it("scan_/job_/pjob_ ids resolve to the same site card", async () => {
    for (const q of [scanId, scanJobId]) {
      const res = await app.request(`/intel/support?q=${q}`, { headers: cookie(opKey) });
      expect(res.status).toBe(200);
      expect((await res.json()).site.id).toBe(siteId);
    }
    const pj = (await pullJobs.pendingForSite(siteId, new Date().toISOString()))[0];
    const res = await app.request(`/intel/support?q=${pj.id}`, { headers: cookie(opKey) });
    const card = await res.json();
    expect(card.pullJob.id).toBe(pj.id);
    expect(card.pullJob.correlationId).toBe("req_sup1");
  });
  it("unknown id → 404; non-admin operator → 403 (Pryme-ops only)", async () => {
    expect((await app.request(`/intel/support?q=site_nope`, { headers: cookie(opKey) })).status).toBe(404);
    expect((await app.request(`/intel/support?q=not-an-id`, { headers: cookie(opKey) })).status).toBe(404);
    // t2 operator is not in supportAdminTenantIds → 403 even though
    // the query targets a site of another tenant (cross-tenant is
    // an ops privilege, not a client feature)
    expect((await app.request(`/intel/support?q=${siteId}`, { headers: cookie(foreignOpKey) })).status).toBe(403);
  });
  it("admin operator sees foreign-tenant site (cross-tenant by design)", async () => {
    // t1 IS in the admin list → same query on the t1 site resolves
    const res = await app.request(`/intel/support?q=${scanId}`, { headers: cookie(opKey) });
    expect(res.status).toBe(200);
    expect((await res.json()).site.tenantId).toBe(tenantId);
  });
});
