/**
 * EPIC-232 (SLICE-232-1, D-143/D-229-1): db-first store selection for
 * the AI foundation — Postgres adapter when the `ai` repo is present,
 * shared in-memory fallback otherwise (knowledge/db-stores.ts
 * precedent: the memory store MUST be a process-wide singleton or
 * writers and readers split across isolated maps).
 */

import type { getDatabase } from "../database";

import { InMemoryAiStore } from "./store-memory";
import { DbAiStore } from "./store-db";
import type { AiStore } from "./types";

type Db = Pick<ReturnType<typeof getDatabase>, "ai">;

let sharedMemoryStore: AiStore | undefined;

export function createMemoryAiStore(): AiStore {
  return new InMemoryAiStore();
}

export function pickAiStores(db: Db): AiStore {
  if (db.ai) return new DbAiStore(db.ai);
  return (sharedMemoryStore ??= createMemoryAiStore());
}
