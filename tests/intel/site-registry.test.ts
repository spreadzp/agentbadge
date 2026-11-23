// EPIC-262 (SLICE-262-2): site registry — Tenant→Customer→Site→
// {Domains, Environment}; site_key mint/rotate/revoke/authenticate;
// ownership_status двумя независимыми scope'ами (D-262-Q5/Q7/Q9).
import { describe, it, expect, beforeEach } from "vitest";
import { createHash } from "node:crypto";
import {
  createMemoryIntelRegistry,
  createIntelRegistryService,
  pickIntelRegistryStores,
  type IntelRegistryStores,
  type IntelRegistryService,
} from "../../src/server/lib/intel/registry";

let stores: IntelRegistryStores;
let svc: IntelRegistryService;

beforeEach(() => {
  stores = createMemoryIntelRegistry();
  svc = createIntelRegistryService(stores);
});

async function seedSite(
  environment: "production" | "staging" | "development" = "production",
  domains = ["bakery.com", "www.bakery.com"],
) {
  const tenant =
    (await stores.tenants.bySlug("pryme")) ??
    (await svc.createTenant({ slug: "pryme", name: "Pryme" }));
  const customer = await svc.createCustomer(tenant.id, { name: "Bakery LLC" });
  const site = await svc.createSite(customer.id, { environment, domains });
  return { tenant, customer, site };
}

