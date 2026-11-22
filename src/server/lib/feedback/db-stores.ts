import type { getDatabase } from "../database";

import {
  createMemoryFeedbackData,
  createMemoryFeedbackStore,
} from "./store-memory";
import { createDbFeedbackStore } from "./store-db";
import type { FeedbackStore } from "./store";

/**
 * EPIC-230 (SLICE-230-1, D-229-1/D-143): db-first store selection —
 * Postgres adapter when the `feedbackReview` repo group is present,
 * shared in-memory fallback otherwise (knowledge/db-stores.ts
 * precedent).
 */
type Db = Partial<Pick<ReturnType<typeof getDatabase>, "feedbackReview">>;

export function createMemoryFeedbackStores(): FeedbackStore {
  return createMemoryFeedbackStore(createMemoryFeedbackData());
}

// Memory fallback MUST be a process-wide singleton (db-stores.ts
// precedent): a fresh store per call splits writers and readers
// across isolated maps. DB-backed stores are thin wrappers over
// shared tables, so per-call construction is safe there.
let sharedMemoryStore: FeedbackStore | undefined;

export function pickFeedbackStore(db: Db): FeedbackStore {
  if (db.feedbackReview) {
    return createDbFeedbackStore(db.feedbackReview.feedback);
  }
  return (sharedMemoryStore ??= createMemoryFeedbackStores());
}
