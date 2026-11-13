/**
 * Fulfillment registry (SLICE-221-3, D-221-4): Map<productCode|kind,
 * handler> invoked with normalized input — never a raw Stripe session.
 *
 * Both rails converge here:
 *  - new API path: webhook confirm → CONFIRMED → dispatchFulfillment with
 *    catalog productCode; kind resolves via the commerce catalog.
 *  - legacy path: fulfillOrder adapts Stripe.Checkout.Session → the same
 *    normalized input (kind resolved from legacy productId).
 *
 * Exactly-once (SLICE-221-7, audit C-1/C-2):
 *  - In-process: `inFlight` blocks concurrent dispatch of the same key;
 *    `fulfilledRefs` is set only AFTER the handler succeeds — a throwing
 *    handler stays retryable (C-1).
 *  - Durable: when `opts.events` is provided and the dedupeKey is
 *    `payment:<id>`, the payment's event log carries
 *    FULFILLMENT claimed → done events. Claim/done ids are deterministic
 *    (`fulfill-claim-`/`fulfill-done-`), so `events.append`'s id-dedupe is
 *    an atomic cross-instance claim. A `claimed` marker without `done`
 *    older than CLAIM_STALE_MS is treated as a crashed run and retried.
 */

import {
  buildEffectContext,
  type FulfillmentEffectContext,
} from "./fulfillment-effects";
import {
  FULFILLMENT_ACTOR,
  FULFILLMENT_ENTITY,
  claimEventId,
  doneEventId,
  durableState,
  newMarkerId,
  reclaimEventId,
  resolveKind,
  unresolvedEventId,
} from "./fulfillment-state";

export type { FulfillmentEffectContext } from "./fulfillment-effects";

export interface FulfillmentInput {
  /** Catalog code (PASSPORT_BRONZE) or legacy productId (passport-bronze). */
  productCode: string;
  /** O2: email or accountId — best-effort buyer reference. */
  buyerRef?: string;
  metadata: Record<string, unknown>;
  email?: string;
  amountUsd?: string;
  /** paymentId or session.id — used in logs/notifications. */
  paymentRef?: string;
}

/**
 * Audit C-1 (EPIC-222): handlers with external effects MUST return a
 * discriminated outcome — a silent return is never treated as
 * "delivered". Dispatch writes the durable `done` marker ONLY for
 * executed/deduped-done; anything else stays retryable/ops-visible.
 */
export type FulfillmentOutcome =
  /** The external effect ran to completion in this call. */
  | "executed"
  /** A prior durable effect-done proves the effect already ran. */
  | "deduped-done"
  /** Another worker owns the effect/claim right now — do NOT record
   *  done locally (the winner writes it). */
  | "deduped"
  /** The effect could not be attempted or is in an ambiguous state
   *  (unresolved intent, missing metadata, feature gate off) — ops
   *  must reconcile; dispatch records `unresolved`, NOT `done`. */
  | "needs-ops";

export type FulfillmentHandler = (
  input: FulfillmentInput,
  ctx?: FulfillmentEffectContext,
) => Promise<FulfillmentOutcome>;
export type FulfillmentNotifier = (input: FulfillmentInput) => Promise<void>;

/** Narrow structural slice of the payments EventStorePort — only the two
 *  methods fulfillment needs (keeps this module IO-free for tests). */
export interface FulfillmentEventStore {
  append(e: {
    id: string;
    entity: string;
    paymentId: string;
    attemptId?: string | null;
    from: string;
    to: string;
    actor: string;
    reason?: string | null;
    atMs: number;
    payload?: unknown;
  }): Promise<unknown>;
  listByPayment(
    paymentId: string,
  ): Promise<
    { entity: string; to: string; atMs: number; payload?: unknown }[]
  >;
}

export type FulfillmentDispatchStatus =
  | "fulfilled"
  | "deduped"
  | "no-handler"
  /** C-1: handler reported needs-ops — unresolved marker written,
   *  `done` intentionally NOT recorded; caller must surface an
   *  ops exception. */
  | "unresolved";

const registry = new Map<string, FulfillmentHandler>();
/** Keys whose handler completed in THIS process (fast path). */
const fulfilledRefs = new Set<string>();
/** Keys with a handler currently executing — concurrency guard (C-1). */
const inFlightRefs = new Set<string>();
let notifier: FulfillmentNotifier | undefined;

export function registerFulfillmentHandler(
  key: string,
  handler: FulfillmentHandler,
): void {
  registry.set(key, handler);
}

/** Post-fulfillment hook (Discord notify) — set by order-fulfillment. */
export function setFulfillmentNotifier(n: FulfillmentNotifier): void {
  notifier = n;
}

/** Test hook — clears handlers, notifier and the dedupe ledgers. */
export function resetFulfillmentRegistry(): void {
  registry.clear();
  fulfilledRefs.clear();
  inFlightRefs.clear();
  notifier = undefined;
}

