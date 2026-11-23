// EPIC-262 (SLICE-262-3): evidence intake — POST /api/intel/evidence.
// site_key auth → site identity → trust boundary → signed envelope →
// persisted with dedupe + retention. The ONLY evidence entry point.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryService,
} from "../../src/server/lib/intel/registry";
import {
  createMemoryIntelEvidenceStore,
  computeDedupeHash,
  type IntelEvidenceStore,
} from "../../src/server/lib/intel/evidence/store";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { verifyEnvelope } from "../../src/server/lib/intel/evidence";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const SEED_B64 = Buffer.alloc(32, 7).toString("base64");
const RETENTION_DAYS = 400;
const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-1",
  signingPrivateKey: SEED_B64,
} as IntelEnvConfig)!;

let registry: IntelRegistryService;
let evidence: IntelEvidenceStore;
let app: Hono;
let siteId: string;
let siteKey: string;

function submission(over: Record<string, unknown> = {}) {
  return {
    collector_id: `wp_plugin@${siteId}`,
    scan_id: "scan_test_1",
    site_ref: siteId,
    collected_at: "2026-11-23T10:00:00Z",
    subject: { type: "wp_option", name: "blog_public" },
    payload: { type: "wp_option_read", name: "blog_public", value: "1" },
    evidence_refs: [],
    ...over,
  };
}

const post = (body: unknown, auth?: string) =>
  app.request("/api/intel/evidence", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(auth !== undefined ? { authorization: auth } : {}),
    },
    body: JSON.stringify(body),
  });

beforeEach(async () => {
  const stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  evidence = createMemoryIntelEvidenceStore();
  const tenant = await registry.createTenant({ slug: "pryme", name: "P" });
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  const site = await registry.createSite(customer.id, {
    domains: ["bakery.com"],
  });
  siteId = site.id;
  siteKey = (await registry.mintSiteKey(site.id)).plaintext;
  app = new Hono();
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key,
      registry,
      evidence,
      evidenceRetentionDays: RETENTION_DAYS,
    }),
  );
});

describe("POST /api/intel/evidence — site_key auth", () => {
  it("accepts a valid submission → 201 + signed envelope", async () => {
    const res = await post(submission(), `Bearer ${siteKey}`);
    expect(res.status).toBe(201);
    const body = await res.json();
    expect(body.deduplicated).toBe(false);
    const env = body.envelope;
    expect(env.schema_version).toBe("1.0");
    expect(env.site_id).toBe(siteId);
    expect(env.provenance).toBe("PLUGIN_SELF_REPORTED");
    expect(env.collector).toEqual({
      type: "wp_plugin",
      id: `wp_plugin@${siteId}`,
      version: "unknown",
    });
    expect(env.signature.algorithm).toBe("ed25519");
    expect(env.received_at).toBeTruthy();
  });

  it("envelope signature verifies against the published key (e2e)", async () => {
    const res = await post(submission(), `Bearer ${siteKey}`);
    const { envelope } = await res.json();
    expect(verifyEnvelope(envelope, [key]).ok).toBe(true);
  });

  it("401 on missing / malformed / unknown / revoked site_key", async () => {
    expect((await post(submission())).status).toBe(401); // no header
    expect((await post(submission(), "Bearer garbage")).status).toBe(401);
    expect(
      (await post(submission(), "Bearer absk_" + "x".repeat(32))).status,
    ).toBe(401);
    // revoked
    const rec = (await registry.mintSiteKey(siteId)).record;
    await registry.revokeSiteKey(rec.id, "test");
    const revokedKey = (
      await registry.mintSiteKey(siteId)
    ).plaintext; // fresh for contrast
    void revokedKey;
    // authenticate with a key whose record was revoked:
    const { plaintext, record } = await registry.mintSiteKey(siteId);
    await registry.revokeSiteKey(record.id, "leak");
    const res = await post(submission(), `Bearer ${plaintext}`);
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("site_key_invalid");
  });
});

describe("trust boundary — wire claims cannot override auth", () => {
  it("site_ref ≠ authenticated site → 400 site_ref_mismatch", async () => {
    const res = await post(
      submission({ site_ref: "site_99999999999999999999999999" }),
      `Bearer ${siteKey}`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("site_ref_mismatch");
  });

  it("collector_id ≠ derived identity → 400 collector_mismatch", async () => {
    const res = await post(
      submission({ collector_id: "wp_plugin@attacker" }),
      `Bearer ${siteKey}`,
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("collector_mismatch");
  });

  it("trust fields in body → 400 submission_invalid (boundary reject)", async () => {
    for (const field of ["provenance", "received_at", "signature"]) {
      const res = await post(
        submission({ [field]: "EXTERNAL_OBSERVED" }),
        `Bearer ${siteKey}`,
      );
      expect(res.status).toBe(400);
      expect((await res.json()).error).toBe("submission_invalid");
    }
  });
});

describe("dedupe + persistence + retention", () => {
  it("identical retry → 200 deduplicated + SAME envelope_id", async () => {
    const s = submission();
    const r1 = await post(s, `Bearer ${siteKey}`);
    const r2 = await post(s, `Bearer ${siteKey}`);
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(200);
    const b1 = await r1.json();
    const b2 = await r2.json();
    expect(b2.deduplicated).toBe(true);
    expect(b2.envelope.envelope_id).toBe(b1.envelope.envelope_id);
    expect(b2.envelope.signature).toEqual(b1.envelope.signature);
    // one row only
    expect(await evidence.forSite(siteId)).toHaveLength(1);
  });

  it("distinct submissions in the same scan → separate envelopes", async () => {
    const r1 = await post(submission(), `Bearer ${siteKey}`);
    const r2 = await post(
      submission({ subject: { type: "wp_option", name: "home" } }),
      `Bearer ${siteKey}`,
    );
    expect(r1.status).toBe(201);
    expect(r2.status).toBe(201);
    const rows = await evidence.forScan(siteId, "scan_test_1");
    expect(rows).toHaveLength(2);
  });

  it("dedupeHash is deterministic + site-scoped", () => {
    const s = submission();
    const h1 = computeDedupeHash(s as never, siteId);
    const h2 = computeDedupeHash(s as never, siteId);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
    // different site → different hash (no cross-site collision)
    const h3 = computeDedupeHash(s as never, "site_other");
    expect(h3).not.toBe(h1);
  });

  it("expiresAt = receivedAt + retentionDays", async () => {
    const res = await post(submission(), `Bearer ${siteKey}`);
    const rows = await evidence.forSite(siteId);
    expect(rows).toHaveLength(1);
    const row = rows[0];
    const { envelope } = await res.json();
    expect(row.receivedAt).toBe(envelope.received_at);
    const expect_exp = new Date(
      new Date(row.receivedAt).getTime() + RETENTION_DAYS * 86400_000,
    ).toISOString();
    expect(row.expiresAt).toBe(expect_exp);
    expect(row.dedupeHash).toMatch(/^[0-9a-f]{64}$/);
    expect(row.envelope).toEqual(envelope);
  });

  it("sweep removes expired rows only", async () => {
    await post(submission(), `Bearer ${siteKey}`);
    const farFuture = new Date(Date.now() + 500 * 86400_000).toISOString();
    expect(await evidence.sweep(farFuture)).toBe(1);
    expect(await evidence.forSite(siteId)).toHaveLength(0);
    // re-submit and sweep before expiry → nothing removed
    await post(submission(), `Bearer ${siteKey}`);
    expect(await evidence.sweep(new Date().toISOString())).toBe(0);
    expect(await evidence.forSite(siteId)).toHaveLength(1);
  });
});
