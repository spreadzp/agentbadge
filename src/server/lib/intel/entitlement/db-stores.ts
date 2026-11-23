// EPIC-262 (SLICE-262-19a): db-first store selection (same convention
// as registry/evidence picks). `intelEntitlement` group ships with the
// next published @agentbadge/database; until then → shared memory.

import type { Database } from "@agentbadge/database";
import { createMemoryEntitlementStore } from "./memory";
import type { IntelEntitlementStore } from "./store";

let shared: IntelEntitlementStore | undefined;

export function pickIntelEntitlementStore(
  db: Database | { intelEntitlement?: IntelEntitlementStore | null },
): IntelEntitlementStore {
  const repo =
    "intelEntitlement" in db ? db.intelEntitlement : undefined;
  if (repo) return repo;
  return (shared ??= createMemoryEntitlementStore());
}
