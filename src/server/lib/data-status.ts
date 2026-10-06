/**
 * SLICE-181-3 (MYPROJ-2526): DEGRADED data markers — D-181-4.
 *
 * Served data is never silently stale. Any response that carries data
 * which is not fresh MUST mark it: top-level `degraded: true`,
 * `data_status: "stale"|"unavailable"`, and `stale_since` (ISO-8601).
 * Responses whose data is unusable are refused instead
 * (data_unavailable, 503, charge:never — see lib/refusal-contract.ts).
 *
 * For the bstock feed surface the marking happens in `wrapBstockEngine`
 * — a structural proxy over the DeltaEngine view so every MCP tool
 * (get_delta, list_deltas, get_quote, get_digest) inherits the markers.
 */

export type DataStatus = "fresh" | "stale" | "unavailable";

export interface DataStatusOpts {
  status: DataStatus;
  /** ISO-8601 timestamp of the last fresh update (stale/unavailable). */
  staleSince?: string;
}

export interface DataStatusFields {
  degraded: boolean;
  data_status: DataStatus;
  stale_since?: string;
}

/** Add top-level degraded markers to a response body (non-destructive). */
export function withDataStatus<T extends Record<string, unknown>>(
  body: T,
  opts: DataStatusOpts,
): T & DataStatusFields {
  const degraded = opts.status !== "fresh";
  return {
    ...body,
    degraded,
    data_status: opts.status,
    ...(degraded && opts.staleSince ? { stale_since: opts.staleSince } : {}),
  };
}

// ─── bstock feed marking ────────────────────────────────────────────────

/** Minimal DeltaView contract — matches @agentbadge/bstock-tracker output. */
export interface BstockDeltaLike {
  stale: boolean;
  lastUpdateMs: number;
}

/** Structural engine shape — satisfied by DeltaEngine and by test fakes. */
export interface BstockFeedEngine<
  V extends BstockDeltaLike = BstockDeltaLike,
  E = unknown,
  H = unknown,
> {
  getDelta(symbol: string): V | null;
  listDeltas(): V[];
  getEvents(): E[];
  getHistory(symbol: string): H[];
}

/**
 * A symbol that never received an update (lastUpdateMs === 0) is
 * "unavailable", not "stale" — epoch 1970 would be a dishonest timestamp.
 */
export function dataStatusOf(view: BstockDeltaLike): DataStatus {
  if (!view.stale) return "fresh";
  return view.lastUpdateMs > 0 ? "stale" : "unavailable";
}

/** Stamp a single delta view with the degraded markers. */
export function stampDeltaView<V extends BstockDeltaLike>(
  view: V,
): V & DataStatusFields {
  const status = dataStatusOf(view);
  return {
    ...view,
    degraded: status !== "fresh",
    data_status: status,
    ...(status !== "fresh" && view.lastUpdateMs > 0
      ? { stale_since: new Date(view.lastUpdateMs).toISOString() }
      : {}),
  } as V & DataStatusFields;
}

/**
 * Engine proxy — marks every served view. Tools downstream
 * (get_digest) compose over listDeltas and inherit the fields.
 */
export function wrapBstockEngine<
  V extends BstockDeltaLike,
  E = unknown,
  H = unknown,
>(
  engine: BstockFeedEngine<V, E, H>,
): BstockFeedEngine<V & DataStatusFields, E, H> {
  return {
    getDelta: (symbol) => {
      const v = engine.getDelta(symbol);
      return v ? stampDeltaView(v) : null;
    },
    listDeltas: () => engine.listDeltas().map(stampDeltaView),
    getEvents: () => engine.getEvents(),
    getHistory: (symbol) => engine.getHistory(symbol),
  };
}

/**
 * Feed-down test for the gate: the engine is DOWN when it tracks
 * symbols but every single one is stale — serving them would be a
 * "fresh" answer built on dead data. An empty engine (nothing tracked
 * yet) is honest-empty, not down.
 */
export function bstockFeedDown(views: readonly BstockDeltaLike[]): boolean {
  return views.length > 0 && views.every((v) => v.stale);
}
