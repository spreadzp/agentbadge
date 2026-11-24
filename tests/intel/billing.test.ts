// EPIC-262 (SLICE-262-21): billing connector — signature verify both
// providers, event→lifecycle mapping, dedupe on external id, honest
// unconfigured/bad-sig/unmapped answers.
import { describe, it, expect, beforeEach } from "vitest";
import { createHmac } from "node:crypto";
import { Hono } from "hono";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  type IntelRegistryStores,
} from "../../src/server/lib/intel/registry";
import {
  createMemoryEntitlementStore,
  createMemoryEntitlementEventStore,
} from "../../src/server/lib/intel/entitlement";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-billing",
  signingPrivateKey: Buffer.alloc(32, 17).toString("base64"),
} as IntelEnvConfig)!;

const STRIPE_SECRET = "whsec_test_stripe";
const FS_SECRET = "fs_sec_test";
const T0 = "2026-11-24T12:00:00Z";

let stores: IntelRegistryStores;
let registry: ReturnType<typeof createIntelRegistryService>;
let entitlements: ReturnType<typeof createMemoryEntitlementStore>;
let events: ReturnType<typeof createMemoryEntitlementEventStore>;
let tenantId: string;
let app: Hono;

const stripeSig = (body: string) => {
  const t = Math.floor(Date.parse(T0) / 1000);
  const v1 = createHmac("sha256", STRIPE_SECRET)
    .update(`${t}.${body}`, "utf8")
    .digest("hex");
  return `t=${t},v1=${v1}`;
};

const fsSig = (body: string) =>
  createHmac("sha256", FS_SECRET).update(body, "utf8").digest("hex");

