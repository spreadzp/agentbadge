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
import { createMemoryWebhookOutboxStore } from "../webhooks/outbox-memory";
import type { WebhookOutboxRepoLike } from "../webhooks/types";

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

/** EPIC-233 (D-233-5): the WebhookOutbox repo arrives with the next
 *  @agentbadge/database republish — structural pick, not a typed field
 *  yet. Until then the outbox is the shared memory facet (functional,
 *  not durable — durable enqueue = republish follow-up). */
type DbWithWebhooks = Db & { webhookOutbox?: WebhookOutboxRepoLike | null };

/** Shared memory outbox for postgres mode — the enqueue sink and the
 *  worker's read side MUST be the same instance even before the repo
 *  lands (a fresh map per call would swallow deliveries). */
const sharedDbModeOutbox = createMemoryWebhookOutboxStore(new Map());

export function createDbRequestInboxStores(
  requests: AgentRequestRepository,
  surveys: AgentSurveyRepository,
  interactions: InteractionRepository,
  webhookOutbox?: WebhookOutboxRepoLike | null,
): RequestInboxStores {
  const webhooks = webhookOutbox ?? sharedDbModeOutbox;
  return {
    requests: createDbRequestStore(requests, webhooks),
    surveys: createDbSurveyStore(surveys),
    interactions: createDbInteractionStore(interactions),
    webhooks,
    backend: "postgres",
  };
}

export function createMemoryRequestInboxStores(): RequestInboxStores {
  // D-228-10: ONE data object for both facets — the interaction store
  // reads/writes the same `rows` map as the request store, exactly
  // like the shared Postgres table in Postgres mode. D-233-5 extends
  // the same rule to the webhook outbox map.
  const data = createMemoryRequestInboxData();
  const webhooks = createMemoryWebhookOutboxStore(data.webhookOutbox);
  return {
    requests: createMemoryRequestStore(data, webhooks),
    surveys: createMemorySurveyStore(),
    interactions: createMemoryInteractionStore(data),
    webhooks,
    backend: "memory",
  };
}

// Memory fallback MUST be a process-wide singleton: a fresh store per
// call splits intake / ops / surveys / QA / notifier across isolated
// maps (submit writes to one instance, ops reads another → 404s and an
// always-empty ops digest). DB-backed stores are thin wrappers over
// shared tables, so per-call construction is safe there.
let sharedMemoryStores: RequestInboxStores | undefined;

export function pickRequestInboxStores(db: DbWithWebhooks): RequestInboxStores {
  if (db.agentRequests && db.agentSurveys && db.agentInteractions) {
    return createDbRequestInboxStores(
      db.agentRequests,
      db.agentSurveys,
      db.agentInteractions,
      db.webhookOutbox,
    );
  }
  return (sharedMemoryStores ??= createMemoryRequestInboxStores());
}