describe("hierarchy — Tenant→Customer→Site→Domains", () => {
  it("creates the chain with stable ULID identities", async () => {
    const { tenant, customer, site } = await seedSite();
    expect(tenant.id).toMatch(/^tnt_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(customer.id).toMatch(/^cus_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(site.id).toMatch(/^site_[0-9A-HJKMNP-TV-Z]{26}$/);
    expect(customer.tenantId).toBe(tenant.id);
    expect(site.customerId).toBe(customer.id);
    expect(site.environment).toBe("production");
  });

  it("site owns domains; first domain becomes primary", async () => {
    const { site } = await seedSite();
    const domains = await stores.domains.forSite(site.id);
    expect(domains.map((d) => d.hostname).sort()).toEqual([
      "bakery.com",
      "www.bakery.com",
    ]);
    expect(domains.filter((d) => d.isPrimary)).toHaveLength(1);
    expect(domains.find((d) => d.isPrimary)!.hostname).toBe("bakery.com");
  });

  it("hostname is globally unique — second site cannot claim it", async () => {
    const { customer } = await seedSite();
    await expect(
      svc.createSite(customer.id, { domains: ["bakery.com"] }),
    ).rejects.toThrow(/hostname/i);
  });

  it("domain change does NOT change site_id (D-262-Q9)", async () => {
    const { site } = await seedSite();
    const moved = await svc.addDomain(site.id, "bakery-new.com");
    const domains = await stores.domains.forSite(site.id);
    expect(moved.hostname).toBe("bakery-new.com");
    expect(domains.map((d) => d.hostname)).toContain("bakery-new.com");
    const reloaded = await stores.sites.byId(site.id);
    expect(reloaded!.id).toBe(site.id); // identity survives domain moves
  });

  it("environment defaults production; staging sites are distinguishable", async () => {
    const { site } = await seedSite("staging");
    expect(site.environment).toBe("staging");
  });
});

describe("site_key — scoped credential (hash-only storage)", () => {
  it("mint returns plaintext once, stores sha256+prefix only", async () => {
    const { site } = await seedSite();
    const { plaintext, record } = await svc.mintSiteKey(site.id);
    expect(plaintext).toMatch(/^absk_[A-Za-z0-9_-]{20,}$/);
    expect(record.siteId).toBe(site.id);
    expect(record.status).toBe("active");
    expect(record.keyHash).toBe(
      createHash("sha256").update(plaintext).digest("hex"),
    );
    expect(JSON.stringify(record)).not.toContain(plaintext);
    expect(record.keyPrefix).toBe(plaintext.slice(0, 13));
  });

  it("authenticate resolves plaintext → site context for the boundary", async () => {
    const { site } = await seedSite();
    const { plaintext } = await svc.mintSiteKey(site.id);
    const ctx = await svc.authenticateSiteKey(plaintext);
    expect(ctx).not.toBeNull();
    expect(ctx!.site_id).toBe(site.id);
    // wrong / unknown key → null, not throw
    expect(await svc.authenticateSiteKey("absk_wrongwrongwrong")).toBeNull();
  });

  it("rotate = new active key + old revoked with lineage (atomic)", async () => {
    const { site } = await seedSite();
    const first = await svc.mintSiteKey(site.id);
    const second = await svc.rotateSiteKey(first.record.id);
    expect(second.plaintext).not.toBe(first.plaintext);
    const old = await stores.siteKeys.byId(first.record.id);
    expect(old!.status).toBe("revoked");
    const keys = await stores.siteKeys.forSite(site.id);
    const active = keys.filter((k) => k.status === "active");
    expect(active).toHaveLength(1);
    expect(active[0].rotatedFromId).toBe(first.record.id);
    // old plaintext must NOT authenticate post-rotation
    expect(await svc.authenticateSiteKey(first.plaintext)).toBeNull();
    expect(await svc.authenticateSiteKey(second.plaintext)).not.toBeNull();
  });

  it("revoke is immediate — security revocation wins (D-262-Q8)", async () => {
    const { site } = await seedSite();
    const { plaintext, record } = await svc.mintSiteKey(site.id);
    await svc.revokeSiteKey(record.id, "suspected_compromise");
    expect(await svc.authenticateSiteKey(plaintext)).toBeNull();
    const reloaded = await stores.siteKeys.byId(record.id);
    expect(reloaded!.status).toBe("revoked");
    expect(reloaded!.revokedAt).not.toBeNull();
  });
});

describe("ownership_status — two independent scopes (D-262-Q9)", () => {
  it("records installation_control and domain_control independently", async () => {
    const { site } = await seedSite();
    await svc.recordOwnershipProof(site.id, "installation_control", {
      method: "plugin_handshake",
      verifiedAt: new Date("2026-11-01T00:00:00Z"),
    });
    const domains = await stores.domains.forSite(site.id);
    await svc.recordOwnershipProof(site.id, "domain_control", {
      method: "dns_txt",
      verifiedAt: new Date("2026-11-02T00:00:00Z"),
      reverifyAfter: new Date("2027-01-31T00:00:00Z"), // ~90d DNS orientir
      domainId: domains[0].id,
    });
    const status = await svc.ownershipStatus(site.id);
    expect(status.installation_control!.status).toBe("verified");
    expect(status.installation_control!.method).toBe("plugin_handshake");
    expect(status.domain_control!.status).toBe("verified");
    expect(status.domain_control!.method).toBe("dns_txt");
  });

  it("upserts per (site, kind) — re-proof replaces, scopes stay 2", async () => {
    const { site } = await seedSite();
    await svc.recordOwnershipProof(site.id, "domain_control", {
      method: "dns_txt",
      verifiedAt: new Date("2026-11-01T00:00:00Z"),
    });
    await svc.recordOwnershipProof(site.id, "domain_control", {
      method: "dns_txt",
      verifiedAt: new Date("2026-11-20T00:00:00Z"),
    });
    const status = await svc.ownershipStatus(site.id);
    expect(status.domain_control!.verifiedAt).toBe(
      "2026-11-20T00:00:00.000Z",
    );
    expect(Object.values(status).filter(Boolean)).toHaveLength(1);
  });

  it("pending without verifiedAt; verified requires verifiedAt", async () => {
    const { site } = await seedSite();
    const p = await svc.recordOwnershipProof(site.id, "domain_control", {
      method: "dns_txt",
    });
    expect(p.status).toBe("pending");
    await expect(
      svc.recordOwnershipProof(site.id, "domain_control", {
        method: "dns_txt",
        verifiedAt: new Date(),
      }),
    ).resolves.toMatchObject({ status: "verified" });
  });

  it("meta-tag/file methods rejected (outside v1)", async () => {
    const { site } = await seedSite();
    await expect(
      svc.recordOwnershipProof(site.id, "domain_control", {
        method: "meta_tag" as never,
      }),
    ).rejects.toThrow(/method/i);
    await expect(
      svc.recordOwnershipProof(site.id, "domain_control", {
        method: "file_upload" as never,
      }),
    ).rejects.toThrow(/method/i);
  });

  it("needsReverification: verified && reverifyAfter <= now", async () => {
    const { site } = await seedSite();
    const domains = await stores.domains.forSite(site.id);
    const past = new Date("2026-08-01T00:00:00Z");
    await svc.recordOwnershipProof(site.id, "domain_control", {
      method: "dns_txt",
      verifiedAt: past,
      reverifyAfter: new Date("2026-11-01T00:00:00Z"), // already due
      domainId: domains[0].id,
    });
    const due = await svc.needsReverification(new Date("2026-11-23T00:00:00Z"));
    expect(due).toHaveLength(1);
    expect(due[0].siteId).toBe(site.id);
    // far-future reverifyAfter → not due
    const none = await svc.needsReverification(new Date("2026-09-01T00:00:00Z"));
    expect(none).toHaveLength(0);
    // pending proofs are never "due" — they were never verified
    const { site: s2 } = await seedSite("production", ["cafe.com"]);
    await svc.recordOwnershipProof(s2.id, "domain_control", { method: "dns_txt" });
    expect(
      (await svc.needsReverification(new Date("2026-11-23T00:00:00Z"))).filter(
        (p) => p.siteId === s2.id,
      ),
    ).toHaveLength(0);
  });
});

describe("pickIntelRegistryStores — db-first, memory fallback", () => {
  it("memory when intelRegistry group absent (pre-publish package)", () => {
    const picked = pickIntelRegistryStores({});
    expect(picked.backend).toBe("memory");
  });

  it("postgres when db.intelRegistry present", () => {
    const fake = {} as never;
    const picked = pickIntelRegistryStores({ intelRegistry: fake });
    expect(picked.backend).toBe("postgres");
  });
});
