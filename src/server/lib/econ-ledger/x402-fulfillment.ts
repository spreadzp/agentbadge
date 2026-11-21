/**
 * SLICE-257-6 (EPIC-257): paid-handler outcome → `x402_fulfillment` leg.
 *
 * Complements the settle→`pay` projection (x402.ts): that leg records
 * that money moved; this one records what the paid handler did with
 * the request afterwards — the seller-side evidence vet402 can't see.
 *
 * Identity: source=x402, sourceId="{usageRecordId}~fulfill", seq=1 →
 * deterministic key `ev:x402:{usageRecordId}~fulfill:1` ("~" — sourceId
 * can't contain ":" per the key shape). Replays and handler retries
 * dedupe on that key.
 *
 * NOT a trust edge: no counterparty/amountUsdc — edgeDeltaOf skips it,
 * so exposure aggregates and revenue (`kind="pay"`) stay untouched.
 *
 * Fire-and-forget: build/append failure never reaches the request
 * path. On failure we log the FULL serialized EconomicEvent so
 * scripts/replay-fulfillment-events.mts can re-append it verbatim —
 * reconstructing a partial record would defeat the durable-evidence
 * contract.
 */

import {
  buildEconomicEvent,
  type EconomicEvent,
  type X402FulfillmentOutcome,
} from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import type { PersistedUsageRecord } from "@agentbadge/payments";
import { logger } from "@agentbadge/passport/logger";
import { Counter } from "prom-client";

import { registry } from "../../metrics/metrics";
import { econLedgerOrNull } from "./emit.js";

export const x402FulfillmentOutcomeTotal = new Counter({
  name: "x402_fulfillment_outcome_total",
  help: "x402 paid-handler outcomes observed (all paid requests)",
  labelNames: ["outcome"],
  registers: [registry],
});

export const x402FulfillmentEmitFailedTotal = new Counter({
  name: "x402_fulfillment_emit_failed_total",
  help: "x402_fulfillment ledger writes that failed (full event in warn log for replay)",
  registers: [registry],
});

export interface FulfillmentLeg {
  /** Persisted UsageRecord — the event anchors to this row. Null when
   *  post-settle accounting failed (M-5): the event then keys on
   *  `requestId` so evidence still exists exactly when the DB is flaky. */
  usage: PersistedUsageRecord | null;
  outcome: X402FulfillmentOutcome;
  /** Correlation id used when `usage` is null (requestId fallback per
   *  payloads.ts doc). Ignored when usage exists. */
  requestId?: string;
  /** Response status observed post-handler; omitted when none exists. */
  httpStatus?: number;
}

/** Map to the event input. Exported for tests. */
export function fulfillmentToEconomic(leg: FulfillmentLeg): EconomicEvent {
  const now = new Date().toISOString();
  return buildEconomicEvent({
    source: "x402",
    sourceId: `${leg.usage?.id ?? leg.requestId ?? "unknown"}~fulfill`,
    seq: 1,
    kind: "x402_fulfillment",
    actor: "x402-gateway",
    at: now,
    payload: {
      // M-5: requestId fallback — a missing UsageRecord must not erase
      // the observation (its absence usually means the DB is flaky,
      // which is exactly when evidence matters).
      usageRecordId: leg.usage?.id ?? leg.requestId ?? "unknown",
      paymentId: leg.usage?.paymentId ?? leg.requestId ?? "unknown",
      requestId: leg.usage?.requestId ?? leg.requestId ?? "unknown",
      outcome: leg.outcome,
      ...(leg.httpStatus !== undefined ? { httpStatus: leg.httpStatus } : {}),
      observedAt: now,
      observationSource: "server",
    },
  });
}

/**
 * Emit after the paid handler settles its outcome — never throws,
 * never blocks the response path. No usage row → no event (the
 * settle-side reconcile log already covers that lost data).
 */
export function emitX402Fulfillment(
  leg: FulfillmentLeg,
  ledger?: EconLedgerStore | null,
): void {
  x402FulfillmentOutcomeTotal.inc({ outcome: leg.outcome });
  const store = ledger === undefined ? econLedgerOrNull() : ledger;
  if (!store) return;
  let event: EconomicEvent;
  try {
    event = fulfillmentToEconomic(leg);
  } catch (err) {
    x402FulfillmentEmitFailedTotal.inc();
    logger.warn("x402-fulfillment: event build failed", {
      usageRecordId: leg.usage?.id ?? leg.requestId,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  // M-6: the replay record must exist for EVERY append failure —
  // a synchronous throw (or non-promise return) escapes a plain
  // `.catch`, and a throwing log inside the handler would become an
  // unhandled rejection. Wrap both sides.
  const onAppendFail = (err: unknown) => {
    try {
      x402FulfillmentEmitFailedTotal.inc();
      // replay target: context.event is the complete serialized
      // event — replay-fulfillment-events.mts re-appends by key.
      logger.warn("x402-fulfillment: ledger append failed (replayable)", {
        replay: "replay-fulfillment-events.mts",
        idempotencyKey: event.idempotencyKey,
        event,
        error: err instanceof Error ? err.message : String(err),
      });
    } catch {
      // even the warn-log failed — the paid response is unaffected
    }
  };
  try {
    void Promise.resolve(store.append([event])).catch(onAppendFail);
  } catch (err) {
    onAppendFail(err);
  }
}
