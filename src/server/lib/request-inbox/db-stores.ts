import type { getDatabase } from "../database";
import type {
  AgentRequestRepository,
  AgentSurveyRepository,
  InteractionRepository,
} from "@agentbadge/database";

import { createDbRequestStore } from "./store-db";
import { createDbSurveyStore } from "./survey-store-db";
import { createDbInteractionStore } from "./interaction-store-db";
import {
  createMemoryRequestInboxData,
  type RequestInboxStores,
} from "./store";
import { createMemoryRequestStore } from "./store-memory";
import { createMemoryInteractionStore } from "./interaction-store-memory";
import { createMemorySurveyStore } from "./survey-store";

/**
 * EPIC-252 (SLICE-252-1) + EPIC-228 (SLICE-228-1): db-first store
 * selection for the request inbox — Postgres adapters when
 * DATABASE_ENABLED supplies the repos, in-memory fallback otherwise
 * (eaas/db-stores.ts precedent).
 */
type Db = Pick<
  ReturnType<typeof getDatabase>,
  "agentRequests" | "agentSurveys"
> &
  /** EPIC-228 — optional so pre-228 test mocks still satisfy the pick;
   *  a missing repo alongside missing requests → memory fallback. */
  Partial<Pick<ReturnType<typeof getDatabase>, "agentInteractions">>;

export function createDbRequestInboxStores(
  requests: AgentRequestRepository,
  surveys: AgentSurveyRepository,
  interactions: InteractionRepository,
): RequestInboxStores {
  return {
    requests: createDbRequestStore(requests),
    surveys: createDbSurveyStore(surveys),
    interactions: createDbInteractionStore(interactions),
    backend: "postgres",
  };
}

export function createMemoryRequestInboxStores(): RequestInboxStores {
  // D-228-10: ONE data object for both facets — the interaction store
  // reads/writes the same `rows` map as the request store, exactly
  // like the shared agentRequest table in Postgres mode.
  const data = createMemoryRequestInboxData();
  return {
    requests: createMemoryRequestStore(data),
    surveys: createMemorySurveyStore(),
    interactions: createMemoryInteractionStore(data),
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
  if (db.agentRequests && db.agentSurveys && db.agentInteractions) {
    return createDbRequestInboxStores(
      db.agentRequests,
      db.agentSurveys,
      db.agentInteractions,
    );
  }
  return (sharedMemoryStores ??= createMemoryRequestInboxStores());
}
