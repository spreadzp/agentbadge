// EPIC-262 (SLICE-262-29): public verification surface —
// /verify/agent-surface/:siteId opt-in via `publication` consent,
// honest attestation states, JSON variant, silent 404 for the
// non-consented world.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelConsentStore,
  grantConsent,
  revokeConsent,
} from "../../src/server/lib/intel/consent";
import {
  createMemoryAttestationStore,
  issueAttestation,
  revokeAttestation,
} from "../../src/server/lib/intel/attestation";
import { createIntelVerifyRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelReport } from "../../src/server/lib/intel/report/schema";
import type { ScanJob } from "../../src/server/lib/intel/scan/types";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-verify",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
} as IntelEnvConfig)!;

const SITE = "site_verify_1";

const REPORT: IntelReport = {
  schema_version: "1.0",
  report_id: "01JVERFYRPRT00000000000000",
  site_id: SITE,
  ruleset: { name: "wp", version: "1.1.0" },
  scan: {
    scan_id: "scan_v1",
    completeness: "complete",
    generated_at: "2026-11-24T10:00:00Z",
  },
  evidence: {
    envelope_count: 10,
    collected_at_min: null,
    received_at_max: null,
    provenance: { external_observed: 10 },
  },
  findings: [],
  scores: {
    readiness: { surface: "readiness", score: 91, evaluable: 40, pass: 37, fail: 1, warn: 1, unknown: 1 },
    exposure: { surface: "exposure", score: 85, evaluable: 20, pass: 18, fail: 1, warn: 0, unknown: 1 },
  },
  previous_hash: null,
  integrity: {
    content_hash: `sha256:${"cd".repeat(32)}`,
    signature: { algorithm: "ed25519", key_id: key.keyId, value: "sig" },
  },
};

const jobOf = (over: Partial<ScanJob> = {}): ScanJob => ({
  id: "job_v1",
  siteId: SITE,
  tenantId: "tnt_1",
  scanId: "scan_v1",
  correlationId: null,
  status: "complete",
  baseUrl: "https://bakery.com",
  probeFailures: 0,
  probeTotal: 10,
  error: null,
  reportId: REPORT.report_id,
  report: { ...REPORT },
  createdAt: "2026-11-24T10:00:00Z",
  updatedAt: "2026-11-24T10:05:00Z",
  finishedAt: "2026-11-24T10:05:00Z",
  ...over,
});

let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let attestations: ReturnType<typeof createMemoryAttestationStore>;
let app: Hono;

const get = (site: string, accept?: string) =>
  app.request(`/verify/agent-surface/${site}`, {
    headers: accept ? { accept } : {},
  });

beforeEach(() => {
  consent = createMemoryIntelConsentStore();
  attestations = createMemoryAttestationStore();
  app = new Hono();
  app.route("/", createIntelVerifyRoutes({ key, consent, attestations }));
});

describe("opt-in gate — publication consent is the switch", () => {
  it("no consent → 404 (never leaks the site is registered)", async () => {
    const res = await get(SITE);
    expect(res.status).toBe(404);
    expect(await res.text()).toBe("Not found");
  });

  it("audit consent alone is NOT publication — still 404", async () => {
    await grantConsent(consent, SITE, "audit", { principal: "site_key", id: "k" });
    await grantConsent(consent, SITE, "inside_diagnostics", { principal: "operator", id: "o" });
    expect((await get(SITE)).status).toBe(404);
  });

  it("revoked publication consent → page goes dark immediately", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    expect((await get(SITE)).status).toBe(200);
    await revokeConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    expect((await get(SITE)).status).toBe(404);
  });
});

describe("consented, no attestation → honest unattested page", () => {
  it("shows 'not yet attested', not a fake verified card", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    const res = await get(SITE);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Not yet attested");
    expect(html).not.toContain("Verified — active");
  });
});

describe("attested states — recomputed at render", () => {
  const issue = async (validityDays = 90) => {
    const r = await issueAttestation(attestations, jobOf(), key, validityDays);
    if (!r.ok) throw new Error("issue failed");
    return r.attestation;
  };

  it("active → verified card with scores, hash, key_id", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    await issue();
    const html = await (await get(SITE)).text();
    expect(html).toContain("Verified — active");
    expect(html).toContain("91"); // readiness
    expect(html).toContain("85"); // exposure
    expect(html).toContain(REPORT.integrity.content_hash);
    expect(html).toContain(key.keyId);
    expect(html).toContain("signature ✓ verified");
    expect(html).toContain("/.well-known/agentbadge-keys.json");
  });

  it("expired → honest expired state, never 'verified'", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    await issue(-1); // valid_until in the past → derived "expired"
    const html = await (await get(SITE)).text();
    expect(html).toContain("Expired");
    expect(html).not.toContain("Verified — active");
  });

  it("revoked → revoked state + reason, not verified", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    const a = await issue();
    await revokeAttestation(attestations, a.attestation_id, "key compromise");
    const html = await (await get(SITE)).text();
    expect(html).toContain("Revoked");
    expect(html).toContain("key compromise");
    expect(html).not.toContain("Verified — active");
  });

  it("Accept: application/json → machine payload with recomputed fields", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    const a = await issue();
    const res = await get(SITE, "application/json");
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.site_id).toBe(SITE);
    expect(body.attestation.attestation_id).toBe(a.attestation_id);
    expect(body.effective_status).toBe("active");
    expect(body.signature_valid).toBe(true);
    expect(body.keys_url).toBe("/.well-known/agentbadge-keys.json");
  });

  it("latest attestation wins (forSite returns history, page shows newest)", async () => {
    await grantConsent(consent, SITE, "publication", { principal: "operator", id: "o" });
    const first = await issue();
    await revokeAttestation(attestations, first.attestation_id, "superseded");
    const second = await issue(); // newer issued timestamp
    const res = await get(SITE, "application/json");
    const body = await res.json();
    expect(body.attestation.attestation_id).toBe(second.attestation_id);
    expect(body.effective_status).toBe("active");
  });
});
