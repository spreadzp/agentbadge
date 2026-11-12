/**
 * Fulfillment effect-context (EPIC-222-3, reviews 6.1/6.2):
 * operation-level durable guard for a handler's external
 * side-effect (onchain mint, ledger write, …).
 *
 * Dispatch claim/done covers the *handler run*; these markers cover
 * the *effect itself*, because a process can crash between "effect
 * executed" and "done marker written":
 *
 * - `markIntent` — deterministic id `fulfill-effect-intent-<opId>`,
 *   atomic first-writer-wins BEFORE the effect runs. A surviving
 *   intent without a done means "effect may have executed" — callers
 *   must NOT blindly re-run, they flag for ops (or consult the
 *   ledger).
 * - `markDone` — deterministic id `fulfill-effect-done-<opId>` with
 *   the effect result; `priorEffect()` returning "done" lets a
 *   crashed/stale-claim retry dedupe without a second mint.
 *
 * Built only when `opts.events` + a `payment:<id>` dedupeKey exist —
 * in-memory-only dispatches get `undefined` and fall back to the
 * in-process dedupe ledgers.
 */

import type { FulfillmentEventStore } from "./fulfillment";

const FULFILLMENT_ENTITY = "FULFILLMENT";
const FULFILLMENT_ACTOR = "fulfillment-registry";

export interface FulfillmentEffectContext {
  operationId: string;
  priorEffect(): Promise<{
    status: "none" | "intent" | "done";
    result?: unknown;
  }>;
  /** false = another worker already claimed the effect. */
  markIntent(): Promise<boolean>;
  markDone(result: unknown): Promise<void>;
}

const effectIntentId = (opId: string) => `fulfill-effect-intent-${opId}`;
const effectDoneId = (opId: string) => `fulfill-effect-done-${opId}`;

export function buildEffectContext(
  events: FulfillmentEventStore,
  paymentId: string,
): FulfillmentEffectContext {
  return {
    operationId: paymentId,
    async priorEffect() {
      const rows = await events.listByPayment(paymentId);
      let intent = false;
      let done: { status: "done"; result?: unknown } | null = null;
      for (const e of rows) {
        if (e.entity !== FULFILLMENT_ENTITY) continue;
        if (e.to === "effect-done") {
          done = { status: "done", result: e.payload };
        } else if (e.to === "effect-intent") {
          intent = true;
        }
      }
      if (done) return done;
      if (intent) return { status: "intent" };
      return { status: "none" };
    },
    async markIntent() {
      const appended = await events.append({
        id: effectIntentId(paymentId),
        entity: FULFILLMENT_ENTITY,
        paymentId,
        from: "claimed",
        to: "effect-intent",
        actor: FULFILLMENT_ACTOR,
        atMs: Date.now(),
      });
      return appended !== null;
    },
    async markDone(result) {
      try {
        await events.append({
          id: effectDoneId(paymentId),
          entity: FULFILLMENT_ENTITY,
          paymentId,
          from: "effect-intent",
          to: "effect-done",
          actor: FULFILLMENT_ACTOR,
          atMs: Date.now(),
          payload: result,
        });
      } catch {
        /* effect result marker is best-effort — intent already dedupes */
      }
    },
  };
}
