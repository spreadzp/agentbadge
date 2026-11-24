// EPIC-262 (SLICE-262-34): report-diff CI-gate — chain-resolved
// (head, base) pair, honest modes (bootstrap/no_reports/chain_broken/
// ruleset-incompatible), dual-auth + tenant/consent/entitlement
// gates, SARIF format, per-site scan cooldown.
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
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { createMemoryEntitlementStore } from "../../src/server/lib/intel/entitlement";
import { computeReportDiff, verifyReportDiff } from "../../src/server/lib/intel/report-diff";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { ScanJob } from "../../src/server/lib/intel/scan/types";
import type { IntelReport } from "../../src/server/lib/intel/report/schema";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-diff",
  signingPrivateKey: Buffer.alloc(32, 9).toString("base64"),
} as IntelEnvConfig)!;

const T0 = "2026-11-24T12:00:00Z";
const ago = (min: number) =>
  new Date(Date.parse(T0) - min * 60_000).toISOString();
const hash = (c: string) => `sha256:${c.repeat(64)}`;

const finding = (
  rule_id: string,
  status: "pass" | "fail" | "warn" | "unknown",
): IntelReport["findings"][number] => ({
  rule_id,
  rule_version: "1",
  surface: "readiness",
  severity: "high",
  name: `rule ${rule_id}`,
  status,
  claim: `${rule_id} claim`,
  reason: `${rule_id} reason`,
  evidence_ids: [],
});

const report = (
  siteId: string,
  id: string,
  contentHash: string,
  previousHash: string | null,
  findings: IntelReport["findings"],
  score = 80,
  ruleset = { name: "agent-surface-wp", version: "1.1.0" },
): IntelReport => ({
  schema_version: "1.0",
  report_id: id,
  site_id: siteId,
  ruleset,
  scan: { scan_id: `scan_${id}`, completeness: "complete", generated_at: T0 },
  evidence: {
    envelope_count: 1,
    collected_at_min: null,
    received_at_max: T0,
    provenance: {},
  },
  findings,
  scores: {
    readiness: { surface: "readiness", score, evaluable: 2, pass: 1, fail: 1, warn: 0, unknown: 0 },
    exposure: { surface: "exposure", score: 70, evaluable: 2, pass: 2, fail: 0, warn: 0, unknown: 0 },
  },
  previous_hash: previousHash,
  integrity: {
    content_hash: contentHash,
    signature: { algorithm: "ed25519", key_id: key.keyId, value: "s" },
  },
});

const jobOf = (siteId: string, r: IntelReport | null, createdAt: string): ScanJob => ({
  id: `job_${r?.report_id ?? "none"}`,
  siteId,
  tenantId: "tnt_1",
  scanId: `scan_${r?.report_id ?? "x"}`,
  correlationId: null,
  status: "complete",
  baseUrl: "https://x.test",
  probeFailures: 0,
  probeTotal: 1,
  error: null,
  reportId: r?.report_id ?? null,
  report: r,
  createdAt,
  updatedAt: createdAt,
  finishedAt: createdAt,
});

let stores: IntelRegistryStores;
let registry: ReturnType<typeof createIntelRegistryService>;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let jobs: ReturnType<typeof createMemoryScanJobStore>;
let entitlement: ReturnType<typeof createMemoryEntitlementStore>;
let tenantId: string;
let siteId: string;
let siteKey: string;
let opKey: string;
let app: Hono;

const get = (auth: string, query = "") =>
  app.request(`/api/intel/report-diff${query}`, {
    headers: { authorization: auth },
  });

const entitle = (tid: string, siteIds: string[]) =>
  entitlement.upsert({
    id: "ent_1", tenantId: tid, plan: "pilot", status: "active",
    coveredSiteIds: siteIds, perSiteLimits: {},
    validFrom: "2020-01-01T00:00:00Z",
    validUntil: "2030-01-01T00:00:00Z",
    graceUntil: "2030-01-08T00:00:00Z",
    createdAt: "2020-01-01T00:00:00Z", updatedAt: "2020-01-01T00:00:00Z",
  });

