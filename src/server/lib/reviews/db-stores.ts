import type { getDatabase } from "../database";

import {
  createMemoryReviewData,
  createMemoryReviewStore,
} from "./store-memory";
import { createDbReviewStore } from "./store-db";
import type { ReviewStore } from "./store";

/**
 * EPIC-230 (SLICE-230-1, D-229-1/D-143): db-first store selection —
 * Postgres adapter when the `feedbackReview` repo group is present,
 * shared in-memory fallback otherwise (knowledge/db-stores.ts
 * precedent).
 */
type Db = Partial<Pick<ReturnType<typeof getDatabase>, "feedbackReview">>;

export function createMemoryReviewStores(): ReviewStore {
  return createMemoryReviewStore(createMemoryReviewData());
}

// Memory fallback MUST be a process-wide singleton (db-stores.ts
// precedent): a fresh store per call splits writers and readers
// across isolated maps. DB-backed stores are thin wrappers over
// shared tables, so per-call construction is safe there.
let sharedMemoryStore: ReviewStore | undefined;

export function pickReviewStore(db: Db): ReviewStore {
  if (db.feedbackReview) {
    return createDbReviewStore(db.feedbackReview.reviews);
  }
  return (sharedMemoryStore ??= createMemoryReviewStores());
}
