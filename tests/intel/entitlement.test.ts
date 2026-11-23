// EPIC-262 (SLICE-262-19a): entitlement decision matrix + store.
// Pure checkEntitlement over D-262-Q8 expiry phases; entitlement is
// tenant-attached and independent of site_key/consent (D-262-Q7).
import { describe, it, expect, beforeEach } from "vitest";
import {
  checkEntitlement,
  createMemoryEntitlementStore,
  type IntelEntitlement,
} from "../../src/server/lib/intel/entitlement";

const NOW = "2026-11-20T12:00:00Z";

function ent(over: Partial<IntelEntitlement> = {}): IntelEntitlement {
  return {
    id: "ent_01K",
    tenantId: "tnt_1",
    plan: "pilot",
    status: "active",
    coveredSiteIds: [],
    perSiteLimits: {},
    validFrom: "2026-11-01T00:00:00Z",
    validUntil: "2026-12-01T00:00:00Z",
    graceUntil: "2026-12-08T00:00:00Z",
    createdAt: "2026-11-01T00:00:00Z",
    updatedAt: "2026-11-01T00:00:00Z",
    ...over,
  };
}

describe("checkEntitlement — phase matrix (D-262-Q8)", () => {
  it("no entitlement → denied no_entitlement", () => {
    const d = checkEntitlement(null, "deep_scan", "site_1", NOW);
    expect(d).toEqual({ allowed: false, reason: "no_entitlement" });
  });

  it("active inside validity → allowed", () => {
    const d = checkEntitlement(ent(), "deep_scan", "site_1", NOW);
    expect(d).toEqual({ allowed: true, phase: "active" });
  });

  it("trial inside validity → allowed phase trial", () => {
    const d = checkEntitlement(ent({ status: "trial" }), "deep_scan", "s", NOW);
    expect(d).toEqual({ allowed: true, phase: "trial" });
  });

  it("past valid_until but inside grace → allowed + in_grace warning", () => {
    const d = checkEntitlement(
      ent({ status: "past_due" }),
      "deep_scan",
      "s",
      "2026-12-05T00:00:00Z",
    );
    expect(d).toEqual({
      allowed: true,
      phase: "grace",
      warning: "in_grace",
    });
  });

  it("past grace_until → soft-off deny regardless of status", () => {
    for (const status of ["active", "past_due"] as const) {
      const d = checkEntitlement(
        ent({ status }),
        "deep_scan",
        "s",
        "2026-12-09T00:00:00Z",
      );
      expect(d).toEqual({ allowed: false, reason: "soft_off" });
    }
  });

  it("canceled → deny even inside validity window", () => {
    const d = checkEntitlement(ent({ status: "canceled" }), "deep_scan", "s", NOW);
    expect(d).toEqual({ allowed: false, reason: "canceled" });
  });

  it("expired → deny", () => {
    const d = checkEntitlement(ent({ status: "expired" }), "deep_scan", "s", NOW);
    expect(d).toEqual({ allowed: false, reason: "expired" });
  });

  it("before valid_from → deny not_yet_valid", () => {
    const d = checkEntitlement(
      ent({ validFrom: "2026-12-01T00:00:00Z" }),
      "deep_scan",
      "s",
      NOW,
    );
    expect(d).toEqual({ allowed: false, reason: "not_yet_valid" });
  });
});

describe("checkEntitlement — site coverage (per-site limits, D-262-Q7)", () => {
  it("empty coveredSiteIds → any site allowed", () => {
    const d = checkEntitlement(ent(), "deep_scan", "site_x", NOW);
    expect(d.allowed).toBe(true);
  });

  it("non-empty list without site → site_not_covered", () => {
    const d = checkEntitlement(
      ent({ coveredSiteIds: ["site_a", "site_b"] }),
      "deep_scan",
      "site_x",
      NOW,
    );
    expect(d).toEqual({ allowed: false, reason: "site_not_covered" });
  });

  it("site in list → allowed", () => {
    const d = checkEntitlement(
      ent({ coveredSiteIds: ["site_a"] }),
      "deep_scan",
      "site_a",
      NOW,
    );
    expect(d.allowed).toBe(true);
  });
});

describe("memory store", () => {
  let store: ReturnType<typeof createMemoryEntitlementStore>;
  beforeEach(() => {
    store = createMemoryEntitlementStore();
  });

  it("get returns null when absent", async () => {
    expect(await store.getByTenant("tnt_1")).toBeNull();
  });

  it("upsert create → get round-trip", async () => {
    await store.upsert(ent());
    const got = await store.getByTenant("tnt_1");
    expect(got?.id).toBe("ent_01K");
    expect(got?.coveredSiteIds).toEqual([]);
  });

  it("one entitlement per tenant — upsert replaces", async () => {
    await store.upsert(ent());
    await store.upsert(
      ent({ id: "ent_02K", status: "past_due" }),
    );
    const got = await store.getByTenant("tnt_1");
    expect(got?.id).toBe("ent_02K");
    expect(got?.status).toBe("past_due");
  });
});