/**
 * Resolve kind → handler → run once per dedupeKey → notify.
 *
 * Statuses: "fulfilled" handler ran; "deduped" already done or in-flight;
 * "no-handler" no handler registered — callers must treat it as an error
 * (a paid payment with no handler is an ops incident, not a skip).
 * Handler errors always propagate — the caller's retry path (webhook
 * event-ledger release) is what makes paid-but-unfulfilled recoverable.
 */
export async function dispatchFulfillment(
  input: FulfillmentInput,
  opts: {
    kind?: string;
    dedupeKey?: string;
    registry?: Map<string, FulfillmentHandler>;
    notify?: FulfillmentNotifier | null;
    /** Durable dedupe (C-2) — payment event store; used only for
     *  `payment:<id>` dedupeKeys. */
    events?: FulfillmentEventStore;
    nowMs?: number;
  } = {},
): Promise<FulfillmentDispatchStatus> {
  const key = opts.dedupeKey;
  if (key && (fulfilledRefs.has(key) || inFlightRefs.has(key))) {
    return "deduped";
  }

  const reg = opts.registry ?? registry;
  const kind = resolveKind(input, opts.kind);
  const handler = reg.get(kind) ?? reg.get(input.productCode);
  if (!handler) return "no-handler";

  const nowMs = opts.nowMs ?? Date.now();
  const paymentId =
    key && key.startsWith("payment:") ? key.slice("payment:".length) : null;
  const events = opts.events;

  if (events && paymentId) {
    const state = await durableState(events, paymentId, nowMs);
    if (state === "done" || state === "claimed-fresh") return "deduped";
    if (state === "none") {
      // Atomic claim — deterministic id; append returns null on conflict.
      const claimed = await events.append({
        id: claimEventId(paymentId),
        entity: FULFILLMENT_ENTITY,
        paymentId,
        from: "dispatch",
        to: "claimed",
        actor: FULFILLMENT_ACTOR,
        atMs: nowMs,
      });
      if (claimed === null) {
        // Lost the claim — only proceed when the winner's claim went
        // stale between our two reads.
        const recheck = await durableState(events, paymentId, nowMs);
        if (recheck !== "stale-claim") return "deduped";
      }
    }
    if (state === "stale-claim") {
      // H-9: crashed run retry — fence concurrent reclaimers with a
      // CAS marker; only the first append wins, others stand down.
      const reclaimed = await events.append({
        id: reclaimEventId(paymentId),
        entity: FULFILLMENT_ENTITY,
        paymentId,
        from: "stale-claim",
        to: "claimed",
        actor: FULFILLMENT_ACTOR,
        reason: "reclaimed after claim went stale",
        atMs: nowMs,
      });
      if (reclaimed === null) return "deduped";
    }
  } else if (key) {
    inFlightRefs.add(key);
  }

  // 6.1/6.2: operation-level effect guard — handlers that mint/spend
  // check priorEffect before external work; a stale-claim retry then
  // dedupes on "done", never re-executes.
  const effectCtx =
    events && paymentId ? buildEffectContext(events, paymentId) : undefined;

  let outcome: FulfillmentOutcome;
  try {
    outcome = await handler(input, effectCtx);
  } catch (err) {
    if (key) inFlightRefs.delete(key);
    if (events && paymentId) {
      // Observability marker — a failed run stays retryable.
      try {
        await events.append({
          id: newMarkerId("fulfill-fail"),
          entity: FULFILLMENT_ENTITY,
          paymentId,
          from: "claimed",
          to: "failed",
          actor: FULFILLMENT_ACTOR,
          reason: err instanceof Error ? err.message.slice(0, 300) : String(err),
          atMs: nowMs,
        });
      } catch {
        /* marker is best-effort */
      }
    }
    throw err;
  }

  // C-1: `done` is recorded only when the handler PROVES the effect
  // ran (executed) or the durable ledger proves it (deduped-done).
  if (outcome === "deduped") {
    if (key) inFlightRefs.delete(key);
    return "deduped";
  }
  if (outcome === "needs-ops") {
    if (key) inFlightRefs.delete(key);
    if (events && paymentId) {
      try {
        await events.append({
          id: unresolvedEventId(paymentId),
          entity: FULFILLMENT_ENTITY,
          paymentId,
          from: "claimed",
          to: "unresolved",
          actor: FULFILLMENT_ACTOR,
          reason:
            "handler reported needs-ops — paid but not delivered; " +
            "done intentionally not recorded",
          atMs: nowMs,
        });
      } catch {
        /* unresolved marker is best-effort; claim still dedupes */
      }
    }
    return "unresolved";
  }

  // executed | deduped-done → record done.
  if (key) {
    inFlightRefs.delete(key);
    fulfilledRefs.add(key);
  }
  if (events && paymentId) {
    try {
      await events.append({
        id: doneEventId(paymentId),
        entity: FULFILLMENT_ENTITY,
        paymentId,
        from: "claimed",
        to: "done",
        actor: FULFILLMENT_ACTOR,
        atMs: nowMs,
      });
    } catch {
      /* done-marker is best-effort; the claim already dedupes retries */
    }
  }

  const notify = opts.notify === undefined ? notifier : opts.notify;
  await notify?.(input);
  return "fulfilled";
}
