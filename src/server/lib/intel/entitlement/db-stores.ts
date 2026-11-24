// EPIC-262 (SLICE-262-19a): db-first store selection — adapter
// narrows the package's loose record (status: string) back to the
// IntelEntitlementStatus union at the boundary.

import type { Database } from "@agentbadge/database";
import { createMemoryEntitlementStore } from "./memory";
import { createMemoryEntitlementEventStore } from "./events-store";
import type { IntelEntitlementStore } from "./store";
import type {
  IntelEntitlementEvent,
  IntelEntitlementEventStore,
} from "./events-store";
import type { IntelEntitlement, IntelEntitlementStatus } from "./types";

interface EntitlementRepoRecord {
  id: string;
  tenantId: string;
  plan: string;
  status: string;
  coveredSiteIds: string[];
  perSiteLimits: Record<string, number>;
  validFrom: string;
  validUntil: string;
  graceUntil: string;
  createdAt: string;
  updatedAt: string;
}

export interface IntelEntitlementRepository {
  getByTenant(tenantId: string): Promise<EntitlementRepoRecord | null>;
  upsert(e: EntitlementRepoRecord): Promise<EntitlementRepoRecord>;
}

const fromRecord = (r: EntitlementRepoRecord): IntelEntitlement => ({
  ...r,
  status: r.status as IntelEntitlementStatus,
});

const adapt = (repo: IntelEntitlementRepository): IntelEntitlementStore => ({
  getByTenant: async (tenantId) => {
    const r = await repo.getByTenant(tenantId);
    return r ? fromRecord(r) : null;
  },
  upsert: async (e) => fromRecord(await repo.upsert(e)),
});

let shared: IntelEntitlementStore | undefined;

export function pickIntelEntitlementStore(
  db: Database | { intelEntitlement?: IntelEntitlementRepository | null },
): IntelEntitlementStore {
  const repo =
    "intelEntitlement" in db ? db.intelEntitlement : undefined;
  if (repo) return adapt(repo);
  return (shared ??= createMemoryEntitlementStore());
}

// ---------- entitlement events (0.6.37 — intelEntitlementEvents table) ----------

interface EntitlementEventRepoRecord {
  id: string;
  tenantId: string;
  actor: string;
  action: string;
  fromStatus: string | null;
  toStatus: string;
  plan: string;
  reason: string | null;
  at: string;
}

export interface IntelEntitlementEventRepository {
  insert(e: EntitlementEventRepoRecord): Promise<EntitlementEventRepoRecord>;
  forTenant(tenantId: string): Promise<EntitlementEventRepoRecord[]>;
}

const adaptEvents = (
  repo: IntelEntitlementEventRepository,
): IntelEntitlementEventStore => ({
  backend: "postgres",
  insert: async (e) => (await repo.insert(e)) as IntelEntitlementEvent,
  forTenant: async (tenantId) =>
    ((await repo.forTenant(tenantId)) as IntelEntitlementEvent[]),
});

let sharedEvents: IntelEntitlementEventStore | undefined;

export function pickIntelEntitlementEventStore(
  db: Database | {
    intelEntitlementEvents?: IntelEntitlementEventRepository | null;
  },
): IntelEntitlementEventStore {
  const repo =
    "intelEntitlementEvents" in db ? db.intelEntitlementEvents : undefined;
  if (repo) return adaptEvents(repo);
  return (sharedEvents ??= createMemoryEntitlementEventStore());
}
