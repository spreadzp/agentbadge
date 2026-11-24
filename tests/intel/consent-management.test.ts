// EPIC-262 (SLICE-262-23): consent management — full kind matrix
// (audit | inside_diagnostics | apply | publication), append-only
// grant/revoke history, tenant-scoped read API + dashboard forms.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
  type IntelRegistryService,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import {
  CONSENT_KINDS,
  createMemoryIntelConsentStore,
  grantConsent,
  hasActiveConsent,
  revokeConsent,
} from "../../src/server/lib/intel/consent";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { createIntelUiRoutes } from "../../src/server/routes/intel";
import { createMemoryIntelEvidenceStore } from "../../src/server/lib/intel/evidence/store";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-consent",
  signingPrivateKey: Buffer.alloc(32, 7).toString("base64"),
  evidenceRetentionDays: 0,
} as IntelEnvConfig)!;

let stores: IntelRegistryStores;
let registry: IntelRegistryService;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let api: Hono;
let ui: Hono;
let tenantId: string;
let siteId: string;
let opKey: string;
let viewerKey: string;
let foreignSiteId: string;

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  consent = createMemoryIntelConsentStore();
  const tenant = await registry.createTenant({ slug: "pryme", name: "P" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  siteId = (
    await registry.createSite(customer.id, { domains: ["bakery.com"] })
  ).id;
  opKey = (
    await inviteOperator(stores, tenantId, {
      email: "op@pryme.io",
      role: "operator",
    })
  ).plaintext;
  viewerKey = (
    await inviteOperator(stores, tenantId, {
      email: "v@pryme.io",
      role: "viewer",
    })
  ).plaintext;
  const t2 = await registry.createTenant({ slug: "rival", name: "R" });
  const c2 = await registry.createCustomer(t2.id, { name: "C2" });
  foreignSiteId = (
    await registry.createSite(c2.id, { domains: ["other.com"] })
  ).id;

  api = new Hono();
  api.route(
    "/api/intel",
    createIntelApiRoutes({ key, registry, registryStores: stores, consent }),
  );
  ui = new Hono();
  ui.route(
    "/intel",
    createIntelUiRoutes({
      key,
      registry,
      registryStores: stores,
      consent,
      evidence: createMemoryIntelEvidenceStore(),
      scanJobs: createMemoryScanJobStore(),
    }),
  );
});

const getConsents = (site: string, auth?: string) =>
  api.request(`/api/intel/sites/${site}/consents`, {
    headers: auth !== undefined ? { authorization: auth } : {},
  });

describe("consent ops — append-only history", () => {
  it("grant + revoke append cev_ events with principal attribution", async () => {
    await grantConsent(consent, siteId, "audit", {
      principal: "site_key",
      id: "key_1",
    });
    await grantConsent(consent, siteId, "apply", {
      principal: "operator",
      id: "op_1",
    });
    await revokeConsent(consent, siteId, "apply", {
      principal: "operator",
      id: "op_2",
    });
    const events = await consent.eventsForSite(siteId);
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.action)).toEqual([
      "granted",
      "granted",
      "revoked",
    ]);
    expect(events.map((e) => e.kind)).toEqual(["audit", "apply", "apply"]);
    expect(events[0].principal).toBe("site_key");
    expect(events[2].principalId).toBe("op_2");
    expect(events.every((e) => e.id.startsWith("cev_"))).toBe(true);
  });

  it("re-grant after revoke is a separate event (assertion ≠ edit)", async () => {
    await grantConsent(consent, siteId, "audit", { principal: "operator", id: "o" });
    await revokeConsent(consent, siteId, "audit", { principal: "operator", id: "o" });
    await grantConsent(consent, siteId, "audit", { principal: "operator", id: "o" });
    expect((await consent.eventsForSite(siteId)).map((e) => e.action)).toEqual([
      "granted",
      "revoked",
      "granted",
    ]);
    // upsert row is still single latest state
    expect((await consent.forSite(siteId))).toHaveLength(1);
  });
});