const BASE = report(
  "", // siteId patched per-test — findings/diff are what matter
  "01JDIFFBASE000000000000000",
  hash("aa"),
  null,
  [finding("AB-1", "fail"), finding("AB-2", "pass"), finding("AB-3", "fail")],
);
const HEAD = report(
  "",
  "01JDIFFHEAD000000000000000",
  hash("bb"),
  hash("aa"),
  [finding("AB-1", "pass"), finding("AB-2", "pass"), finding("AB-4", "fail")],
  90,
);

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  consent = createMemoryIntelConsentStore();
  jobs = createMemoryScanJobStore();
  entitlement = createMemoryEntitlementStore();
  const tenant = await registry.createTenant({ slug: "t1", name: "T" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  siteId = (
    await registry.createSite(customer.id, { domains: ["bakery.com"] })
  ).id;
  siteKey = (await registry.mintSiteKey(siteId)).plaintext;
  opKey = (
    await inviteOperator(stores, tenantId, {
      email: "o@t.dev",
      role: "operator",
    })
  ).plaintext;
  await grantConsent(consent, siteId, "audit", {
    principal: "site_key",
    id: "sk",
  });
  await entitle(tenantId, [siteId]);
  app = new Hono();
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key, registry, registryStores: stores, consent, scanJobs: jobs,
      entitlement,
    }),
  );
});

describe("computeReportDiff — chain-resolved modes", () => {
  it("no_reports when nothing canonical exists", () => {
    const d = computeReportDiff([], siteId, T0);
    expect(d.mode).toBe("no_reports");
    expect(d.ruleset_compatible).toBeNull();
  });

  it("bootstrap on genesis head (previous_hash null)", () => {
    const d = computeReportDiff(
      [jobOf(siteId, { ...BASE, site_id: siteId }, ago(10))],
      siteId,
      T0,
    );
    expect(d.mode).toBe("bootstrap");
    expect(d.head_scores?.readiness).toBe(80);
  });

  it("diff resolves base BY previous_hash, not by position", () => {
    // an unrelated OLDER report sits between base and head by time —
    // position-based selection would pick it; the chain must not
    const stray = report("", "01JDIFFSTRAY0000000000000", hash("cc"), null, [
      finding("AB-9", "fail"),
    ]);
    const d = computeReportDiff(
      [
        jobOf(siteId, { ...BASE, site_id: siteId }, ago(30)),
        jobOf(siteId, { ...stray, site_id: siteId }, ago(20)),
        jobOf(siteId, { ...HEAD, site_id: siteId }, ago(10)),
      ],
      siteId,
      T0,
    );
    expect(d.mode).toBe("diff");
    expect(d.ruleset_compatible).toBe(true);
    expect(d.base_report_id).toBe(BASE.report_id);
    expect(d.new_findings).toEqual(["AB-4"]);
    expect(d.closed_findings.sort()).toEqual(["AB-1", "AB-3"]);
    expect(d.still_open).toEqual([]);
    expect(d.score_delta.readiness).toBe(10);
  });

  it("chain_broken when previous_hash matches no stored report", () => {
    const orphan = report("", "01JDIFFORPHAN00000000000", hash("dd"), hash("99"), []);
    const d = computeReportDiff(
      [jobOf(siteId, { ...orphan, site_id: siteId }, ago(10))],
      siteId,
      T0,
    );
    expect(d.mode).toBe("chain_broken");
    expect(d.base_report_id).toBeNull();
  });

  it("ruleset_compatible:false on ruleset change — not a fake delta", () => {
    const head2 = report("", "01JDIFFHEAD000000000000000", hash("bb"), hash("aa"), [
      finding("AB-4", "fail"),
    ], 90, { name: "agent-surface-wp", version: "2.0.0" });
    const d = computeReportDiff(
      [
        jobOf(siteId, { ...BASE, site_id: siteId }, ago(20)),
        jobOf(siteId, { ...head2, site_id: siteId }, ago(10)),
      ],
      siteId,
      T0,
    );
    expect(d.mode).toBe("diff");
    expect(d.ruleset_compatible).toBe(false);
    expect(d.new_findings).toEqual([]);
  });
});

