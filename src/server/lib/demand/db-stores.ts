import type { getDatabase } from "../database";

import {
  createMemoryDemandData,
  createMemoryDemandStore,
} from "./store-memory";
import { createDbDemandStore } from "./store-db";
import type { DemandStore } from "./store";

/**
 * EPIC-231 (SLICE-231-1, D-229-1/D-143): db-first store selection —
 * Postgres adapter when the `demand` repo is present, shared
 * in-memory fallback otherwise (feedback/db-stores.ts precedent).
 */
type Db = Partial<Pick<ReturnType<typeof getDatabase>, "demand">>;

export function createMemoryDemandStores(): DemandStore {
  return createMemoryDemandStore(createMemoryDemandData());
}

// Memory fallback MUST be a process-wide singleton (db-stores.ts
// precedent): a fresh store per call splits writers and readers
// across isolated maps. DB-backed stores are thin wrappers over
// shared tables, so per-call construction is safe there.
let sharedMemoryStore: DemandStore | undefined;

export function pickDemandStore(db: Db): DemandStore {
  if (db.demand) {
    return createDbDemandStore(db.demand);
  }
  return (sharedMemoryStore ??= createMemoryDemandStores());
}
