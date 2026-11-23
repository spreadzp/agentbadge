// EPIC-262 (SLICE-262-2): registry persistence interfaces.
// Mirrors the codebase convention (request-inbox/db-stores): repos are
// narrow per-aggregate CRUD; domain ops live in the service layer so
// memory and Postgres adapters share identical behavior.

import type {
  IntelCustomer,
  IntelDomain,
  IntelOwnershipProof,
  IntelSite,
  IntelSiteKey,
  IntelTenant,
} from "./types";

export interface IntelTenantsRepo {
  insert(t: IntelTenant): Promise<IntelTenant>;
  byId(id: string): Promise<IntelTenant | null>;
  bySlug(slug: string): Promise<IntelTenant | null>;
}

export interface IntelCustomersRepo {
  insert(c: IntelCustomer): Promise<IntelCustomer>;
  byId(id: string): Promise<IntelCustomer | null>;
  forTenant(tenantId: string): Promise<IntelCustomer[]>;
}

export interface IntelSitesRepo {
  insert(s: IntelSite): Promise<IntelSite>;
  byId(id: string): Promise<IntelSite | null>;
  forCustomer(customerId: string): Promise<IntelSite[]>;
  update(s: IntelSite): Promise<IntelSite>;
}

export interface IntelDomainsRepo {
  insert(d: IntelDomain): Promise<IntelDomain>;
  byHostname(hostname: string): Promise<IntelDomain | null>;
  forSite(siteId: string): Promise<IntelDomain[]>;
}

export interface IntelSiteKeysRepo {
  insert(k: IntelSiteKey): Promise<IntelSiteKey>;
  byId(id: string): Promise<IntelSiteKey | null>;
  byKeyHash(hash: string): Promise<IntelSiteKey | null>;
  forSite(siteId: string): Promise<IntelSiteKey[]>;
  update(k: IntelSiteKey): Promise<IntelSiteKey>;
}

export interface IntelOwnershipRepo {
  // upsert keyed by (siteId, kind) — one proof per scope per site
  upsert(p: IntelOwnershipProof): Promise<IntelOwnershipProof>;
  byScope(siteId: string, kind: IntelOwnershipProof["kind"]): Promise<IntelOwnershipProof | null>;
  forSite(siteId: string): Promise<IntelOwnershipProof[]>;
  // verified proofs whose reverifyAfter <= nowIso (D-262-Q9 re-verify
  // scan); ISO lexicographic compare
  due(nowIso: string): Promise<IntelOwnershipProof[]>;
}

export interface IntelRegistryStores {
  backend: "memory" | "postgres";
  tenants: IntelTenantsRepo;
  customers: IntelCustomersRepo;
  sites: IntelSitesRepo;
  domains: IntelDomainsRepo;
  siteKeys: IntelSiteKeysRepo;
  ownership: IntelOwnershipRepo;
}