const post = (provider: string, body: string, sig?: string, header?: string) =>
  app.request(`/api/intel/billing/webhook/${provider}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      ...(sig ? { [header ?? "stripe-signature"]: sig } : {}),
    },
    body,
  });

const stripeEvent = (type: string, meta: Record<string, string> = {}, id = "evt_1") =>
  JSON.stringify({
    id, type, created: Math.floor(Date.parse(T0) / 1000),
    data: { object: { metadata: meta } },
  });

const fsEvent = (type: string, install: Record<string, unknown> = {}, id = "77") =>
  JSON.stringify({
    id, type, created: T0,
    objects: { install },
  });

beforeEach(async () => {
  stores = createMemoryIntelRegistry();
  registry = createIntelRegistryService(stores);
  entitlements = createMemoryEntitlementStore();
  events = createMemoryEntitlementEventStore();
  const tenant = await registry.createTenant({ slug: "t", name: "T" });
  tenantId = tenant.id;
  const customer = await registry.createCustomer(tenant.id, { name: "C" });
  await registry.createSite(customer.id, { domains: ["x.dev"] });
  app = new Hono();
  app.route(
    "/api/intel",
    createIntelApiRoutes({
      key,
      registry,
      registryStores: stores,
      entitlement: entitlements,
      entitlementEvents: events,
      billingSecrets: { stripe: STRIPE_SECRET, freemius: FS_SECRET },
    }),
  );
});

describe("POST /billing/webhook — authenticity", () => {
  it("503 for unconfigured provider", async () => {
    const res = await post("adyen", "{}");
    expect(res.status).toBe(503);
    expect((await res.json()).error).toBe("billing_unconfigured");
  });

  it("401 bad signature (stripe)", async () => {
    const res = await post("stripe", stripeEvent("checkout.session.completed", { tenant_id: tenantId, plan: "pilot" }), "t=1,v1=bad");
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("bad_signature");
  });

  it("401 missing signature; 400 bad payload", async () => {
    expect((await post("stripe", "{}")).status).toBe(401);
    const body = "not json";
    const res = await post("stripe", body, stripeSig(body));
    expect(res.status).toBe(400);
  });
});

describe("stripe → lifecycle", () => {
  it("checkout.session.completed → assign_plan (active)", async () => {
    const body = stripeEvent("checkout.session.completed", {
      tenant_id: tenantId, plan: "pilot",
    });
    const res = await post("stripe", body, stripeSig(body));
    expect(res.status).toBe(200);
    const { results } = await res.json();
    expect(results[0].applied).toBe(true);
    const ent = await entitlements.getByTenant(tenantId);
    expect(ent?.plan).toBe("pilot");
    expect(ent?.status).toBe("active");
    expect(ent?.coveredSiteIds).toHaveLength(1); // auto-cover
    const evs = await events.forTenant(tenantId);
    expect(evs[0].actor).toBe("system:billing:stripe");
  });

  it("payment_failed → past_due; invoice.paid → payment_recovered → active", async () => {
    await post("stripe", stripeEvent("checkout.session.completed", { tenant_id: tenantId, plan: "pilot" }), stripeSig(stripeEvent("checkout.session.completed", { tenant_id: tenantId, plan: "pilot" })));
    const pf = stripeEvent("invoice.payment_failed", { tenant_id: tenantId }, "evt_pf");
    await post("stripe", pf, stripeSig(pf));
    expect((await entitlements.getByTenant(tenantId))?.status).toBe("past_due");
    const paid = stripeEvent("invoice.paid", { tenant_id: tenantId }, "evt_paid");
    await post("stripe", paid, stripeSig(paid));
    expect((await entitlements.getByTenant(tenantId))?.status).toBe("active");
    expect((await events.forTenant(tenantId)).map((e) => e.action)).toEqual([
      "assign_plan", "payment_failed", "payment_recovered",
    ]);
  });

  it("same externalId → deduped (applied:false duplicate)", async () => {
    const body = stripeEvent("checkout.session.completed", { tenant_id: tenantId, plan: "pilot" }, "evt_dup");
    await post("stripe", body, stripeSig(body));
    const res = await post("stripe", body, stripeSig(body));
    const { results } = await res.json();
    expect(results[0].reason).toBe("duplicate");
    // still ONE assign event
    expect((await events.forTenant(tenantId)).filter((e) => e.action === "assign_plan")).toHaveLength(1);
  });

  it("unhandled type → applied:false ignore, not an error", async () => {
    const body = stripeEvent("payment_method.attached", { tenant_id: tenantId }, "evt_x");
    const res = await post("stripe", body, stripeSig(body));
    const { results } = await res.json();
    expect(results[0].applied).toBe(false);
    expect(results[0].reason).toContain("unhandled");
  });

  it("unmapped (no tenant metadata) → 422 honest", async () => {
    const body = stripeEvent("invoice.payment_failed", {}, "evt_nometa");
    const res = await post("stripe", body, stripeSig(body));
    expect(res.status).toBe(422);
  });
});

describe("freemius → lifecycle", () => {
  it("install.subscription.created → assign_plan", async () => {
    const body = fsEvent("install.subscription.created", {
      tenant_id: tenantId, plan_title: "Studio",
    });
    const res = await post("freemius", body, fsSig(body), "x-fs-signature");
    expect(res.status).toBe(200);
    const ent = await entitlements.getByTenant(tenantId);
    expect(ent?.plan).toBe("studio");
    expect(ent?.status).toBe("active");
  });

  it("401 bad signature (freemius)", async () => {
    const res = await post("freemius", fsEvent("install.subscription.canceled", { tenant_id: tenantId }), "bad", "x-fs-signature");
    expect(res.status).toBe(401);
  });

  it("canceled → terminal", async () => {
    const c1 = fsEvent("install.subscription.created", { tenant_id: tenantId, plan_title: "Pilot" }, "1");
    await post("freemius", c1, fsSig(c1), "x-fs-signature");
    const c2 = fsEvent("install.subscription.canceled", { tenant_id: tenantId }, "2");
    await post("freemius", c2, fsSig(c2), "x-fs-signature");
    expect((await entitlements.getByTenant(tenantId))?.status).toBe("canceled");
  });
});
