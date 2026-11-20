import type { KnowledgeStore } from "./store";
import type { KnowledgeSearchHit } from "./types";

/**
 * EPIC-229 (SLICE-229-5, D-229-4): the search seam.
 * One output shape over both backends — Postgres FTS
 * (plainto_tsquery, ts_rank, ts_headline) or the memory scorer
 * when DATABASE_ENABLED=off. `engine` reports which ran.
 */

export interface KnowledgeSearchResult {
  items: KnowledgeSearchHit[];
  query: string;
  engine: "FTS" | "MEMORY";
}

export interface KnowledgeSearchParams {
  /** Internal callers may pass another status; agent surfaces
   *  hard-force PUBLISHED at the route layer (never from params). */
  status?: string;
  kind?: string | null;
  capabilityRef?: string | null;
  limit?: number;
}

export async function searchKnowledgeItems(
  store: KnowledgeStore,
  query: string,
  opts: KnowledgeSearchParams = {},
): Promise<KnowledgeSearchResult> {
  const items = await store.searchItems({
    query,
    status: opts.status ?? "PUBLISHED",
    kind: opts.kind ?? null,
    capabilityRef: opts.capabilityRef ?? null,
    limit: opts.limit ?? 20,
  });
  return {
    items,
    query,
    engine: store.backend === "postgres" ? "FTS" : "MEMORY",
  };
}
