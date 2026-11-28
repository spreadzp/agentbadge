/**
 * SLICE-236-6 (D-235-26): materialized projection store —
 * rebuildable cache of ProcessEventProjection rows (AgentTrustEdge
 * pattern: the event log is SoT; a row is derived state — loss =
 * recompute, never data loss).
 *
 * Versioning rule (slice AC + D-236-Q3): rows key on
 * (eventId, adapter, adapterVersion) — a new adapter version produces
 * NEW rows; existing rows are never overwritten. `get(eventId)` without
 * a version returns the newest adapterVersion row (semver order);
 * `?version=` reads pin older rows. Repeat materialization of the same
 * event at the same version is idempotent — same key, same bytes.
 *
 * In-memory for v1 (map-backed, like InMemoryTrustEdgeStore); a
 * Postgres-backed variant slots behind the same interface — the DB
 * surface is intentionally untouched here (EPIC-260 owns it in
 * flight).
 */
import type { ProcessEventProjection } from "./types";

export interface StoredProjection {
  /** sourceEvent.id — `ev:{source}:{sourceId}:{seq}`. */
  eventId: string;
  adapter: string;
  adapterVersion: string;
  projection: ProcessEventProjection;
  /** Write clock — audit only, never a cursor. */
  materializedAt: string;
}

export interface ProcessProjectionStore {
  /** Idempotent upsert keyed (eventId, adapter, adapterVersion). */
  put(projection: ProcessEventProjection): Promise<StoredProjection>;
  /** `version` omitted → newest adapterVersion row. */
  get(
    eventId: string,
    version?: string,
  ): Promise<StoredProjection | null>;
  /** Every stored adapter version of this event, newest first. */
  list(eventId: string): Promise<StoredProjection[]>;
}

/** "0.3.0" > "0.2.0" — numeric dot-compare; unknowns sort last. */
export const compareSemver = (a: string, b: string): number => {
  const pa = a.split(".").map((n) => parseInt(n, 10));
  const pb = b.split(".").map((n) => parseInt(n, 10));
  for (let i = 0; i < 3; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (Number.isNaN(x) || Number.isNaN(y)) return a.localeCompare(b);
    if (x !== y) return x - y;
  }
  return a.localeCompare(b);
};

export class InMemoryProjectionStore implements ProcessProjectionStore {
  private readonly rows = new Map<string, StoredProjection>();

  private static key(p: ProcessEventProjection): string {
    return `${p.sourceEvent.id}|${p.mapping.adapter}|${p.mapping.version}`;
  }

  async put(p: ProcessEventProjection): Promise<StoredProjection> {
    const k = InMemoryProjectionStore.key(p);
    const existing = this.rows.get(k);
    if (existing) return existing; // idempotent — never duplicate
    const row: StoredProjection = {
      eventId: p.sourceEvent.id,
      adapter: p.mapping.adapter,
      adapterVersion: p.mapping.version,
      projection: p,
      materializedAt: new Date().toISOString(),
    };
    this.rows.set(k, row);
    return row;
  }

  async get(
    eventId: string,
    version?: string,
  ): Promise<StoredProjection | null> {
    const all = await this.list(eventId);
    if (version !== undefined) {
      return all.find((r) => r.adapterVersion === version) ?? null;
    }
    return all[0] ?? null;
  }

  async list(eventId: string): Promise<StoredProjection[]> {
    return [...this.rows.values()]
      .filter((r) => r.eventId === eventId)
      .sort((a, b) => compareSemver(b.adapterVersion, a.adapterVersion));
  }
}
