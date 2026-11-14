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

export function pickRequestInboxStores(db: Db): RequestInboxStores {
  if (db.agentRequests && db.agentSurveys) {
    return createDbRequestInboxStores(db.agentRequests, db.agentSurveys);
  }
  return createMemoryRequestInboxStores();
}
