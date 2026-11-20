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
  /** Persisted UsageRecord — the event is anchored to this row. */
  usage: PersistedUsageRecord;
  outcome: X402FulfillmentOutcome;
  /** Response status observed post-handler; omitted when none exists. */
  httpStatus?: number;
}

/** Map to the event input. Exported for tests. */
export function fulfillmentToEconomic(leg: FulfillmentLeg): EconomicEvent {
  const now = new Date().toISOString();
  return buildEconomicEvent({
    source: "x402",
    sourceId: `${leg.usage.id}~fulfill`,
    seq: 1,
    kind: "x402_fulfillment",
    actor: "x402-gateway",
    at: now,
    payload: {
      usageRecordId: leg.usage.id,
      paymentId: leg.usage.paymentId,
      requestId: leg.usage.requestId,
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
      usageRecordId: leg.usage.id,
      error: err instanceof Error ? err.message : String(err),
    });
    return;
  }
  void store.append([event]).catch((err: unknown) => {
    x402FulfillmentEmitFailedTotal.inc();
    // replay target: context.event is the complete serialized event —
    // replay-fulfillment-events.mts re-appends it by idempotency key.
    logger.warn("x402-fulfillment: ledger append failed (replayable)", {
      replay: "replay-fulfillment-events.mts",
      idempotencyKey: event.idempotencyKey,
      event,
      error: err instanceof Error ? err.message : String(err),
    });
  });
}
