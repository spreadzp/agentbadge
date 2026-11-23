// EPIC-262 (SLICE-262-6): db-first scan-job store selection (same
// pick convention as registry/evidence/entitlement). `intelScanJobs`
// ships with the next published @agentbadge/database; until then →
// shared memory.

import type { Database } from "@agentbadge/database";
import { createMemoryScanJobStore } from "./memory";
import type { IntelScanJobStore } from "./store";

let shared: IntelScanJobStore | undefined;

export function pickIntelScanJobStore(
  db: Database | { intelScanJobs?: IntelScanJobStore | null },
): IntelScanJobStore {
  const repo = "intelScanJobs" in db ? db.intelScanJobs : undefined;
  if (repo) return repo;
  return (shared ??= createMemoryScanJobStore());
}
