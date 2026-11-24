// EPIC-262 (SLICE-262-16): db-first pull-job + security-event store
// selection (same pick convention). `intelPullJobs` /
// `intelSecurityEvents` ship with the next @agentbadge/database;
// until then → shared memory.
import type { Database } from "@agentbadge/database";
import {
  createMemoryPullJobStore,
  createMemorySecurityEventStore,
} from "./memory";
import type { IntelPullJobStore, IntelSecurityEventStore } from "./store";

let sharedJobs: IntelPullJobStore | undefined;
let sharedEvents: IntelSecurityEventStore | undefined;

export function pickIntelPullJobStore(
  db: Database | { intelPullJobs?: IntelPullJobStore | null },
): IntelPullJobStore {
  const repo = "intelPullJobs" in db ? db.intelPullJobs : undefined;
  if (repo) return repo;
  return (sharedJobs ??= createMemoryPullJobStore());
}

export function pickIntelSecurityEventStore(
  db: Database | { intelSecurityEvents?: IntelSecurityEventStore | null },
): IntelSecurityEventStore {
  const repo = "intelSecurityEvents" in db ? db.intelSecurityEvents : undefined;
  if (repo) return repo;
  return (sharedEvents ??= createMemorySecurityEventStore());
}
