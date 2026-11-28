/**
 * SLICE-236-3: adapter helpers — sourceEvent builder + the generic
 * UNSUPPORTED projection (D-236-Q4: no adapter → valid 200-level
 * projection with status UNSUPPORTED + TYPE_UNKNOWN issue).
 */
import type {
  ProcessEventProjection,
  ProjectionSourceEvent,
} from "../projections/types";
import type { EconomicEventLike } from "./types";

/** `ev:{source}:{sourceId}:{seq}` (D-235-4) — the ledger's own
 *  idempotencyKey is canonical when present. */
export const buildSourceEvent = (
  event: EconomicEventLike,
): ProjectionSourceEvent => ({
  spec: "econ-events/1",
  id:
    event.idempotencyKey ??
    `ev:${event.source}:${event.sourceId}:${event.seq}`,
  source: event.source,
  sourceId: event.sourceId,
  seq: event.seq,
});

/** No mapping for this event → UNSUPPORTED, never a fabricated one.
 *  `adapter`/`version` identify WHO rejected it: a real adapter for a
 *  kind it doesn't map yet, "unmapped"/"0.0.0" when the registry found
 *  no claimant at all. */
export const unsupportedProjection = (
  event: EconomicEventLike,
  adapter: string,
  version: string,
): ProcessEventProjection => ({
  projectionVersion: "process-event-projection/1",
  sourceEvent: buildSourceEvent(event),
  interpretation: { subjectRefs: [], actorRefs: [] },
  mapping: {
    adapter,
    version,
    status: "UNSUPPORTED",
    issues: [
      {
        code: "TYPE_UNKNOWN",
        field: "kind",
        message: `no mapping for ${event.source}/${event.kind}`,
      },
    ],
  },
});
