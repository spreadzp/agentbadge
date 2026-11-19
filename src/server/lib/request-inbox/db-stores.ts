import type { getDatabase } from "../database";

import { createDbRequestInboxStores } from "./store-db";
import {
  createMemoryRequestStore,
  type RequestInboxStores,
} from "./store";
import { createMemorySurveyStore } from "./survey-store";

/**
 * EPIC-252 (SLICE-252-1): db-first store selection for the request
 * inbox — Postgres adapter when DATABASE_ENABLED supplies the repos,
 * in-memory fallback otherwise (eaas/db-stores.ts precedent).
 */
type Db = Pick<
  ReturnType<typeof getDatabase>,
  "agentRequests" | "agentSurveys"
>;

export function createMemoryRequestInboxStores(): RequestInboxStores {
  return {
    requests: createMemoryRequestStore(),
    surveys: createMemorySurveyStore(),
    backend: "memory",
  };
}

// Memory fallback MUST be a process-wide singleton: a fresh store per
// call splits intake / ops / surveys / QA / notifier across isolated
// maps (submit writes to one instance, ops reads another → 404s and an
// always-empty ops digest). DB-backed stores are thin wrappers over
// shared tables, so per-call construction is safe there.
let sharedMemoryStores: RequestInboxStores | undefined;

export function pickRequestInboxStores(db: Db): RequestInboxStores {
  if (db.agentRequests && db.agentSurveys) {
    return createDbRequestInboxStores(db.agentRequests, db.agentSurveys);
  }
  return (sharedMemoryStores ??= createMemoryRequestInboxStores());
}
