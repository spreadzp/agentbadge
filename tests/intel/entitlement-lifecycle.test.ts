// EPIC-262 (SLICE-262-19b): entitlement automation — plan catalog
// + coverage limits, transition matrix, time-derived sweep,
// append-only events, admin API gates.
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
  transitionEntitlement,
  sweepEntitlement,
  effectiveStatus,
  planFor,
  resolveCoverage,
  type LifecycleDeps,
  type Actor,
} from "../../src/server/lib/intel/entitlement";
import type { IntelEntitlement } from "../../src/server/lib/intel/entitlement";
import { createIntelApiRoutes } from "../../src/server/routes/intel";
import { resolveIntelSigningKey } from "../../src/server/lib/intel/keys";
import type { IntelEnvConfig } from "../../src/config/env";

const key = resolveIntelSigningKey({
  enabled: true,
  keyId: "intel-test-ent19b",
  signingPrivateKey: Buffer.alloc(32, 11).toString("base64"),
} as IntelEnvConfig)!;

const T0 = "2026-01-01T00:00:00Z";
const DAY = 86_400_000;
const at = (days: number) => new Date(Date.parse(T0) + days * DAY).toISOString();
const OP: Actor = { principal: "operator", id: "op_1" };

let deps: LifecycleDeps;
let events: ReturnType<typeof createMemoryEntitlementEventStore>;

const entOf = (over: Partial<IntelEntitlement> = {}): IntelEntitlement => ({
  id: "ent_1",
  tenantId: "tnt_1",
  plan: "pilot",
  status: "active",
  coveredSiteIds: [],
  perSiteLimits: {},
  validFrom: T0,
  validUntil: at(30),
  graceUntil: at(37),
  createdAt: T0,
  updatedAt: T0,
  ...over,
});

beforeEach(() => {
  deps = {
    entitlements: createMemoryEntitlementStore(),
    events: createMemoryEntitlementEventStore(),
  };
  events = deps.events;
});

describe("plans — catalog + coverage", () => {
  it("planFor resolves codes, unknown → null", () => {
    expect(planFor("pilot")?.siteLimit).toBe(5);
    expect(planFor("enterprise")).toBeNull();
  });

  it("resolveCoverage: explicit within limit ok, over → over_limit", () => {
    const p = planFor("trial")!;
    expect(resolveCoverage(p, ["s1"], []).ok).toBe(true);
    expect(resolveCoverage(p, ["s1", "s2"], [])).toEqual({
      ok: false,
      reason: "over_limit",
    });
  });

  it("auto-cover fills up to siteLimit deterministically", () => {
    const p = planFor("pilot")!;
    const r = resolveCoverage(p, undefined, ["s1", "s2", "s3", "s4", "s5", "s6"]);
    expect(r).toEqual({ ok: true, siteIds: ["s1", "s2", "s3", "s4", "s5"] });
  });
});

