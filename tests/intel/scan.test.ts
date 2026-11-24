// EPIC-262 (SLICE-262-6): deep-scan job — runner lifecycle with an
// injected fetcher (no network), completeness semantics, entitlement
// gate on POST /api/intel/scans.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryService,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { acceptSubmission } from "../../src/server/lib/intel/evidence/boundary";
import { createMemoryEntitlementStore } from "../../src/server/lib/intel/entitlement";
import {
  createMemoryIntelConsentStore,
  grantConsent,
  revokeConsent,
} from "../../src/server/lib/intel/consent";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import {
  runScanJob,
  SCAN_PLAN,
  type ScanJob,
  type ScanFetch,
  type ScanObservation,
} from "../../src/server/lib/intel/scan";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

// ─── fake site: everything healthy, debug.log + .env leak ──────────
const ROBOTS = "User-agent: *\nDisallow: /wp-admin/\nSitemap: https://bakery.com/sitemap.xml\n";
const SITEMAP = `<?xml version="1.0"?><urlset><url><loc>https://bakery.com/</loc><lastmod>2026-11-18</lastmod></url></urlset>`;
const canned = (status = 200, body = "ok", headers: Record<string, string> = {}): ScanObservation => ({
  status, headers, bodyText: body, resolvedIp: "203.0.113.5",
});

const happyFetch: ScanFetch = async (url) => {
  if (url.endsWith("/robots.txt")) return canned(200, ROBOTS);
  if (url.endsWith("/sitemap.xml")) return canned(200, SITEMAP);
  if (url.endsWith("/llms.txt")) return canned(200, "# bakery — agent info");
  if (url.endsWith("/wp-content/debug.log")) return canned(200, "FATAL x");
  if (url.endsWith("/.env")) return canned(403);
  if (url.endsWith("/wp-json/wp/v2/users")) return canned(403);
  if (url.endsWith("/xmlrpc.php")) return canned(404);
  return canned(200, "<html>ok</html>", { "content-type": "text/html", server: "nginx" });
};

function mkJob(over: Partial<ScanJob> = {}): ScanJob {
  return {
    id: "job_t1",
    siteId: "site_t",
    tenantId: "tnt_t",
    scanId: "scan_t1",
    correlationId: null,
    status: "queued",
    baseUrl: "https://bakery.com",
    probeFailures: 0,
    probeTotal: SCAN_PLAN.length,
    error: null,
    reportId: null,
    report: null,
    createdAt: "2026-11-20T10:00:00Z",
    updatedAt: "2026-11-20T10:00:00Z",
    finishedAt: null,
    ...over,
  };
}

const NOW = new Date("2026-11-20T10:00:00Z");
const depsFor = (fetch: ScanFetch, evidence = createMemoryIntelEvidenceStore()) => ({
  fetch,
  evidence,
  jobs: createMemoryScanJobStore(),
  key,
  ruleset: INTEL_WP_PROFILE_V1,
  now: () => NOW,
});

