// EPIC-262 (SLICE-262-19b): entitlement events — append-only history
// of every plan/lifecycle transition (same pattern as consent events,
// 262-23): billing state changes must be auditable, never edits.
import { generateReportId } from "../../../../agent-readiness/integrity/ulid";

export interface IntelEntitlementEvent {
  id: string; // eev_<ulid>
  tenantId: string;
  /** operator | system — sweeps are system actors */
  actor: string;
  action: string; // assign_plan | activate | renew | payment_failed | …
  fromStatus: string | null; // null on the first assign
  toStatus: string;
  plan: string;
  reason: string | null;
  at: string; // ISO
}

export interface IntelEntitlementEventStore {
  backend: string;
  insert(e: IntelEntitlementEvent): Promise<IntelEntitlementEvent>;
  forTenant(tenantId: string): Promise<IntelEntitlementEvent[]>;
}

export const newEntitlementEvent = (
  e: Omit<IntelEntitlementEvent, "id">,
): IntelEntitlementEvent => ({ ...e, id: `eev_${generateReportId()}` });

export function createMemoryEntitlementEventStore(): IntelEntitlementEventStore {
  const events: IntelEntitlementEvent[] = [];
  return {
    backend: "memory",
    async insert(e) {
      events.push(e);
      return e;
    },
    async forTenant(tenantId) {
      return events.filter((e) => e.tenantId === tenantId);
    },
  };
}
