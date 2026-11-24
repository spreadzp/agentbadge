// EPIC-262 (SLICE-262-22): churn & transfer — site transfer keeps
// identity+history while resetting authority (coverage, consent,
// ownership re-verify); export is open (own data, soft_off-safe);
// re-activation = assignPlan on canceled.
import { describe, it, expect, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
} from "../../src/server/lib/intel/registry";
import { inviteOperator } from "../../src/server/lib/intel/registry/operators";
import {
  createMemoryEntitlementStore,
  createMemoryEntitlementEventStore,
  assignPlan,
} from "../../src/server/lib/intel/entitlement";
import {
  createMemoryIntelConsentStore,
  grantConsent,
  hasActiveConsent,
} from "../../src/server/lib/intel/consent";
import { createMemoryScanJobStore } from "../../src/server/lib/intel/scan/memory";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-transfer",
  signingPrivateKey: Buffer.alloc(32, 13).toString("base64"),
} as IntelEnvConfig)!;

const NOW = new Date().toISOString();

let stores: IntelRegistryStores;
let registry: ReturnType<typeof createIntelRegistryService>;
let entitlements: ReturnType<typeof createMemoryEntitlementStore>;
let events: ReturnType<typeof createMemoryEntitlementEventStore>;
let consent: ReturnType<typeof createMemoryIntelConsentStore>;
let app: Hono;
let srcTenant: string, dstTenant: string;
let srcCustomer: string, dstCustomer: string;
let siteId: string;
let opKey: string, dstOpKey: string, viewerKey: string;

