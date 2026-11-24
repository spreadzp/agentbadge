// EPIC-262 (SLICE-262-27b): requires-attention feed — severity
// mapping, derived-at-read alerts, tenant-scoped API + dashboard
// page, honest empty state.
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
import {
  createMemoryAttestationStore,
  issueAttestation,
  revokeAttestation,
} from "../../src/server/lib/intel/attestation";
import { buildAlerts } from "../../src/server/lib/intel/monitoring/alerts";
import { listPortfolio } from "../../src/server/lib/intel/dashboard/data";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { createIntelUiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { ScanJob } from "../../src/server/lib/intel/scan/types";
import type { IntelReport } from "../../src/server/lib/intel/report/schema";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-alerts",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const NOW = new Date("2026-11-24T12:00:00Z");
const daysAgo = (n: number) =>
  new Date(NOW.getTime() - n * 86_400_000).toISOString();

const reportFor = (siteId: string, failExposure: number): IntelReport => ({
  schema_version: "1.0",
  report_id: "01JALERTRPRT00000000000000",
  site_id: siteId,
  ruleset: { name: "wp", version: "1.1.0" },
  scan: {
    scan_id: "scan_a1",
    completeness: "complete",
    generated_at: daysAgo(2),
  },
  evidence: {
    envelope_count: 10,
    collected_at_min: null,
    received_at_max: daysAgo(2),
    provenance: { external_observed: 10 },
  },
  findings: [],
  scores: {
    readiness: { surface: "readiness", score: 90, evaluable: 40, pass: 37, fail: 1, warn: 1, unknown: 1 },
    exposure: { surface: "exposure", score: 80, evaluable: 20, pass: 20 - failExposure - 1, fail: failExposure, warn: 0, unknown: 1 },
  },
  previous_hash: null,
  integrity: {
    content_hash: `sha256:${"ef".repeat(32)}`,
    signature: { algorithm: "ed25519", key_id: key.keyId, value: "s" },
  },
});

const jobOf = (siteId: string, over: Partial<ScanJob> = {}): ScanJob => ({
  id: `job_${siteId}`,
  siteId,
  tenantId: "tnt_1",
  scanId: "scan_a1",
  correlationId: null,
  status: "complete",
  baseUrl: "https://x.test",
  probeFailures: 0,
  probeTotal: 10,
  error: null,
  reportId: reportFor(siteId, 0).report_id,
  report: null,
  createdAt: daysAgo(2),
  updatedAt: daysAgo(2),
  finishedAt: daysAgo(2),
  ...over,
});

let stores: IntelRegistryStores;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let jobs: ReturnType<typeof createMemoryScanJobStore>;
let attestations: ReturnType<typeof createMemoryAttestationStore>;
let tenantId: string;
let siteId: string;
let opKey: string;
let viewerKey: string;
let api: Hono;
let ui: Hono;

const portfolio = () =>
  listPortfolio(stores, consent, jobs, tenantId);

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  const registry = createIntelRegistryService(stores);
  consent = createMemoryIntelConsentStore();
  jobs = createMemoryScanJobStore();
  attestations = createMemoryAttestationStore();
  const tenant = await registry.createTenant({ slug: "t1", name: "T" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  siteId = (
    await registry.createSite(customer.id, { domains: ["bakery.com"] })
  ).id;
  opKey = (
    await inviteOperator(stores, tenantId, { email: "o@t.dev", role: "operator" })
  ).plaintext;
  viewerKey = (
    await inviteOperator(stores, tenantId, { email: "v@t.dev", role: "viewer" })
  ).plaintext;

  api = new Hono();
  api.route(
    "/api/intel",
    createIntelApiRoutes({
      key, registry, registryStores: stores, consent, scanJobs: jobs, attestations,
    }),
  );
  ui = new Hono();
  ui.route(
    "/intel",
    createIntelUiRoutes({
      key, registry, registryStores: stores, consent, scanJobs: jobs,
      evidence: createMemoryIntelEvidenceStore(), attestations,
    }),
  );
});

describe("buildAlerts — derived feed", () => {
  it("no_scan site → P3 alert; exposure fail → P1 first", async () => {
    await jobs.insert(jobOf(siteId, { report: reportFor(siteId, 3) }));
    const alerts = buildAlerts(await portfolio(), new Map(), NOW);
    expect(alerts[0].reason).toBe("exposure_fail");
    expect(alerts[0].severity).toBe("P1");
    expect(alerts[0].headline).toContain("3 exposure finding");
  });

  it("stale evidence → P2; failed job → P1", async () => {
    await jobs.insert(
      jobOf(siteId, {
        status: "complete",
        report: {
          ...reportFor(siteId, 0),
          evidence: { ...reportFor(siteId, 0).evidence, received_at_max: daysAgo(45) },
        },
      }),
    );
    const alerts = buildAlerts(await portfolio(), new Map(), NOW);
    const stale = alerts.find((a) => a.reason === "stale");
    expect(stale?.severity).toBe("P2");
  });

  it("attestation expiring ≤14d → P2; revoked → P2 with reason", async () => {
    await jobs.insert(jobOf(siteId, { report: reportFor(siteId, 0) }));
    const r = await issueAttestation(
      attestations,
      jobOf(siteId, { report: reportFor(siteId, 0) }),
      key,
      10, // valid_until = now+10d → expiring inside the 14d window
    );
    if (!r.ok) throw new Error("issue failed");
    const map = new Map([[siteId, await attestations.forSite(siteId)]]);
    const alerts = buildAlerts(await portfolio(), map, NOW);
    expect(alerts.some((a) => a.reason === "attestation_expiring")).toBe(true);

    await revokeAttestation(attestations, r.attestation.attestation_id, "bad key");
    const map2 = new Map([[siteId, await attestations.forSite(siteId)]]);
    const alerts2 = buildAlerts(await portfolio(), map2, NOW);
    const revoked = alerts2.find((a) => a.reason === "attestation_revoked");
    expect(revoked?.detail).toContain("bad key");
    expect(alerts2.some((a) => a.reason === "attestation_expiring")).toBe(false);
  });

  it("P1 sorts before P2 before P3", async () => {
    // site with a failed scan (P1) — and no_scan would be P3
    await jobs.insert(jobOf(siteId, { status: "failed", error: "boom" }));
    const alerts = buildAlerts(await portfolio(), new Map(), NOW);
    const order = alerts.map((a) => a.severity);
    expect(order).toEqual([...order].sort());
    expect(alerts[0].severity).toBe("P1");
  });
});

describe("GET /api/intel/alerts", () => {
  it("tenant feed + 401 without key + foreign isolation", async () => {
    await jobs.insert(jobOf(siteId, { status: "failed", error: "x" }));
    const res = await api.request("/api/intel/alerts", {
      headers: { authorization: `Bearer ${opKey}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.tenant_sites).toBe(1);
    expect(body.alerts.some((a: { reason: string }) => a.reason === "failed_scan")).toBe(true);

    expect((await api.request("/api/intel/alerts")).status).toBe(401);
    // viewer reads too (read ≠ paid op)
    expect(
      (await api.request("/api/intel/alerts", {
        headers: { authorization: `Bearer ${viewerKey}` },
      })).status,
    ).toBe(200);
  });
});

describe("GET /intel/alerts — dashboard feed", () => {
  const cookie = (k: string) => ({ cookie: `intel_session=${k}` });

  it("renders alert card + honest empty state", async () => {
    // a healthy site (consent + fresh complete scan, no fails) →
    // zero attention items → the honest empty state
    await grantConsent(consent, siteId, "audit", { principal: "site_key", id: "k" });
    await jobs.insert(jobOf(siteId, { report: reportFor(siteId, 0) }));
    const empty = await ui.request("/intel/alerts", { headers: cookie(opKey) });
    expect((await empty.text())).toContain("No attention items right now");

    await jobs.insert(jobOf(siteId, { status: "failed", error: "probe timeout" }));
    const res = await ui.request("/intel/alerts", { headers: cookie(opKey) });
    const html = await res.text();
    expect(html).toContain("P1 — act now");
    expect(html).toContain("last scan failed");
    expect(html).toContain("probe timeout");
    expect(html).toContain(`/intel/sites/${siteId}`);
  });

  it("revoked consent site surfaces consent_revoked alert", async () => {
    await grantConsent(consent, siteId, "audit", { principal: "operator", id: "o" });
    await revokeConsent(consent, siteId, "audit", { principal: "operator", id: "o" });
    const html = await (
      await ui.request("/intel/alerts", { headers: cookie(opKey) })
    ).text();
    expect(html).toContain("audit consent revoked");
  });
});
