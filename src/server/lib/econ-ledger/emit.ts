/**
 * SLICE-207-3 (EPIC-207): emitter core.
 *
 * Existing sources of truth project into the economic ledger WITHOUT
 * changing their own contracts (projection, ADR-201). Emits are
 * fire-and-forget: a ledger write failure must never break a business
 * transition — the row can be rebuilt by the backfill job (backfill.ts)
 * because every event carries a deterministic idempotency key
 * `ev:{source}:{sourceId}:{seq}` (D-207-2).
 *
 * Gate: `DATABASE_ENABLED=false` → `getDatabase().db === null` → emitters
 * no-op (spec AC). The in-memory `econLedger` exists for reads/tests but
 * production emits only fire when Postgres is the backing store.
 */

import {
  buildEconomicEvent,
  type BuildEventInput,
  type EconomicEvent,
} from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import { logger } from "@agentbadge/passport/logger";
import { getDatabase } from "../database.js";

/**
 * Ledger store for emits, or null when the database is disabled.
 * Exported for tests/backfill — callers normally use the emit helpers.
 */
export function econLedgerOrNull(): EconLedgerStore | null {
  const db = getDatabase();
  return db.db ? db.econLedger : null;
}

/**
 * Build + append one event. Fire-and-forget — returns void, logs on
 * failure, never throws upstream.
 */
export function emitEconomicEvent(
  input: BuildEventInput,
  ledger?: EconLedgerStore | null,
): void {
  const store = ledger === undefined ? econLedgerOrNull() : ledger;
  if (!store) return;
  let event: EconomicEvent;
  try {
    event = buildEconomicEvent(input);
  } catch (err) {
    logger.warn("econ-ledger: emit dropped (build failed)", {
      source: input.source,
      sourceId: input.sourceId,
      kind: input.kind,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  void store
    .append([event])
    .catch((err: unknown) =>
      logger.warn("econ-ledger: append failed", {
        key: event.idempotencyKey,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
}

/**
 * Batch variant for backfill — validates + appends per item (skips
 * unmappable inputs instead of aborting the batch). Returns the number
 * of successfully APPENDED (non-duplicate) rows.
 */
export async function emitEconomicBatch(
  inputs: (BuildEventInput | null)[],
  ledger: EconLedgerStore,
): Promise<{ appended: number; duplicate: number; dropped: number }> {
  const events: EconomicEvent[] = [];
  let dropped = 0;
  for (const input of inputs) {
    if (!input) {
      dropped += 1;
      continue;
    }
    try {
      events.push(buildEconomicEvent(input));
    } catch (err) {
      dropped += 1;
      logger.warn("econ-ledger: backfill dropped event", {
        source: input.source,
        sourceId: input.sourceId,
        kind: input.kind,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  if (events.length === 0) return { appended: 0, duplicate: 0, dropped };
  const results = await ledger.append(events);
  return {
    appended: results.filter((r) => !r.duplicate).length,
    duplicate: results.filter((r) => r.duplicate).length,
    dropped,
  };
}

/** ms-epoch → ISO-8601 (canonical event clock `at`). */
export function isoFromMs(ms: number): string {
  return new Date(ms).toISOString();
}
