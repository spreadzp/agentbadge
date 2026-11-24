// EPIC-262 (SLICE-262-31): observability — /health /ready endpoints,
// correlation_id propagation into scan/pull jobs, terminal metrics.
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
import { createMemoryIntelClientReportStore } from "../../src/server/lib/intel/client-report";
import {
  createMemoryPullJobStore,
  createMemorySecurityEventStore,
} from "../../src/server/lib/intel/pull";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { createIntelUiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import { registry as promRegistry } from "../../src/server/metrics/metrics";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const metricValue = async (name: string, labels?: Record<string, string>) => {
  const m = (await promRegistry.getSingleMetric(name)) as unknown as {
    get: () => Promise<{ values: { labels: Record<string, string>; value: number }[] }>;
  } | undefined;
  const vals = (await m?.get())?.values ?? [];
  return vals
    .filter((v) =>
      !labels || Object.entries(labels).every(([k, x]) => v.labels[k] === x),
    )
    .reduce((s, v) => s + v.value, 0);
};

// ─── health / ready ───────────────────────────────────────────────
describe("/api/intel/health + /ready", () => {
  const full = () => {
    const stores = createMemoryIntelRegistry();
    return {
      key,
      registry: createIntelRegistryService(stores),
      registryStores: stores,
      evidence: createMemoryIntelEvidenceStore(),
      consent: createMemoryIntelConsentStore(),
      scanJobs: createMemoryScanJobStore(),
      ruleset: INTEL_WP_PROFILE_V1,
      scanFetch: async () => ({
        status: 200, headers: {}, bodyText: "ok", resolvedIp: "1.2.3.4",
      }),
      entitlement: createMemoryEntitlementStore(),
    };
  };

  it("health → 200 liveness with version", async () => {
    const app = new Hono();
    app.route("/api/intel", createIntelApiRoutes(full()));
    const res = await app.request("/api/intel/health");
    expect(res.status).toBe(200);
    expect((await res.json()).status).toBe("ok");
  });
  it("ready → 200 when everything wired", async () => {
    const app = new Hono();
    app.route("/api/intel", createIntelApiRoutes(full()));
    const res = await app.request("/api/intel/ready");
    expect(res.status).toBe(200);
    expect((await res.json()).ready).toBe(true);
  });
  it("ready → 503 + names the missing store", async () => {
    const app = new Hono();
    const deps = full() as Record<string, unknown>;
    delete deps.evidence;
    delete deps.scanJobs;
    app.route("/api/intel", createIntelApiRoutes(deps));
    const res = await app.request("/api/intel/ready");
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body.ready).toBe(false);
    expect(body.missing).toContain("evidence");
    expect(body.missing).toContain("scanJobs");
  });
  it("no key → health 503 intel_key_missing, ready 503", async () => {
    const app = new Hono();
    app.route("/api/intel", createIntelApiRoutes({ key: null }));
    expect((await app.request("/api/intel/health")).status).toBe(503);
    const r = await app.request("/api/intel/ready");
    expect(r.status).toBe(503);
    expect((await r.json()).missing).toContain("key");
  });
});

// ─── correlation_id + metrics on a real scan ─────────────────────
describe("correlation + metrics", () => {
  let app: Hono;
  let scanJobs: ReturnType<typeof createMemoryScanJobStore>;
  let pullJobs: ReturnType<typeof createMemoryPullJobStore>;
  let opKey: string;
  let siteId: string;
  let tenantId: string;

  beforeEach(async () => {
    const stores = createMemoryIntelRegistry();
    const registry = createIntelRegistryService(stores);
    scanJobs = createMemoryScanJobStore();
    pullJobs = createMemoryPullJobStore();
    const securityEvents = createMemorySecurityEventStore();
    const consent = createMemoryIntelConsentStore();
    const evidence = createMemoryIntelEvidenceStore();
    const entitlement = createMemoryEntitlementStore();

    const tenant = await registry.createTenant({ slug: "t1", name: "T1" });
    tenantId = tenant.id;
    const customer = await registry.createCustomer(tenant.id, { name: "C" });
    siteId = (await registry.createSite(customer.id, { domains: ["bakery.com"] })).id;
    opKey = (await inviteOperator(stores, tenant.id, { email: "o@t1.dev", role: "operator" })).plaintext;
    await grantConsent(consent, siteId, "audit", { principal: "site_key", id: "k" });
    await entitlement.upsert({
      id: "ent_1", tenantId: tenant.id, plan: "pilot", status: "active",
      coveredSiteIds: [siteId], perSiteLimits: {},
      validFrom: "2020-01-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z",
      graceUntil: "2030-01-08T00:00:00Z",
      createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
    });

    app = new Hono();
    // minimal request-logger equivalent — the real middleware lives
    // upstream of this router in prod
    app.use("*", async (c, next) => {
      c.set("requestId", "req_test_42");
      await next();
    });
    app.route("/api/intel", createIntelApiRoutes({
      key, registry, registryStores: stores, evidence,
      evidenceRetentionDays: 400, entitlement, scanJobs,
      ruleset: INTEL_WP_PROFILE_V1,
      scanFetch: async () => ({ status: 200, headers: {}, bodyText: "ok", resolvedIp: "1.2.3.4" }),
      consent, pullJobs, securityEvents,
      clientReports: createMemoryIntelClientReportStore(),
    }));
    app.route("/intel", createIntelUiRoutes({
      key, registry, registryStores: stores, evidence,
      evidenceRetentionDays: 400, entitlement, scanJobs,
      ruleset: INTEL_WP_PROFILE_V1,
      scanFetch: async () => ({ status: 200, headers: {}, bodyText: "ok", resolvedIp: "1.2.3.4" }),
      consent, pullJobs, securityEvents,
      clientReports: createMemoryIntelClientReportStore(),
    }));
  });

  it("scan job carries the request correlation_id", async () => {
    // no inside_diagnostics consent → no pull-jobs → the bounded
    // ~90s wait is skipped; the correlation field itself is proven.
    const res = await app.request(`/api/intel/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opKey}` },
      body: JSON.stringify({ site_id: siteId }),
    });
    expect(res.status).toBeLessThan(300);
    const [job] = await scanJobs.forSite(siteId);
    expect(job.correlationId).toBe("req_test_42");
  });

  it("createPullJob persists correlation_id; security events inherit it", async () => {
    const { createPullJob } = await import(
      "../../src/server/lib/intel/pull/ops"
    );
    const r = await createPullJob(
      {
        pullJobs,
        securityEvents: createMemorySecurityEventStore(),
        evidence: createMemoryIntelEvidenceStore(),
        consent: createMemoryIntelConsentStore(),
        jobsKey: key,
        signKey: key,
      },
      {
        siteId,
        tenantId,
        probeId: "const_read",
        params: { name: "WP_DEBUG" },
        correlationId: "req_test_42",
      },
    );
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.job.correlationId).toBe("req_test_42");
  });

  it("terminal metrics increment: scans counter + duration + envelopes", async () => {
    const before = await metricValue("agentbadge_intel_scans_total", { status: "complete" });
    const envBefore = await metricValue("agentbadge_intel_envelopes_total", { provenance: "EXTERNAL_OBSERVED" });
    await app.request(`/api/intel/scans`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${opKey}` },
      body: JSON.stringify({ site_id: siteId }),
    });
    expect(await metricValue("agentbadge_intel_scans_total", { status: "complete" })).toBeGreaterThan(before);
    expect(await metricValue("agentbadge_intel_envelopes_total", { provenance: "EXTERNAL_OBSERVED" })).toBeGreaterThan(envBefore);
  });
});
