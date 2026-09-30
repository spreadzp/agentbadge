/**
 * SLICE-151-12: Venue events service (D-F10).
 *
 * Write-behind persistence of venue activity into the EPIC-143 `Event`
 * model (`packages/database`). `recordVenueEvent()` is fire-and-forget —
 * a DB failure never breaks the venue response. Reads go through
 * `getDatabase().events`, which transparently falls back to `InMemoryStore`
 * when `DATABASE_ENABLED` is unset (EPIC-143 contract: zero behavior change).
 *
 * Events carry `type: "venue"` and a display-ready payload; the activity
 * feed merges them with attestation-store entries at read time.
 */

import { InMemoryStore, type Store } from "@agentbadge/database";

import { getDatabase } from "../lib/database";

/** Payload stored in `Event.payload` — enough to render the feed. */
export interface VenueEventPayload {
  /** job.created | job.tx | job.status | offer.registered */
  action: string;
  /** Display-ready one-liner for the activity feed. */
  text: string;
  jobId?: string;
  tx?: string;
  /** Optional dedupe key — same key never writes twice. */
  dedupeKey?: string;
  [k: string]: unknown;
}

export interface VenueActivityItem {
  action: string;
  text: string;
  at: string;
  tx?: string;
  jobId?: string;
}

let fallbackStore: Store | null = null;

function store(): Store {
  try {
    return getDatabase().events;
  } catch {
    return (fallbackStore ??= new InMemoryStore());
  }
}

/** Test hook — drop the fallback store (pair with `resetDatabaseForTests`). */
export function resetVenueEventsForTests(): void {
  fallbackStore = null;
}

function toItem(row: {
  payload: unknown;
  createdAt: string;
}): VenueActivityItem {
  const p = (row.payload ?? {}) as VenueEventPayload;
  return {
    action: p.action ?? "venue.event",
    text: p.text ?? "",
    at: row.createdAt,
    tx: p.tx,
    jobId: p.jobId,
  };
}

/**
 * Append a venue event row. Fire-and-forget: returns void, swallows errors.
 * When `payload.dedupeKey` is set, a matching recent event skips the write —
 * covers htmx-poll status sync running the same transition twice.
 */
export function recordVenueEvent(payload: VenueEventPayload): Promise<void> {
  const { dedupeKey, ...rest } = payload;
  const row = {
    type: "venue",
    source: "venue",
    payload: rest as never,
  };
  return (async () => {
    if (dedupeKey) {
      const recent = await store()
        .list({ type: "venue", limit: 200 })
        .catch(() => null);
      if (
        recent?.some(
          (r) =>
            (r.payload as VenueEventPayload | undefined)?.dedupeKey ===
            dedupeKey,
        )
      ) {
        return;
      }
      rest.dedupeKey = dedupeKey;
      row.payload = rest as never;
    }
    await store()
      .create(row)
      .catch(() =>
        (fallbackStore ??= new InMemoryStore())
          .create(row)
          .catch(() => { }),
      );
  })();
}

/**
 * Latest venue events, newest first. Reads PG when enabled, the in-memory
 * store otherwise; DB failures degrade to the fallback (never throw).
 */
export async function listVenueActivity(
  limit = 20,
): Promise<VenueActivityItem[]> {
  try {
    const rows = await store().list({ type: "venue", limit });
    return rows.map(toItem);
  } catch {
    const rows = await (fallbackStore ??= new InMemoryStore()).list({
      type: "venue",
      limit,
    });
    return rows.map(toItem);
  }
}