describe("runScanJob", () => {
  it("all probes ok → complete + signed report + EXTERNAL_OBSERVED envelopes", async () => {
    const deps = depsFor(happyFetch);
    const job = await runScanJob(mkJob(), deps);
    expect(job.status).toBe("complete");
    expect(job.reportId).toBeTruthy();
    expect(job.report!.scan.completeness).toBe("complete");
    // probes with docType html/wp_json dual-emit (obs + doc fact):
    // /, /wp-json/, /wp-content/uploads/ → 3 extra envelopes
    const stored = await deps.evidence.forSite("site_t");
    expect(stored).toHaveLength(SCAN_PLAN.length + 3);
    expect(
      stored.every((e) => e.provenance === "EXTERNAL_OBSERVED"),
    ).toBe(true);
    // debug.log leaked → exposure rule fires
    const f = job.report!.findings.find((x) => x.rule_id === "AB-INTEL-X-001");
    expect(f!.status).toBe("fail");
    // robots allows agents → readiness pass
    const r = job.report!.findings.find((x) => x.rule_id === "AB-INTEL-R-004");
    expect(r!.status).toBe("pass");
  });

  it("one probe fails → partial + report completeness=partial", async () => {
    const flaky: ScanFetch = async (url) => {
      if (url.endsWith("/llms.txt")) throw new Error("timeout");
      return happyFetch(url);
    };
    const deps = depsFor(flaky);
    const job = await runScanJob(mkJob(), deps);
    expect(job.status).toBe("partial");
    expect(job.probeFailures).toBe(1);
    expect(job.report!.scan.completeness).toBe("partial");
    // llms.txt rules → unknown (never fetched)
    const f = job.report!.findings.find((x) => x.rule_id === "AB-INTEL-R-007");
    expect(f!.status).toBe("unknown");
  });

  it("all probes fail → failed, no report", async () => {
    const dead: ScanFetch = async () => {
      throw new Error("nxdomain");
    };
    const deps = depsFor(dead);
    const job = await runScanJob(mkJob(), deps);
    expect(job.status).toBe("failed");
    expect(job.report).toBeNull();
    expect(job.reportId).toBeNull();
    expect(job.error).toMatch(/all probes/i);
  });

  it("re-scan produces fresh envelopes (scan_id differs)", async () => {
    const evidence = createMemoryIntelEvidenceStore();
    const deps = depsFor(happyFetch, evidence);
    await runScanJob(mkJob({ id: "job_a", scanId: "scan_a" }), deps);
    await runScanJob(mkJob({ id: "job_b", scanId: "scan_b" }), deps);
    expect((await evidence.forSite("site_t")).length).toBe((SCAN_PLAN.length + 3) * 2);
  });

  // ── SLICE-262-14: plugin self-report feeds the ruleset ──
  const selfReport = async (
    evidence: ReturnType<typeof createMemoryIntelEvidenceStore>,
    name: string,
    value: unknown,
    receivedAt: string,
  ) => {
    const env = acceptSubmission(
      {
        collector_id: "wp_plugin@site_t",
        scan_id: `self_${receivedAt}`,
        site_ref: "site_t",
        collected_at: receivedAt,
        subject: { type: "wp_option", name },
        payload: { type: "wp_option_read", name, value },
        evidence_refs: [],
      },
      { collector: { type: "wp_plugin", id: "wp_plugin@site_t", version: "0.1" }, site_id: "site_t" },
      key,
      new Date(receivedAt),
    );
    await evidence.insert({
      id: env.envelope_id,
      schemaVersion: env.schema_version,
      siteId: "site_t",
      scanId: `self_${receivedAt}`,
      collectorId: env.collector.id,
      provenance: env.provenance,
      dedupeHash: `h_${env.envelope_id}`,
      receivedAt,
      expiresAt: null,
      envelope: env,
    });
  };

  it("fresh plugin self-report feeds rules (WP_DEBUG truthy → X-009 fail)", async () => {
    const evidence = createMemoryIntelEvidenceStore();
    await selfReport(evidence, "WP_DEBUG", true, "2026-11-20T09:00:00Z");
    const job = await runScanJob(mkJob(), depsFor(happyFetch, evidence));
    const x009 = job.report!.findings.find((f) => f.rule_id === "AB-INTEL-X-009")!;
    expect(x009.status).toBe("fail");
    expect(x009.evidence_ids.length).toBeGreaterThan(0);
  });

  it("stale self-report (>48h) does NOT feed rules — stays unknown", async () => {
    const evidence = createMemoryIntelEvidenceStore();
    await selfReport(evidence, "WP_DEBUG", true, "2026-11-17T09:00:00Z");
    const job = await runScanJob(mkJob(), depsFor(happyFetch, evidence));
    const x009 = job.report!.findings.find((f) => f.rule_id === "AB-INTEL-X-009")!;
    expect(x009.status).toBe("unknown");
  });

  it("superseded self-report (true then false) — latest wins → pass", async () => {
    const evidence = createMemoryIntelEvidenceStore();
    await selfReport(evidence, "WP_DEBUG", true, "2026-11-20T08:00:00Z");
    await selfReport(evidence, "WP_DEBUG", false, "2026-11-20T09:00:00Z");
    const job = await runScanJob(mkJob(), depsFor(happyFetch, evidence));
    const x009 = job.report!.findings.find((f) => f.rule_id === "AB-INTEL-X-009")!;
    expect(x009.status).toBe("pass");
  });
});