describe("GET /sites/:siteId/consents", () => {
  it("returns every granted kind + full event history", async () => {
    await grantConsent(consent, siteId, "audit", { principal: "site_key", id: "k" });
    await grantConsent(consent, siteId, "publication", { principal: "operator", id: "op" });
    const res = await getConsents(siteId, `Bearer ${opKey}`);
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.site_id).toBe(siteId);
    expect(body.consents.map((c: { kind: string }) => c.kind).sort()).toEqual([
      "audit",
      "publication",
    ]);
    expect(body.events).toHaveLength(2);
  });

  it("viewer reads too (read-only is not a paid op)", async () => {
    const res = await getConsents(siteId, `Bearer ${viewerKey}`);
    expect(res.status).toBe(200);
  });

  it("401 no/unknown key; 404 foreign-tenant site", async () => {
    expect((await getConsents(siteId)).status).toBe(401);
    expect((await getConsents(siteId, "Bearer absk_x")).status).toBe(401);
    expect((await getConsents(foreignSiteId, `Bearer ${opKey}`)).status).toBe(404);
  });
});

describe("kind matrix — all four kinds manageable via API", () => {
  it("apply + publication grant/revoke through the same gate", async () => {
    for (const kind of ["apply", "publication", "inside_diagnostics"] as const) {
      const g = await api.request("/api/intel/consent", {
        method: "POST",
        headers: {
          authorization: `Bearer ${opKey}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ site_id: siteId, kind }),
      });
      expect(g.status).toBe(200);
      expect(
        await hasActiveConsent(consent, siteId, kind),
      ).toBe(true);
    }
    expect(CONSENT_KINDS).toEqual([
      "audit",
      "inside_diagnostics",
      "apply",
      "publication",
    ]);
  });
});

describe("dashboard consent forms", () => {
  const postForm = (site: string, cookie: string, body: string) =>
    ui.request(`/intel/sites/${site}/consent`, {
      method: "POST",
      headers: {
        cookie: `intel_session=${cookie}`,
        "content-type": "application/x-www-form-urlencoded",
      },
      body,
    });

  it("grant → revoke via form; events visible on the site page", async () => {
    const g = await postForm(siteId, opKey, "kind=publication&action=grant");
    expect(g.status).toBe(302);
    expect(await hasActiveConsent(consent, siteId, "publication")).toBe(true);

    const page = await ui.request(`/intel/sites/${siteId}`, {
      headers: { cookie: `intel_session=${opKey}` },
    });
    const html = await page.text();
    expect(html).toContain("Publication");
    expect(html).toContain("granted");

    const r = await postForm(siteId, opKey, "kind=publication&action=revoke");
    expect(r.status).toBe(302);
    expect(await hasActiveConsent(consent, siteId, "publication")).toBe(false);
    expect((await consent.eventsForSite(siteId)).map((e) => e.action)).toEqual([
      "granted",
      "revoked",
    ]);
  });

  it("viewer → 403; foreign site → 404; bad kind → redirect ?consent=invalid", async () => {
    expect(
      (await postForm(siteId, viewerKey, "kind=audit&action=revoke")).status,
    ).toBe(403);
    expect(
      (await postForm(foreignSiteId, opKey, "kind=audit&action=revoke")).status,
    ).toBe(404);
    const bad = await postForm(siteId, opKey, "kind=telepathy&action=grant");
    expect(bad.status).toBe(302);
    expect(bad.headers.get("location")).toContain("consent=invalid");
  });

  it("viewer sees the matrix without manage buttons", async () => {
    const res = await ui.request(`/intel/sites/${siteId}`, {
      headers: { cookie: `intel_session=${viewerKey}` },
    });
    const html = await res.text();
    expect(html).toContain("Inside diagnostics");
    expect(html).toContain("Fix apply");
    expect(html).not.toContain(">Grant<");
    expect(html).not.toContain(">Revoke<");
  });
});
