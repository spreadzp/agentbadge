import type { getDatabase } from "../database";

import { createMemoryKnowledgeData } from "./memory-data";
import { MemoryKnowledgeStore } from "./store-memory";
import { DbKnowledgeStore } from "./store-db";
import type { KnowledgeStore } from "./store";

/**
 * EPIC-229 (SLICE-229-1, D-143): db-first store selection for the
 * Knowledge Engine — Postgres adapter when `knowledge` repos are
 * present, shared in-memory fallback otherwise
 * (request-inbox/db-stores.ts precedent).
 */
type Db = Pick<ReturnType<typeof getDatabase>, "knowledge">;

export function createMemoryKnowledgeStores(): KnowledgeStore {
  return new MemoryKnowledgeStore(createMemoryKnowledgeData());
}

// Memory fallback MUST be a process-wide singleton (db-stores.ts
// precedent): a fresh store per call splits writers and readers
// across isolated maps — composer refusal writes a gap the ops
// screen then cannot see. DB-backed stores are thin wrappers over
// shared tables, so per-call construction is safe there.
let sharedMemoryStore: KnowledgeStore | undefined;

export function pickKnowledgeStores(db: Db): KnowledgeStore {
  if (db.knowledge) {
    return new DbKnowledgeStore(db.knowledge.core, db.knowledge.taxonomy);
  }
  return (sharedMemoryStore ??= createMemoryKnowledgeStores());
}