// ─── route: POST /api/intel/scans ───────────────────────────────────
describe("POST /api/intel/scans", () => {
  let stores: ReturnType<typeof createMemoryIntelRegistry>;
  let registry: IntelRegistryService;
  let entitlement: ReturnType<typeof createMemoryEntitlementStore>;
  let consent: ReturnType<typeof createMemoryIntelConsentStore>;
  let app: Hono;
  let siteId: string;
  let siteKey: string;
  let tenantId: string;

  beforeEach(async () => {
    stores = createMemoryIntelRegistry();
    registry = createIntelRegistryService(stores);
    entitlement = createMemoryEntitlementStore();
    consent = createMemoryIntelConsentStore();
    const tenant = await registry.createTenant({ slug: "pryme", name: "P" });
    tenantId = tenant.id;
    const customer = await registry.createCustomer(tenant.id, { name: "C" });
    const site = await registry.createSite(customer.id, { domains: ["bakery.com"] });
    siteId = site.id;
    siteKey = (await registry.mintSiteKey(site.id)).plaintext;
    await grantConsent(consent, site.id, "audit", {
      principal: "site_key",
      id: "key_seed",
    });
    app = new Hono();
    app.route(
      "/api/intel",
      createIntelApiRoutes({
        key,
        registry,
        registryStores: stores,
        consent,
        evidence: createMemoryIntelEvidenceStore(),
        entitlement,
        scanJobs: createMemoryScanJobStore(),
        ruleset: INTEL_WP_PROFILE_V1,
        scanFetch: happyFetch,
      }),
    );
  });

  const post = (auth?: string, body?: unknown) =>
    app.request("/api/intel/scans", {
      method: "POST",
      headers: {
        ...(auth !== undefined ? { authorization: auth } : {}),
        ...(body !== undefined ? { "content-type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });

  const entitleTenant = async (tid: string, siteIds: string[]) => {
    await entitlement.upsert({
      id: "ent_1", tenantId: tid, plan: "pilot", status: "active",
      coveredSiteIds: siteIds, perSiteLimits: {},
      validFrom: "2020-01-01T00:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
      graceUntil: "2030-01-08T00:00:00Z",
      createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
    });
  };

  it("401 without site_key", async () => {
    expect((await post()).status).toBe(401);
    expect((await post("Bearer absk_nope")).status).toBe(401);
  });

  it("403 consent_denied without audit consent (before entitlement)", async () => {
    await entitleTenant(tenantId, [siteId]);
    await revokeConsent(consent, siteId, "audit", {
      principal: "operator",
      id: "op_x",
    });
    const res = await post(`Bearer ${siteKey}`);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("consent_denied");
  });

  it("403 no_entitlement when tenant has no row", async () => {
    const res = await post(`Bearer ${siteKey}`);
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("no_entitlement");
  });

  it("403 site_not_covered for uncovered site", async () => {
    await entitlement.upsert({
      id: "ent_1", tenantId, plan: "pilot", status: "active",
      coveredSiteIds: ["site_other"], perSiteLimits: {},
      validFrom: "2020-01-01T00:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
      graceUntil: "2030-01-08T00:00:00Z",
      createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
    });
    const res = await post(`Bearer ${siteKey}`);
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("site_not_covered");
  });

  it("201 + report when entitled", async () => {
    await entitlement.upsert({
      id: "ent_1", tenantId, plan: "pilot", status: "active",
      coveredSiteIds: [siteId], perSiteLimits: {},
      validFrom: "2020-01-01T00:00:00Z",
      validUntil: "2030-01-01T00:00:00Z",
      graceUntil: "2030-01-08T00:00:00Z",
      createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
    });
    const res = await post(`Bearer ${siteKey}`);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.job.status).toBe("complete");
    expect(body.job.siteId).toBe(siteId);
    expect(body.job.tenantId).toBe(tenantId);
    expect(body.report.integrity.signature.value).toBeTruthy();
    expect(body.report.scan.completeness).toBe("complete");
  });

  describe("operator key channel (SLICE-262-7)", () => {
    const invite = (email: string, role: "owner" | "operator" | "viewer", tid = tenantId) =>
      inviteOperator(stores, tid, { email, role });

    it("201 via abop_ + {site_id} — entitlement on the operator tenant", async () => {
      await entitleTenant(tenantId, [siteId]);
      const { plaintext } = await invite("op@pryme.io", "operator");
      const res = await post(`Bearer ${plaintext}`, { site_id: siteId });
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.job.siteId).toBe(siteId);
      expect(body.job.tenantId).toBe(tenantId);
    });

    it("403 role_denied for viewer even when tenant is entitled", async () => {
      await entitleTenant(tenantId, [siteId]);
      const { plaintext } = await invite("ro@pryme.io", "viewer");
      const res = await post(`Bearer ${plaintext}`, { site_id: siteId });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("role_denied");
    });

    it("403 site_not_in_tenant for a foreign site", async () => {
      const rival = await registry.createTenant({ slug: "rival", name: "R" });
      const cust = await registry.createCustomer(rival.id, { name: "X" });
      const foreign = await registry.createSite(cust.id, {
        domains: ["foreign.io"],
      });
      await entitleTenant(tenantId, [siteId]);
      await entitleTenant(rival.id, [foreign.id]);
      const { plaintext } = await invite("op@pryme.io", "operator");
      const res = await post(`Bearer ${plaintext}`, { site_id: foreign.id });
      expect(res.status).toBe(403);
      expect((await res.json()).error).toBe("site_not_in_tenant");
    });

    it("400 site_id_required when abop_ is used without a body site", async () => {
      await entitleTenant(tenantId, [siteId]);
      const { plaintext } = await invite("op@pryme.io", "operator");
      const res = await post(`Bearer ${plaintext}`);
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("site_id_required");
    });

    it("401 for unknown/malformed operator keys", async () => {
      expect((await post("Bearer abop_" + "a".repeat(32), { site_id: siteId })).status).toBe(401);
    });
  });
});