describe("GET /api/intel/report-diff — gates", () => {
  it("401 without a valid key", async () => {
    expect((await get("Bearer absk_nope")).status).toBe(401);
    expect((await get("Bearer bad")).status).toBe(401);
  });

  it("site_key channel: signed diff for its own site", async () => {
    await jobs.insert(jobOf(siteId, { ...BASE, site_id: siteId }, ago(20)));
    await jobs.insert(jobOf(siteId, { ...HEAD, site_id: siteId }, ago(10)));
    const res = await get(`Bearer ${siteKey}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.mode).toBe("diff");
    expect(body.new_findings).toEqual(["AB-4"]);
    // the answer verifies against the published key like any artefact
    const v = verifyReportDiff(body, [key]);
    expect(v.ok).toBe(true);
  });

  it("site_key + foreign ?site → 403 site_key_scope", async () => {
    const res = await get(`Bearer ${siteKey}`, "?site=site_other");
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("site_key_scope");
  });

  it("operator channel: own tenant OK, foreign site 403", async () => {
    await jobs.insert(jobOf(siteId, { ...BASE, site_id: siteId }, ago(10)));
    const res = await get(`Bearer ${opKey}`, `?site=${siteId}`);
    expect(res.status).toBe(200);
    const resForeign = await get(`Bearer ${opKey}`, "?site=site_foreign");
    expect(resForeign.status).toBe(404); // unknown site — not a scope leak
  });

  it("403 consent_denied when audit consent revoked", async () => {
    await revokeConsent(consent, siteId, "audit", {
      principal: "operator",
      id: "op_x",
    });
    const res = await get(`Bearer ${siteKey}`);
    expect(res.status).toBe(403);
    expect((await res.json()).error).toBe("consent_denied");
  });

  it("403 entitlement_denied without a row (reason surfaced)", async () => {
    // rebuild without entitlement row
    const stores2 = createMemoryIntelRegistry();
    const reg2 = createIntelRegistryService(stores2);
    const t2 = await reg2.createTenant({ slug: "t2", name: "T2" });
    const c2 = await reg2.createCustomer(t2.id, { name: "C" });
    const s2 = (await reg2.createSite(c2.id, { domains: ["x.dev"] })).id;
    const k2 = (await reg2.mintSiteKey(s2)).plaintext;
    const consent2 = createMemoryIntelConsentStore();
    await grantConsent(consent2, s2, "audit", { principal: "site_key", id: "sk" });
    const app2 = new Hono();
    app2.route(
      "/api/intel",
      createIntelApiRoutes({
        key, registry: reg2, registryStores: stores2, consent: consent2,
        scanJobs: createMemoryScanJobStore(),
        entitlement: createMemoryEntitlementStore(),
      }),
    );
    const res = await app2.request("/api/intel/report-diff", {
      headers: { authorization: `Bearer ${k2}` },
    });
    expect(res.status).toBe(403);
    expect((await res.json()).reason).toBe("no_entitlement");
  });

  it("?format=sarif returns SARIF 2.1.0 for new findings", async () => {
    await jobs.insert(jobOf(siteId, { ...BASE, site_id: siteId }, ago(20)));
    await jobs.insert(jobOf(siteId, { ...HEAD, site_id: siteId }, ago(10)));
    const res = await get(`Bearer ${siteKey}`, "?format=sarif");
    expect(res.status).toBe(200);
    const sarif = await res.json();
    expect(sarif.version).toBe("2.1.0");
    const results = sarif.runs[0].results;
    expect(results).toHaveLength(1);
    expect(results[0].ruleId).toBe("AB-4");
    expect(results[0].level).toBe("error");
  });
});

describe("POST /scans — per-site cooldown (AC-4)", () => {
  it("429 + Retry-After inside the cooldown window", async () => {
    const app2 = new Hono();
    app2.route(
      "/api/intel",
      createIntelApiRoutes({
        key, registry, registryStores: stores, consent, scanJobs: jobs,
        entitlement,
        evidence: createMemoryIntelEvidenceStore(),
        scanFetch: async () => {
          throw new Error("no fetch in test");
        },
        ruleset: { ruleset_version: "1.1.0", rules: [] },
        scanCooldownSeconds: 300,
      }),
    );
    // real-time fixture — the route measures elapsed from Date.now()
    await jobs.insert(
      jobOf(siteId, null, new Date(Date.now() - 60_000).toISOString()),
    );
    const res = await app2.request("/api/intel/scans", {
      method: "POST",
      headers: { authorization: `Bearer ${siteKey}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("Retry-After"))).toBeGreaterThan(200);
    expect((await res.json()).error).toBe("scan_cooldown");
  });

  it("no cooldown → scan proceeds (deps wired)", async () => {
    const app2 = new Hono();
    app2.route(
      "/api/intel",
      createIntelApiRoutes({
        key, registry, registryStores: stores, consent, scanJobs: jobs,
        entitlement,
        evidence: createMemoryIntelEvidenceStore(),
        scanFetch: async () => ({
          status: 404,
          headers: {},
          bodyText: "not found",
          resolvedIp: "203.0.113.9",
        }),
        ruleset: { ruleset_version: "1.1.0", rules: [] },
        scanCooldownSeconds: 0,
      }),
    );
    await jobs.insert(jobOf(siteId, null, ago(1)));
    const res = await app2.request("/api/intel/scans", {
      method: "POST",
      headers: { authorization: `Bearer ${siteKey}`, "content-type": "application/json" },
      body: "{}",
    });
    expect(res.status).not.toBe(429);
  });
});