const post = (path: string, body: unknown, token: string) =>
  app.request(`/api/intel${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
const get = (path: string, token: string) =>
  app.request(`/api/intel${path}`, { headers: { authorization: `Bearer ${token}` } });

const tenantSites = async (tenantId: string) => {
  const out: string[] = [];
  for (const cu of await stores.customers.forTenant(tenantId))
    for (const s of await stores.sites.forCustomer(cu.id))
      if (s.status === "active") out.push(s.id);
  return out.sort();
};

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  entitlements = createMemoryEntitlementStore();
  events = createMemoryEntitlementEventStore();
  consent = createMemoryIntelConsentStore();

  srcTenant = (await registry.createTenant({ slug: "src", name: "Src" })).id;
  dstTenant = (await registry.createTenant({ slug: "dst", name: "Dst" })).id;
  srcCustomer = (await registry.createCustomer(srcTenant, { name: "SC" })).id;
  dstCustomer = (await registry.createCustomer(dstTenant, { name: "DC" })).id;
  siteId = (await registry.createSite(srcCustomer, { domains: ["x.dev"] })).id;
  await registry.mintSiteKey(siteId);
  await registry.recordOwnershipProof(siteId, "domain_control", {
    method: "dns_txt", verifiedAt: new Date(),
  });
  opKey = (await inviteOperator(stores, srcTenant, { email: "o@s.dev", role: "operator" })).plaintext;
  dstOpKey = (await inviteOperator(stores, dstTenant, { email: "o@d.dev", role: "operator" })).plaintext;
  viewerKey = (await inviteOperator(stores, srcTenant, { email: "v@s.dev", role: "viewer" })).plaintext;

  await grantConsent(consent, siteId, "audit", { principal: "operator", id: "op_1" });
  await grantConsent(consent, siteId, "publication", { principal: "operator", id: "op_1" });
  await assignPlan(
    { entitlements, events },
    { tenantId: srcTenant, planCode: "pilot", tenantSiteIds: await tenantSites(srcTenant), now: NOW, actor: { principal: "operator", id: "op_1" } },
  );
  await assignPlan(
    { entitlements, events },
    { tenantId: dstTenant, planCode: "pilot", tenantSiteIds: await tenantSites(dstTenant), now: NOW, actor: { principal: "operator", id: "op_2" } },
  );

  app = new Hono();
  app.route("/api/intel", createIntelApiRoutes({
    key, registry, registryStores: stores,
    entitlement: entitlements, entitlementEvents: events, consent,
    scanJobs: createMemoryScanJobStore(),
  }));
});

describe("site transfer", () => {
  it("moves site preserving site_id; resets coverage+consent+reverify", async () => {
    const res = await post(`/sites/${siteId}/transfer`, { to_customer: dstCustomer }, opKey);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.site.id).toBe(siteId);
    expect(j.site.customerId).toBe(dstCustomer);
    expect(j.consent_revocations).toBe(2);
    expect(j.reverify_flags).toBe(1);
    expect(j.coverage).toEqual({ removed_from_source: true, added_to_target: true });

    // history intact — site row same id
    expect((await stores.sites.byId(siteId))?.customerId).toBe(dstCustomer);
    // consents revoked by system
    expect(await hasActiveConsent(consent, siteId, "audit")).toBe(false);
    const evs = await consent.eventsForSite(siteId);
    expect(evs.filter((e) => e.action === "revoked" && e.principal === "system")).toHaveLength(2);
    // coverage both sides
    expect((await entitlements.getByTenant(srcTenant))?.coveredSiteIds).not.toContain(siteId);
    expect((await entitlements.getByTenant(dstTenant))?.coveredSiteIds).toContain(siteId);
    // ownership due
    const p = await stores.ownership.byScope(siteId, "domain_control");
    expect(p?.reverifyAfter && p.reverifyAfter <= new Date().toISOString()).toBe(true);
    // events on both tenants
    const acts = (t: string) => events.forTenant(t).then((l) => l.map((e) => e.action));
    expect(await acts(srcTenant)).toContain("transfer_out");
    expect(await acts(dstTenant)).toContain("transfer_in");
  });

  it("old tenant loses site → 404 on its scoped routes", async () => {
    await post(`/sites/${siteId}/transfer`, { to_customer: dstCustomer }, opKey);
    const res = await post(`/sites/${siteId}/transfer`, { to_customer: srcCustomer }, opKey);
    expect(res.status).toBe(404); // site is no longer in src tenant
  });

  it("over-limit target → site lands uncovered, honest event", async () => {
    // dst on trial (limit 1) + already has a site
    await assignPlan(
      { entitlements, events },
      { tenantId: dstTenant, planCode: "trial", coveredSiteIds: ["site_other"], tenantSiteIds: ["site_other"], now: NOW, actor: { principal: "operator", id: "op_2" } },
    );
    const res = await post(`/sites/${siteId}/transfer`, { to_customer: dstCustomer }, opKey);
    const j = await res.json();
    expect(j.coverage.added_to_target).toBe("over_limit");
    expect((await entitlements.getByTenant(dstTenant))?.coveredSiteIds).not.toContain(siteId);
    const evs = await events.forTenant(dstTenant);
    expect(evs.at(-1)?.reason).toContain("uncovered");
  });

  it("guards: viewer 403, foreign site 404, same-tenant 422, bad body 400", async () => {
    expect((await post(`/sites/${siteId}/transfer`, { to_customer: dstCustomer }, viewerKey)).status).toBe(403);
    expect((await post(`/sites/site_nope/transfer`, { to_customer: dstCustomer }, opKey)).status).toBe(404);
    expect((await post(`/sites/${siteId}/transfer`, { to_customer: srcCustomer }, opKey)).status).toBe(422);
    expect((await post(`/sites/${siteId}/transfer`, {}, opKey)).status).toBe(400);
    // dst operator cannot pull the site toward themselves
    expect((await post(`/sites/${siteId}/transfer`, { to_customer: dstCustomer }, dstOpKey)).status).toBe(404);
  });
});

describe("export", () => {
  it("returns agentbadge-export/1 bundle, viewer-readable, no keyHash", async () => {
    const res = await get("/export", viewerKey);
    expect(res.status).toBe(200);
    const j = await res.json();
    expect(j.format).toBe("agentbadge-export/1");
    expect(j.tenant.id).toBe(srcTenant);
    const site = j.sites.find((s: { site: { id: string } }) => s.site.id === siteId);
    expect(site).toBeTruthy();
    expect(site.consents).toHaveLength(2);
    expect(site.consent_events.length).toBeGreaterThanOrEqual(2);
    expect(JSON.stringify(site.site_keys)).not.toContain("keyHash");
    expect(site.site_keys[0].keyPrefix).toMatch(/^absk_/);
    expect(j.entitlement.plan).toBe("pilot");
    expect(j.entitlement_events.length).toBeGreaterThanOrEqual(1);
  });

  it("works under canceled entitlement (soft_off export right)", async () => {
    const ent = await entitlements.getByTenant(srcTenant);
    await entitlements.upsert({ ...ent!, status: "canceled" });
    expect((await get("/export", opKey)).status).toBe(200);
  });
});

describe("re-activation", () => {
  it("canceled → assignPlan restores access, history untouched", async () => {
    const ent = await entitlements.getByTenant(srcTenant);
    await entitlements.upsert({ ...ent!, status: "canceled" });
    const res = await app.request("/api/intel/entitlement/plan", {
      method: "PUT",
      headers: { "content-type": "application/json", authorization: `Bearer ${opKey}` },
      body: JSON.stringify({ plan: "pilot" }),
    });
    expect(res.status).toBe(200);
    expect((await entitlements.getByTenant(srcTenant))?.status).toBe("active");
    // same site still covered via auto-cover
    expect((await entitlements.getByTenant(srcTenant))?.coveredSiteIds).toContain(siteId);
  });
});
