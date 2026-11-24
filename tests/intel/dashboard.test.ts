// EPIC-262 (SLICE-262-10): hosted dashboard /intel — login/session,
// tenant isolation, portfolio rendering, rescan gates.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
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
import type { ScanJob, ScanFetch, ScanObservation } from "../../src/server/lib/intel/scan";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import { createIntelUiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const canned = (status = 200): ScanObservation => ({
  status, headers: {}, bodyText: "ok", resolvedIp: "203.0.113.5",
});
const happyFetch: ScanFetch = async () => canned();

let stores: IntelRegistryStores;
let tenantId: string;
let siteId: string;
let opKey: string;
let viewerKey: string;
let foreignSiteId: string;
let app: Hono;
let evidence: ReturnType<typeof createMemoryIntelEvidenceStore>;
let jobs: ReturnType<typeof createMemoryScanJobStore>;
let entitlement: ReturnType<typeof createMemoryEntitlementStore>;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let clientReports: ReturnType<typeof createMemoryIntelClientReportStore>;

const cookieFor = (key_: string) => `intel_session=${key_}`;

async function login(key_: string) {
  const res = await app.request("/intel/login", {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: `key=${encodeURIComponent(key_)}`,
  });
  return res;
}

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  const registry = createIntelRegistryService(stores);
  evidence = createMemoryIntelEvidenceStore();
  jobs = createMemoryScanJobStore();
  entitlement = createMemoryEntitlementStore();
  consent = createMemoryIntelConsentStore();
  clientReports = createMemoryIntelClientReportStore();

  const tenant = await registry.createTenant({ slug: "t1", name: "T1" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  const site = await registry.createSite(customer.id, { domains: ["bakery.com"] });
  siteId = site.id;
  opKey = (await inviteOperator(stores, tenant.id, { email: "op@t1.dev", role: "operator" })).plaintext;
  viewerKey = (await inviteOperator(stores, tenant.id, { email: "v@t1.dev", role: "viewer" })).plaintext;
  await grantConsent(consent, site.id, "audit", { principal: "site_key", id: "k" });
  await entitlement.upsert({
    id: "ent_1", tenantId: tenant.id, plan: "pilot", status: "active",
    coveredSiteIds: [site.id], perSiteLimits: {},
    validFrom: "2020-01-01T00:00:00Z", validUntil: "2030-01-01T00:00:00Z",
    graceUntil: "2030-01-08T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
  });

  // foreign tenant + its site — must never surface
  const t2 = await registry.createTenant({ slug: "t2", name: "T2" });
  const c2 = await registry.createCustomer(t2.id, { name: "C2" });
  foreignSiteId = (await registry.createSite(c2.id, { domains: ["other.com"] })).id;

  app = new Hono();
  app.route("/intel", createIntelUiRoutes({
    key,
    registry,
    registryStores: stores,
    evidence,
    evidenceRetentionDays: 400,
    entitlement,
    scanJobs: jobs,
    ruleset: INTEL_WP_PROFILE_V1,
    scanFetch: happyFetch,
    consent,
    clientReports,
  }));
});

describe("auth", () => {
  it("GET /intel without cookie → 302 login", async () => {
    const res = await app.request("/intel");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/intel/login");
  });

  it("login with abop_ → cookie + redirect to /intel", async () => {
    const res = await login(opKey);
    expect(res.status).toBe(302);
    expect(res.headers.get("set-cookie")).toContain("intel_session=abop_");
    expect(res.headers.get("location")).toBe("/intel");
  });

  it("login with bad key → stays on form", async () => {
    const res = await login("abop_wrong");
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Unknown or revoked key");
  });

  it("GET /intel with cookie → 200 portfolio", async () => {
    const res = await app.request("/intel", {
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("bakery.com");
    expect(html).toContain("no scan");
  });
});

describe("tenant isolation", () => {
  it("portfolio lists only own-tenant sites", async () => {
    const res = await app.request("/intel", {
      headers: { cookie: cookieFor(opKey) },
    });
    const html = await res.text();
    expect(html).toContain("bakery.com");
    expect(html).not.toContain("other.com");
  });

  it("foreign site detail → 404", async () => {
    const res = await app.request(`/intel/sites/${foreignSiteId}`, {
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(404);
  });

  it("foreign report → 404", async () => {
    const job: ScanJob = {
      id: "job_f", siteId: foreignSiteId, tenantId: "tnt_foreign",
      scanId: "scan_f",
    correlationId: null, status: "complete", baseUrl: "https://other.com",
      probeFailures: 0, probeTotal: 1, error: null, reportId: "rpt_f",
      report: null, createdAt: "x", updatedAt: "x", finishedAt: null,
    };
    await jobs.insert(job);
    const res = await app.request("/intel/reports/job_f", {
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(404);
  });
});

describe("rescan gates", () => {
  const scanPost = (site: string, key_: string) =>
    app.request(`/intel/sites/${site}/scan`, {
      method: "POST",
      headers: { cookie: cookieFor(key_) },
    });

  it("viewer → 403 role_denied", async () => {
    const res = await scanPost(siteId, viewerKey);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("role_denied");
  });

  it("foreign site → 404", async () => {
    const res = await scanPost(foreignSiteId, opKey);
    expect(res.status).toBe(404);
  });

  it("no consent → 403 consent_denied", async () => {
    const t = stores;
    const c2 = await t.customers.forTenant(tenantId);
    const s2 = (await t.sites.forCustomer(c2[0].id))[0];
    await (await import("../../src/server/lib/intel/consent")).revokeConsent(
      consent, s2.id, "audit", { principal: "operator", id: "op_x" },
    );
    const res = await scanPost(siteId, opKey);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("consent_denied");
  });

  it("entitled + consented → job runs and redirects back", async () => {
    const res = await scanPost(siteId, opKey);
    expect(res.status).toBe(302);
    const stored = await jobs.forSite(siteId);
    expect(stored).toHaveLength(1);
    expect(stored[0].status).toBe("complete");
    expect(stored[0].report).not.toBeNull();
  });
});

describe("site + report views", () => {
  beforeEach(async () => {
    // run a scan so there is a report to view
    const res = await app.request(`/intel/sites/${siteId}/scan`, {
      method: "POST",
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(302);
  });

  it("site page shows scores, provenance, job state", async () => {
    const res = await app.request(`/intel/sites/${siteId}`, {
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Agent readiness");
    expect(html).toContain("Surface exposure");
    expect(html).toContain("EXTERNAL_OBSERVED");
    expect(html).toContain("Signed canonical report");
  });

  it("report page renders signed report", async () => {
    const job = (await jobs.forSite(siteId))[0];
    const res = await app.request(`/intel/reports/${job.id}`, {
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain(job.scanId);
    expect(html).toContain("sha256:");
    expect(html).toContain("content_hash");
    expect(html).toContain("Signed canonical report");
  });
});

describe("client reports (262-11)", () => {
  const generate = () =>
    app.request(`/intel/sites/${siteId}/client-report`, {
      method: "POST",
      headers: { cookie: cookieFor(opKey) },
    });

  beforeEach(async () => {
    // need a scan report to generate from
    await app.request(`/intel/sites/${siteId}/scan`, {
      method: "POST",
      headers: { cookie: cookieFor(opKey) },
    });
  });

  it("generate → GENERATED client report + redirect", async () => {
    const res = await generate();
    expect(res.status).toBe(302);
    const all = await clientReports.forSite(siteId);
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe("GENERATED");
    expect(all[0].canonical.findingCounts.fail).toBeGreaterThanOrEqual(0);
  });

  it("same period → redirects to existing (no dup)", async () => {
    await generate();
    const res = await generate();
    const all = await clientReports.forSite(siteId);
    expect(all).toHaveLength(1);
    expect(res.headers.get("location")).toContain(all[0].id);
  });

  it("viewer cannot generate", async () => {
    const res = await app.request(`/intel/sites/${siteId}/client-report`, {
      method: "POST",
      headers: { cookie: cookieFor(viewerKey) },
    });
    expect(res.status).toBe(403);
  });

  it("full lifecycle: edit → review → approve → send → frozen", async () => {
    await generate();
    const cr = (await clientReports.forSite(siteId))[0];
    const hash = cr.canonical.contentHash;

    // editorial edit
    const edit = await app.request(`/intel/client-reports/${cr.id}/edit`, {
      method: "POST",
      headers: {
        cookie: cookieFor(opKey),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "heroLine=Your+site+is+ready&whatChanged=-+fixed&nextMonth=1+pending&internalNote=secret",
    });
    expect(edit.status).toBe(302);
    const after = await clientReports.byId(cr.id);
    expect(after!.editorial.version).toBe(2);
    expect(after!.canonical.contentHash).toBe(hash);

    // transitions forward
    for (const act of ["review", "approve", "send"]) {
      const r = await app.request(`/intel/client-reports/${cr.id}/${act}`, {
        method: "POST",
        headers: { cookie: cookieFor(opKey) },
      });
      expect(r.status).toBe(302);
    }
    expect((await clientReports.byId(cr.id))!.status).toBe("SENT");

    // frozen: edit now 409
    const frozen = await app.request(`/intel/client-reports/${cr.id}/edit`, {
      method: "POST",
      headers: {
        cookie: cookieFor(opKey),
        "content-type": "application/x-www-form-urlencoded",
      },
      body: "heroLine=x",
    });
    expect(frozen.status).toBe(409);
  });

  it("illegal transition → 409", async () => {
    await generate();
    const cr = (await clientReports.forSite(siteId))[0];
    const res = await app.request(`/intel/client-reports/${cr.id}/approve`, {
      method: "POST",
      headers: { cookie: cookieFor(opKey) },
    });
    expect(res.status).toBe(409);
  });

  it("page renders hero + scores; .md serves markdown", async () => {
    await generate();
    const cr = (await clientReports.forSite(siteId))[0];
    const html = await (
      await app.request(`/intel/client-reports/${cr.id}`, {
        headers: { cookie: cookieFor(opKey) },
      })
    ).text();
    expect(html).toContain("Agent Surface Report");
    expect(html).toContain("Agent readiness");
    expect(html).toContain("Surface exposure");

    const md = await app.request(`/intel/client-reports/${cr.id}.md`, {
      headers: { cookie: cookieFor(opKey) },
    });
    expect(md.headers.get("content-type")).toContain("text/markdown");
    expect(await md.text()).toContain("# Agent Surface Report");
  });

  it("foreign operator cannot read client report (404)", async () => {
    await generate();
    const cr = (await clientReports.forSite(siteId))[0];
    // mint a third tenant + its operator — must not see t1's report
    const tenant2 = await createIntelRegistryService(stores).createTenant({ slug: "t9", name: "T9" });
    const { plaintext: k9 } = await inviteOperator(stores, tenant2.id, { email: "o@t9.dev", role: "operator" });
    const res = await app.request(`/intel/client-reports/${cr.id}`, {
      headers: { cookie: cookieFor(k9) },
    });
    expect(res.status).toBe(404);
  });
});