describe("assignPlan + transitions", () => {
  it("assign trial → status trial with 30d window + event", async () => {
    const r = await assignPlan(deps, {
      tenantId: "tnt_1", planCode: "trial",
      tenantSiteIds: ["s1", "s2"], now: T0, actor: OP,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entitlement.status).toBe("trial");
    expect(r.entitlement.validUntil).toBe(at(30));
    expect(r.entitlement.coveredSiteIds).toEqual(["s1"]); // trial limit 1
    const evs = await events.forTenant("tnt_1");
    expect(evs).toHaveLength(1);
    expect(evs[0].action).toBe("assign_plan");
    expect(evs[0].fromStatus).toBeNull();
  });

  it("assign paid plan → active immediately", async () => {
    const r = await assignPlan(deps, {
      tenantId: "tnt_1", planCode: "pilot", tenantSiteIds: [],
      now: T0, actor: OP,
    });
    expect(r.ok && r.entitlement.status).toBe("active");
  });

  it("over-limit explicit coverage → 422 reason, no write", async () => {
    const r = await assignPlan(deps, {
      tenantId: "tnt_1", planCode: "trial",
      coveredSiteIds: ["s1", "s2"], tenantSiteIds: [],
      now: T0, actor: OP,
    });
    expect(r.ok).toBe(false);
    expect(await deps.entitlements.getByTenant("tnt_1")).toBeNull();
  });

  it("transition matrix: trial→activate→payment_failed→payment_recovered→cancel", async () => {
    await deps.entitlements.upsert(entOf({ plan: "trial", status: "trial", graceUntil: at(30) }));
    const a = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "activate", now: T0, actor: OP });
    expect(a.ok && a.entitlement.status).toBe("active");
    const pf = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "payment_failed", now: at(10), actor: OP });
    expect(pf.ok && pf.entitlement.status).toBe("past_due");
    const pr = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "payment_recovered", now: at(12), actor: OP });
    expect(pr.ok && pr.entitlement.status).toBe("active");
    const cancel = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "cancel", now: at(13), actor: OP });
    expect(cancel.ok && cancel.entitlement.status).toBe("canceled");
    // terminal — nothing resumes a cancel
    const after = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "activate", now: at(14), actor: OP });
    expect(after.ok).toBe(false);
    // failed transitions record NOTHING — events are state changes
    expect((await events.forTenant("tnt_1")).map((e) => e.action)).toEqual([
      "activate", "payment_failed", "payment_recovered", "cancel",
    ]);
  });

  it("invalid transitions → ok:false, record untouched", async () => {
    await deps.entitlements.upsert(entOf({ status: "expired" }));
    const r = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "renew", now: T0, actor: OP });
    expect(r.ok).toBe(false);
    expect((await deps.entitlements.getByTenant("tnt_1"))!.updatedAt).toBe(T0);
  });

  it("renew extends running period; after expiry anchors at now", async () => {
    await deps.entitlements.upsert(entOf());
    const mid = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "renew", now: at(10), actor: OP });
    expect(mid.ok && mid.entitlement.validUntil).toBe(at(60)); // 30+30
    await deps.entitlements.upsert({ ...(await deps.entitlements.getByTenant("tnt_1"))!, validUntil: at(20), graceUntil: at(27) });
    const late = await transitionEntitlement(deps, { tenantId: "tnt_1", action: "renew", now: at(40), actor: OP });
    expect(late.ok && late.entitlement.validUntil).toBe(at(70)); // 40+30
  });
});

describe("sweepEntitlement — time-derived automation", () => {
  it("active → past_due at validUntil, → expired at graceUntil", async () => {
    await deps.entitlements.upsert(entOf());
    expect((await sweepEntitlement(deps, "tnt_1", at(31))).changed).toBe(true);
    expect((await deps.entitlements.getByTenant("tnt_1"))!.status).toBe("past_due");
    expect((await sweepEntitlement(deps, "tnt_1", at(38))).changed).toBe(true);
    expect((await deps.entitlements.getByTenant("tnt_1"))!.status).toBe("expired");
    const evs = await events.forTenant("tnt_1");
    expect(evs.map((e) => e.action)).toEqual(["sweep_past_due", "sweep_expire"]);
    expect(evs[0].actor).toBe("system:sweep");
  });

  it("trial → expired at validUntil (no grace owed)", async () => {
    await deps.entitlements.upsert(entOf({ plan: "trial", status: "trial", graceUntil: at(30) }));
    expect((await sweepEntitlement(deps, "tnt_1", at(30))).changed).toBe(true);
    expect((await deps.entitlements.getByTenant("tnt_1"))!.status).toBe("expired");
  });

  it("past_due expires when dunning window ends", async () => {
    await deps.entitlements.upsert(
      entOf({ status: "past_due", updatedAt: at(30), validUntil: at(30), graceUntil: at(44) }),
    );
    // pilot.pastDueDays = 14 → updatedAt(30)+14 = at(44)
    expect((await sweepEntitlement(deps, "tnt_1", at(40))).changed).toBe(false);
    expect((await sweepEntitlement(deps, "tnt_1", at(44))).changed).toBe(true);
    expect((await deps.entitlements.getByTenant("tnt_1"))!.status).toBe("expired");
  });

  it("effectiveStatus mirrors sweep without persisting", () => {
    const ent = entOf();
    expect(effectiveStatus(ent, at(10))).toBe("active");
    expect(effectiveStatus(ent, at(35))).toBe("past_due");
    expect(effectiveStatus(ent, at(38))).toBe("expired");
    expect(effectiveStatus(entOf({ status: "trial", graceUntil: at(30) }), at(30))).toBe("expired");
  });
});

