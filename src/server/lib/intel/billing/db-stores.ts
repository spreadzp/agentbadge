// EPIC-262 (SLICE-262-21): db-first billing-event store selection.
// The package's @@unique(provider, externalId) IS the dedupe
// mechanism — cross-instance safe, unlike a process-local Set.
// insertOnce is the exactly-once claim; markProcessed settles the
// row with the handler's verdict (a crash between the two leaves a
// claim row — retried deliveries still dedupe, honestly reported).

import type { Database } from "@agentbadge/database";

export interface BillingEventRecord {
  id: string; // bev_<ulid>
  provider: string;
  externalId: string;
  tenantId: string | null;
  effect: unknown;
  applied: boolean;
  reason: string | null;
  processedAt: string;
}

export interface IntelBillingEventStore {
  backend: string;
  insertOnce(
    e: BillingEventRecord,
  ): Promise<{ inserted: boolean; record: BillingEventRecord }>;
  markProcessed(
    id: string,
    applied: boolean,
    reason: string | null,
  ): Promise<BillingEventRecord>;
  forTenant(tenantId: string): Promise<BillingEventRecord[]>;
}

export function createMemoryBillingEventStore(): IntelBillingEventStore {
  const byKey = new Map<string, BillingEventRecord>();
  return {
    backend: "memory",
    async insertOnce(e) {
      const key = `${e.provider}:${e.externalId}`;
      const existing = byKey.get(key);
      if (existing) return { inserted: false, record: existing };
      byKey.set(key, e);
      return { inserted: true, record: e };
    },
    async markProcessed(id, applied, reason) {
      for (const [k, v] of byKey) {
        if (v.id === id) {
          const u = { ...v, applied, reason };
          byKey.set(k, u);
          return u;
        }
      }
      throw new Error(`billing event ${id} vanished`);
    },
    async forTenant(tenantId) {
      return [...byKey.values()].filter((e) => e.tenantId === tenantId);
    },
  };
}

let shared: IntelBillingEventStore | undefined;

export function pickIntelBillingEventStore(
  db: Database | { intelBillingEvents?: IntelBillingEventStore | null },
): IntelBillingEventStore {
  const repo =
    "intelBillingEvents" in db ? db.intelBillingEvents : undefined;
  if (repo) return { ...repo, backend: "postgres" };
  return (shared ??= createMemoryBillingEventStore());
}
