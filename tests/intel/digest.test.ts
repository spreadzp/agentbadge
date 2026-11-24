// EPIC-262 (SLICE-262-27a): freshness + pilot digest — the honest
// attention function behind sort/strip/digest; stale is view-time,
// never written into the signed report.
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
import type { ScanJob } from "../../src/server/lib/intel/scan";
import {
  attentionFor,
  buildDigest,
  STALE_DAYS,
} from "../../src/server/lib/intel/dashboard/freshness";
import type { PortfolioRow } from "../../src/server/lib/intel/dashboard/data";
import { attentionSort } from "../../src/views/intel/portfolio";
import { INTEL_WP_PROFILE_V1 } from "../../src/server/lib/intel/rules";
import { createIntelUiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const NOW = new Date("2026-11-24T12:00:00Z");
const daysAgo = (d: number) =>
  new Date(NOW.getTime() - d * 86_400_000).toISOString();

const mkRow = (over: {
  id?: string;
  job?: Partial<ScanJob> | null;
  consent?: PortfolioRow["consent"];
}): PortfolioRow =>
  ({
    site: { id: over.id ?? "site_1", environment: "prod", status: "active" },
    hostname: over.id ? `${over.id}.test` : "bakery.test",
    consent: over.consent ?? "granted",
    latestJob:
      over.job === null
        ? null
        : ({
            id: "job_1",
            status: "complete",
            createdAt: daysAgo(1),
            finishedAt: daysAgo(1),
            report: {
              evidence: { received_at_max: daysAgo(1) },
              scores: {
                readiness: { score: 80, pass: 8, fail: 0, warn: 0, unknown: 0, evaluable: 8 },
                exposure: { score: 95, pass: 14, fail: 0, warn: 0, unknown: 1, evaluable: 14 },
              },
            },
            ...over.job,
          }) as ScanJob,
  }) as unknown as PortfolioRow;

describe("attentionFor", () => {
  it("clean scanned site → no reasons, low weight", () => {
    const a = attentionFor(mkRow({}), NOW);
    expect(a.reasons).toEqual([]);
    expect(a.stale).toBe(false);
    expect(a.weight).toBe(10);
  });
  it("exposure fails → exposure_fail, highest weight", () => {
    const a = attentionFor(
      mkRow({
        job: {
          report: {
            evidence: { received_at_max: daysAgo(1) },
            scores: {
              readiness: { score: 80, pass: 8, fail: 0, warn: 0, unknown: 0, evaluable: 8 },
              exposure: { score: 40, pass: 10, fail: 5, warn: 0, unknown: 0, evaluable: 15 },
            },
          } as ScanJob["report"],
        },
      }),
      NOW,
    );
    expect(a.reasons).toContain("exposure_fail");
    expect(a.weight).toBeGreaterThan(300);
  });
  it(`evidence older than ${STALE_DAYS}d → stale`, () => {
    const a = attentionFor(
      mkRow({
        job: {
          createdAt: daysAgo(STALE_DAYS + 5),
          finishedAt: daysAgo(STALE_DAYS + 5),
          report: {
            evidence: { received_at_max: daysAgo(STALE_DAYS + 5) },
            scores: {
              readiness: { score: 80, pass: 8, fail: 0, warn: 0, unknown: 0, evaluable: 8 },
              exposure: { score: 95, pass: 15, fail: 0, warn: 0, unknown: 0, evaluable: 15 },
            },
          } as ScanJob["report"],
        },
      }),
      NOW,
    );
    expect(a.stale).toBe(true);
    expect(a.scanAgeDays).toBe(STALE_DAYS + 5);
    expect(a.reasons).toEqual(["stale"]);
  });
  it("no scan → no_scan; failed → failed_scan; revoked → consent_revoked", () => {
    expect(attentionFor(mkRow({ job: null }), NOW).reasons).toEqual(["no_scan"]);
    expect(
      attentionFor(mkRow({ job: { status: "failed", report: null } }), NOW)
        .reasons,
    ).toContain("failed_scan");
    expect(
      attentionFor(mkRow({ consent: "revoked" }), NOW).reasons,
    ).toEqual(["consent_revoked"]);
  });
  it("design order: exposure → failed → stale → no data", () => {
    const rows = [
      mkRow({ id: "clean" }),
      mkRow({ id: "noscan", job: null }),
      mkRow({
        id: "stale",
        job: {
          createdAt: daysAgo(40),
          finishedAt: daysAgo(40),
          report: {
            evidence: { received_at_max: daysAgo(40) },
            scores: {
              readiness: { score: 80, pass: 8, fail: 0, warn: 0, unknown: 0, evaluable: 8 },
              exposure: { score: 95, pass: 15, fail: 0, warn: 0, unknown: 0, evaluable: 15 },
            },
          } as ScanJob["report"],
        },
      }),
      mkRow({
        id: "bad",
        job: {
          report: {
            evidence: { received_at_max: daysAgo(1) },
            scores: {
              readiness: { score: 80, pass: 8, fail: 0, warn: 0, unknown: 0, evaluable: 8 },
              exposure: { score: 30, pass: 10, fail: 5, warn: 0, unknown: 0, evaluable: 15 },
            },
          } as ScanJob["report"],
        },
      }),
    ];
    const sorted = attentionSort(rows).map((r) => r.site.id);
    expect(sorted[0]).toBe("bad");
    expect(sorted[1]).toBe("stale");
    expect(sorted[sorted.length - 1]).toBe("clean");
  });
});

describe("buildDigest", () => {
  it("aggregates reasons + last_fleet_scan_at; worst first", () => {
    const d = buildDigest(
      [
        mkRow({ id: "clean" }),
        mkRow({ id: "noscan", job: null }),
        mkRow({ id: "revoked", consent: "revoked" }),
      ],
      NOW,
    );
    expect(d.tenant_sites).toBe(3);
    expect(d.need_attention).toBe(2); // noscan + revoked
    expect(d.reasons.no_scan).toBe(1);
    expect(d.reasons.consent_revoked).toBe(1);
    expect(d.last_fleet_scan_at).toBe(daysAgo(1));
    expect(d.sites[0].site_id).toBe("noscan");
  });
  it("empty portfolio → honest zeros, never a stub", () => {
    const d = buildDigest([], NOW);
    expect(d.tenant_sites).toBe(0);
    expect(d.need_attention).toBe(0);
    expect(d.last_fleet_scan_at).toBeNull();
    expect(d.sites).toEqual([]);
  });
});

// ─── GET /intel/digest route ──────────────────────────────────────
let stores: IntelRegistryStores;
let opKey: string;
let foreignOpKey: string;
let siteId: string;
let app: Hono;
let jobs: ReturnType<typeof createMemoryScanJobStore>;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  const registry = createIntelRegistryService(stores);
  jobs = createMemoryScanJobStore();
  consent = createMemoryIntelConsentStore();
  const tenant = await registry.createTenant({ slug: "t1", name: "T1" });
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  siteId = (await registry.createSite(customer.id, { domains: ["bakery.com"] })).id;
  opKey = (await inviteOperator(stores, tenant.id, { email: "o@t1.dev", role: "operator" })).plaintext;
  await grantConsent(consent, siteId, "audit", { principal: "site_key", id: "k" });
  const t2 = await registry.createTenant({ slug: "t2", name: "T2" });
  foreignOpKey = (await inviteOperator(stores, t2.id, { email: "o@t2.dev", role: "operator" })).plaintext;

  app = new Hono();
  app.route("/intel", createIntelUiRoutes({
    key,
    registry,
    registryStores: stores,
    evidence: createMemoryIntelEvidenceStore(),
    evidenceRetentionDays: 400,
    entitlement: createMemoryEntitlementStore(),
    scanJobs: jobs,
    ruleset: INTEL_WP_PROFILE_V1,
    scanFetch: async () => ({ status: 200, headers: {}, bodyText: "ok", resolvedIp: "203.0.113.5" }),
    consent,
    clientReports: undefined,
  }));
});

describe("GET /intel/digest", () => {
  it("no session → 302 login", async () => {
    const res = await app.request("/intel/digest");
    expect(res.status).toBe(302);
  });
  it("tenant-scoped JSON: own site visible, honest fields", async () => {
    const res = await app.request("/intel/digest", {
      headers: { cookie: `intel_session=${opKey}` },
    });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.tenant_sites).toBe(1);
    expect(d.sites[0].site_id).toBe(siteId);
    expect(d.sites[0].hostname).toBe("bakery.com");
    expect(d.sites[0].reasons).toContain("no_scan");
    expect(d.reasons.no_scan).toBe(1);
    expect(d.generated_at).toBeTruthy();
  });
  it("foreign tenant → empty digest, no leak", async () => {
    const res = await app.request("/intel/digest", {
      headers: { cookie: `intel_session=${foreignOpKey}` },
    });
    expect(res.status).toBe(200);
    const d = await res.json();
    expect(d.tenant_sites).toBe(0);
    expect(d.sites).toEqual([]);
  });
});
