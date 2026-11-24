// EPIC-264 (SLICE-264-1): db-first store selection (intel
// db-stores / knowledge pickKnowledgeStores precedent). The
// `adminOperators` group arrives with the next published
// @agentbadge/database — until then the field is absent and we
// fall back to the shared memory impl. DATABASE_ENABLED=off keeps
// the same memory path (D-229-1: zero behavior change).

import type { Database } from "@agentbadge/database";

import { createMemoryOperatorRepos } from "./memory";
import { createOperatorStore } from "./ops";
import type { AdminOperatorRepos, OperatorStore } from "./store";

// Memory fallback MUST be a process-wide singleton (db-stores.ts
// precedent): a fresh store per call splits writers and readers
// across isolated maps.
let sharedMemoryStore: OperatorStore | undefined;

export function createMemoryOperatorStore(fixture?: Parameters<
  typeof createMemoryOperatorRepos
>[0]): OperatorStore {
  return createOperatorStore(createMemoryOperatorRepos(fixture), "memory");
}

export function pickOperatorStores(
  db: Database | { adminOperators?: AdminOperatorRepos | null },
): OperatorStore {
  const repos = "adminOperators" in db ? db.adminOperators : undefined;
  if (repos) {
    return createOperatorStore(repos, "postgres");
  }
  return (sharedMemoryStore ??= createMemoryOperatorStore());
}