describe("admin API — gates", () => {
  let stores: IntelRegistryStores;
  let opKey: string;
  let viewerKey: string;
  let tenantId: string;
  let app: Hono;

  beforeEach(async () => {
    stores = createMemoryIntelRegistry();
    const registry = createIntelRegistryService(stores);
    const tenant = await registry.createTenant({ slug: "t", name: "T" });
    tenantId = tenant.id;
    const customer = await registry.createCustomer(tenant.id, { name: "C" });
    await registry.createSite(customer.id, { domains: ["a.dev"] });
    opKey = (await inviteOperator(stores, tenantId, { email: "o@t.dev", role: "operator" })).plaintext;
    viewerKey = (await inviteOperator(stores, tenantId, { email: "v@t.dev", role: "viewer" })).plaintext;
    app = new Hono();
    app.route(
      "/api/intel",
      createIntelApiRoutes({
        key,
        registry,
        registryStores: stores,
        entitlement: deps.entitlements,
        entitlementEvents: deps.events,
      }),
    );
  });

  it("GET /entitlement: 401 anonymous, viewer reads", async () => {
    expect((await app.request("/api/intel/entitlement")).status).toBe(401);
    const res = await app.request("/api/intel/entitlement", {
      headers: { authorization: `Bearer ${viewerKey}` },
    });
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.entitlement).toBeNull();
    expect(body.plans.length).toBe(3);
  });

  it("PUT /plan: viewer 403, operator assigns; events accumulate", async () => {
    const deny = await app.request("/api/intel/entitlement/plan", {
      method: "PUT",
      headers: { authorization: `Bearer ${viewerKey}`, "content-type": "application/json" },
      body: JSON.stringify({ plan: "pilot" }),
    });
    expect(deny.status).toBe(403);
    const ok = await app.request("/api/intel/entitlement/plan", {
      method: "PUT",
      headers: { authorization: `Bearer ${opKey}`, "content-type": "application/json" },
      body: JSON.stringify({ plan: "pilot" }),
    });
    expect(ok.status).toBe(200);
    const body = await ok.json();
    expect(body.entitlement.status).toBe("active");
    expect(body.entitlement.coveredSiteIds).toHaveLength(1); // auto-cover
    const evs = await deps.events.forTenant(tenantId);
    expect(evs[0].actor).toContain("operator:");
  });

  it("POST /transition validates action + applies", async () => {
    await app.request("/api/intel/entitlement/plan", {
      method: "PUT",
      headers: { authorization: `Bearer ${opKey}`, "content-type": "application/json" },
      body: JSON.stringify({ plan: "trial" }),
    });
    const bad = await app.request("/api/intel/entitlement/transition", {
      method: "POST",
      headers: { authorization: `Bearer ${opKey}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "refund" }),
    });
    expect(bad.status).toBe(400);
    const ok = await app.request("/api/intel/entitlement/transition", {
      method: "POST",
      headers: { authorization: `Bearer ${opKey}`, "content-type": "application/json" },
      body: JSON.stringify({ action: "activate" }),
    });
    expect(ok.status).toBe(200);
  });

  it("POST /sweep derives + records system transition", async () => {
    await deps.entitlements.upsert({
      ...entOf({ tenantId }),
      validUntil: "2020-01-01T00:00:00Z",
      graceUntil: "2030-01-01T00:00:00Z",
    });
    const res = await app.request("/api/intel/entitlement/sweep", {
      method: "POST",
      headers: { authorization: `Bearer ${opKey}` },
    });
    expect(res.status).toBe(200);
    expect((await res.json()).changed).toBe(true);
    expect((await deps.entitlements.getByTenant(tenantId))!.status).toBe("past_due");
  });
});
