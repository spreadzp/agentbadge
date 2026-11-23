// EPIC-262 (SLICE-262-19a): entitlement store contract — one
// entitlement per tenant in v1 (19b may add plan history).
import type { IntelEntitlement } from "./types";

export interface IntelEntitlementStore {
  getByTenant(tenantId: string): Promise<IntelEntitlement | null>;
  /** create-or-replace keyed by tenant_id — idempotent */
  upsert(e: IntelEntitlement): Promise<IntelEntitlement>;
}
