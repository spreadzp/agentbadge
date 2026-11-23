// EPIC-262 (SLICE-262-19a): in-memory entitlement store.
import type { IntelEntitlement } from "./types";
import type { IntelEntitlementStore } from "./store";

export function createMemoryEntitlementStore(): IntelEntitlementStore {
  const byTenant = new Map<string, IntelEntitlement>();
  return {
    async getByTenant(tenantId) {
      return byTenant.get(tenantId) ?? null;
    },
    async upsert(e) {
      byTenant.set(e.tenantId, e);
      return e;
    },
  };
}
