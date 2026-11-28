/**
 * SLICE-236-6: lazy materialization — a projection is computed on
 * request and cached in the rebuildable store. NO background
 * processing, NO writes in the event-append transaction (R3-2:
 * adapter failure never blocks the ledger).
 *
 * Idempotent by construction: the same event re-materialized at the
 * same adapter version hits the same store key — never a duplicate
 * row. An adapter version bump yields new rows alongside the old
 * (D-236-Q3); an explicit `materializeStream` pass is the backfill
 * operation — never automatic.
 */
import type { EconEventStored } from "@agentbadge/database";
import type { AdapterRegistry } from "../adapters";
import type { EconomicEventLike } from "../adapters/types";
import type {
  ProcessProjectionStore,
  StoredProjection,
} from "./store";

/** Stored ledger event → the adapter's EconomicEventLike view. */
export const toEventLike = (s: EconEventStored): EconomicEventLike => ({
  source: s.event.source,
  sourceId: s.event.sourceId,
  seq: s.event.seq,
  kind: s.event.kind,
  actor: s.event.actor,
  counterparty: s.event.counterparty,
  amountUsdc: s.event.amountUsdc,
  at: s.event.at,
  idempotencyKey: s.event.idempotencyKey,
  payload: s.event.payload as Record<string, unknown> | undefined,
});

/** Project one stored event + cache. Cache lookup keys on the
 *  CURRENT adapter version — after an adapter bump the next request
 *  materializes a new-version row (old rows stay readable via
 *  ?version=). Adapter errors surface as UNSUPPORTED projections
 *  (D-236-Q4) — never thrown at the caller. */
export async function materializeEvent(
  stored: EconEventStored,
  registry: AdapterRegistry,
  store: ProcessProjectionStore,
): Promise<StoredProjection> {
  const like = toEventLike(stored);
  const adapter = registry.adapterFor(like);
  const version = adapter?.version ?? "0.0.0";
  const cached = await store.get(stored.event.idempotencyKey, version);
  if (cached) return cached;
  const projection = await registry.project(like);
  return store.put(projection);
}

/** Materialize a whole event stream (oldest-first order kept) —
 *  the history endpoint's lazy backfill. */
export async function materializeStream(
  stored: EconEventStored[],
  registry: AdapterRegistry,
  store: ProcessProjectionStore,
): Promise<StoredProjection[]> {
  const out: StoredProjection[] = [];
  for (const s of stored) out.push(await materializeEvent(s, registry, store));
  return out;
}
