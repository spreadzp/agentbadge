// EPIC-262 (SLICE-262-2): in-memory registry — full behavioral parity
// with the Postgres adapter (tests + dev without DATABASE_ENABLED).

import type {
  IntelCustomersRepo,
  IntelDomainsRepo,
  IntelOwnershipRepo,
  IntelRegistryStores,
  IntelSiteKeysRepo,
  IntelSitesRepo,
  IntelTenantsRepo,
} from "./store";
import type {
  IntelCustomer,
  IntelDomain,
  IntelOwnershipProof,
  IntelSite,
  IntelSiteKey,
  IntelTenant,
} from "./types";

export function createMemoryIntelRegistry(): IntelRegistryStores {
  const tenants = new Map<string, IntelTenant>();
  const customers = new Map<string, IntelCustomer>();
  const sites = new Map<string, IntelSite>();
  const domains = new Map<string, IntelDomain>(); // keyed by id
  const hostnameIndex = new Map<string, string>(); // hostname → domain id
  const siteKeys = new Map<string, IntelSiteKey>();
  const ownership = new Map<string, IntelOwnershipProof>(); // `${siteId}:${kind}`

  const tenantsRepo: IntelTenantsRepo = {
    async insert(t) {
      tenants.set(t.id, t);
      return t;
    },
    async byId(id) {
      return tenants.get(id) ?? null;
    },
    async bySlug(slug) {
      for (const t of tenants.values()) if (t.slug === slug) return t;
      return null;
    },
  };

  const customersRepo: IntelCustomersRepo = {
    async insert(c) {
      customers.set(c.id, c);
      return c;
    },
    async byId(id) {
      return customers.get(id) ?? null;
    },
    async forTenant(tenantId) {
      return [...customers.values()].filter((c) => c.tenantId === tenantId);
    },
  };

  const sitesRepo: IntelSitesRepo = {
    async insert(s) {
      sites.set(s.id, s);
      return s;
    },
    async byId(id) {
      return sites.get(id) ?? null;
    },
    async forCustomer(customerId) {
      return [...sites.values()].filter((s) => s.customerId === customerId);
    },
    async update(s) {
      sites.set(s.id, s);
      return s;
    },
  };

  const domainsRepo: IntelDomainsRepo = {
    async insert(d) {
      domains.set(d.id, d);
      hostnameIndex.set(d.hostname, d.id);
      return d;
    },
    async byHostname(hostname) {
      const id = hostnameIndex.get(hostname);
      return id ? domains.get(id)! : null;
    },
    async forSite(siteId) {
      return [...domains.values()].filter((d) => d.siteId === siteId);
    },
  };

  const siteKeysRepo: IntelSiteKeysRepo = {
    async insert(k) {
      siteKeys.set(k.id, k);
      return k;
    },
    async byId(id) {
      return siteKeys.get(id) ?? null;
    },
    async byKeyHash(hash) {
      for (const k of siteKeys.values()) if (k.keyHash === hash) return k;
      return null;
    },
    async forSite(siteId) {
      return [...siteKeys.values()].filter((k) => k.siteId === siteId);
    },
    async update(k) {
      siteKeys.set(k.id, k);
      return k;
    },
  };

  const ownershipRepo: IntelOwnershipRepo = {
    async upsert(p) {
      ownership.set(`${p.siteId}:${p.kind}`, p);
      return p;
    },
    async byScope(siteId, kind) {
      return ownership.get(`${siteId}:${kind}`) ?? null;
    },
    async forSite(siteId) {
      return [...ownership.values()].filter((p) => p.siteId === siteId);
    },
    async due(nowIso) {
      return [...ownership.values()].filter(
        (p) =>
          p.status === "verified" &&
          p.reverifyAfter !== null &&
          p.reverifyAfter <= nowIso,
      );
    },
  };

  return {
    backend: "memory",
    tenants: tenantsRepo,
    customers: customersRepo,
    sites: sitesRepo,
    domains: domainsRepo,
    siteKeys: siteKeysRepo,
    ownership: ownershipRepo,
  };
}
