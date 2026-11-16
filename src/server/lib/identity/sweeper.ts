/**
 * SLICE-225-2 (EPIC-225): entitlement activation sweeper (D-225-4).
 *
 * Poll-based, EPIC-222 pattern: each tick scans terminal attempts
 * in a lookback window → CONFIRMED attempt + CONFIRMED payment +
 * entitlement-eligible productId → resolve owner wallet →
 * idempotent grant (dedupe key `payment.id|productCode` — repeat
 * ticks and replays are no-ops by construction).
 *
 * Feed: `payments.attempts.listRecentTerminal(sinceMs)` — terminal
 * attempts whose terminal transition is at/after `sinceMs`. The
 * caller passes an explicit watermark (persisted cursor is a
 * later-slice concern); default = full lookback window.
 *
 * Also expires overdue ACTIVE entitlements (check()'s lazy expiry
 * covers reads; this keeps the stored state converged).
 *
 * SLICE-225-6/7 audit fixes:
 * - C-2 / v2 N-1: catalog payment binding is DENY-BY-DEFAULT — an
 *   entry without a declared `minAmount`/`currency` can never be
 *   granted from a payment (unpriced codes stay ops-only). The
 *   payment must cover the declared floor in EXACTLY the declared
 *   currency (no implicit USD); `customerId` must also match the
 *   resolved owner (no gift/squat grants).
 * - H-4: only NEW grants count against `maxGrants` — deduped rows
 *   no longer starve real candidates; `skipped[]` and `errors[]`
 *   are capped (v2 N-10).
 * - H-5 / v2 N-4..N-6: reversal pass — ACTIVE entitlements whose
 *   source payment carries an explicit REVERSAL status are revoked
 *   (marked `reversedBy: payment-reversal` in payload). Missing
 *   payments and ambiguous statuses RETAIN the grant. The feed
 *   iterates a rotating keyset cursor so every sourced row is
 *   re-checked; a reversal-revoked row re-activates when the
 *   payment is CONFIRMED again.
 * - M-4 / v2 N-7: the actor row is ensured inside `grant()` on
 *   NEW inserts only — deduped candidates cost no external calls.
 */
import type {
  PaymentAttemptRow,
  PaymentRow,
  PaymentStores,
} from "@agentbadge/database";

import type { EntitlementService } from "./entitlements";
import { entitlementCatalogEntry } from "./types";
import {
  amountAtLeast,
  defaultOwnerFor,
} from "./sweeper-helpers";
import { runReversalPass } from "./sweeper-reversal";

export interface EntitlementSweepResult {
  attemptsScanned: number;
  candidates: number;
  granted: number;
  deduped: number;
  /** Payments skipped — no resolvable owner wallet, unmapped
   *  product, payment not CONFIRMED, or under-payment (C-2).
   *  Capped at MAX_SKIPPED — the count stays exact. */
  skipped: { paymentId: string; reason: string }[];
  skippedCount: number;
  expired: number;
  /** ACTIVE entitlements revoked because their source payment
   *  carries an explicit reversal status — audit H-5 / v2 N-5. */
  revoked: number;
  /** Reversal-revoked rows re-activated on CONFIRMED payment
   *  (audit v2 N-6). */
  reactivated: number;
  errors: { stage: string; message: string }[];
  /** Capped at MAX_ERRORS — `errorsCount` stays exact. */
  errorsCount: number;
  /** Rotating keyset cursor for the reversal feed (audit v2 N-4) —
   *  pass it back via `deps.reversalCursor` on the next tick; null
   *  when the window wrapped (all rows re-checked). */
  reversalCursor: string | null;
}

export interface EntitlementSweepDeps {
  entitlements: EntitlementService;
  payments: PaymentStores;
  /**
   * Resolve the grantee wallet for a confirmed payment. Default:
   * `customerId` when it is an EVM wallet. The resolver may only
   * NARROW `customerId` to a wallet — whatever it returns MUST
   * equal `payment.customerId` (C-2: the grantee IS the payer of
   * record; any other resolution is an error, not a grant).
   */
  ownerFor?: (payment: PaymentRow) => Promise<string | null> | string | null;
  /** Rotating keyset cursor for the reversal feed (audit v2 N-4) —
   *  the value returned as `result.reversalCursor` on the previous
   *  tick. Undefined = start of the window. */
  reversalCursor?: string;
  /** Window for `listRecentTerminal` when `sinceMs` is absent. */
  lookbackMs?: number;
  sinceMs?: number;
  nowMs?: () => number;
  /** Max NEW grants per tick — bounds a backlog catch-up (deduped
   *  replays do not consume the cap; audit H-4). */
  maxGrants?: number;
  /** Max ACTIVE entitlements re-checked for payment reversal. */
  maxReversals?: number;
}

const MAX_SKIPPED = 200;
const MAX_ERRORS = 200;

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.slice(0, 300) : String(e);

export async function runEntitlementSweep(
  deps: EntitlementSweepDeps,
): Promise<EntitlementSweepResult> {
  const now = deps.nowMs ?? Date.now;
  const ownerFor = deps.ownerFor ?? defaultOwnerFor;
  const maxGrants = deps.maxGrants ?? 100;
  const maxReversals = deps.maxReversals ?? 200;
  const sinceMs =
    deps.sinceMs ?? now() - (deps.lookbackMs ?? 24 * 60 * 60 * 1000);

  const result: EntitlementSweepResult = {
    attemptsScanned: 0,
    candidates: 0,
    granted: 0,
    deduped: 0,
    skipped: [],
    skippedCount: 0,
    expired: 0,
    revoked: 0,
    reactivated: 0,
    errors: [],
    errorsCount: 0,
    reversalCursor: null,
  };

  const skip = (paymentId: string, reason: string) => {
    result.skippedCount++;
    if (result.skipped.length < MAX_SKIPPED) {
      result.skipped.push({ paymentId, reason });
    }
  };
  const err = (stage: string, e: unknown) => {
    result.errorsCount++;
    if (result.errors.length < MAX_ERRORS) {
      result.errors.push({ stage, message: errMsg(e) });
    }
  };

  // 1) Expiry pass — converges stored state for overdue ACTIVE rows.
  try {
    const expired = await deps.entitlements.expireOverdue(now());
    result.expired = expired.length;
  } catch (e) {
    err("expire", e);
  }

  // 2) Activation pass — CONFIRMED attempts → CONFIRMED payments.
  let attempts: PaymentAttemptRow[];
  try {
    attempts = await deps.payments.attempts.listRecentTerminal(sinceMs);
  } catch (e) {
    err("attempt-feed", e);
    attempts = [];
  }
  result.attemptsScanned = attempts.length;

  for (const attempt of attempts) {
    if (attempt.status !== "CONFIRMED") continue;
    result.candidates++;
    // Audit H-4: only NEW grants consume the cap — deduped replays
    // are cheap no-ops and must not starve real candidates.
    if (result.granted >= maxGrants) break;
    try {
      const payment = await deps.payments.payments.getById(
        attempt.paymentId,
      );
      if (!payment || payment.status !== "CONFIRMED") {
        skip(
          attempt.paymentId,
          payment
            ? `payment status ${payment.status}`
            : "payment row missing",
        );
        continue;
      }
      const productCode = payment.productId;
      if (typeof productCode !== "string") {
        skip(payment.id, `productId ${productCode ?? "null"} not entitlement-eligible`);
        continue;
      }
      const entry = entitlementCatalogEntry(productCode);
      if (!entry) {
        skip(
          payment.id,
          `productId ${productCode ?? "null"} not entitlement-eligible`,
        );
        continue;
      }
      // C-2 / v2 N-1 payment binding, DENY-BY-DEFAULT: an
      // unpriced catalog entry is never granted from a payment;
      // currency must match EXACTLY (no implicit USD); the amount
      // must cover the declared floor.
      if (entry.currency === undefined || entry.minAmount === undefined) {
        skip(
          payment.id,
          `catalog entry ${productCode} is unpriced — deny-by-default`,
        );
        continue;
      }
      if (payment.currency !== entry.currency) {
        skip(
          payment.id,
          `payment currency ${payment.currency ?? "null"} != ${entry.currency}`,
        );
        continue;
      }
      if (!amountAtLeast(payment.amount, entry.minAmount)) {
        skip(
          payment.id,
          `payment amount ${payment.amount} < catalog min ${entry.minAmount}`,
        );
        continue;
      }
      const owner = await ownerFor(payment);
      if (!owner) {
        skip(payment.id, "no resolvable owner wallet");
        continue;
      }
      // Round-3 F-8: normalize case — a checksummed resolver result
      // must not fail the identity comparison as an error.
      const ownerNorm = owner.toLowerCase();
      // C-2: grantee must be the payer of record — the resolver can
      // only NARROW customerId, never reroute the grant elsewhere.
      if (payment.customerId?.toLowerCase() !== ownerNorm) {
        err(
          `attempt:${attempt.id}`,
          new Error(
            `ownerFor resolved ${owner} but payment.customerId is ${payment.customerId ?? "null"} — refusing grant`,
          ),
        );
        continue;
      }
      // Round-4 N-15: the composite key is bounded by the store's
      // idempotency-key column — an overlong key throws per attempt
      // and the grant is skipped each tick. Guard + error entry
      // instead of silently burning ticks on an ungrantable row.
      const idemKey = `${ownerNorm}|${payment.id}|${productCode}`;
      if (idemKey.length > 128) {
        err(
          `grant:${payment.id}`,
          new Error(
            `idempotency key ${idemKey.length}ch > 128 (payment id too long)`,
          ),
        );
        continue;
      }
      // N-7: actor upsert moved into grant() — it runs only on NEW
      // inserts, so deduped candidates cost no external calls.
      const grantResult = await deps.entitlements.grant({
        ownerId: ownerNorm,
        productCode,
        sourcePaymentId: payment.id,
        // Owner-bound dedupe key (audit v2 N-11).
        idempotencyKey: idemKey,
        validFromMs: attempt.confirmedAtMs ?? now(),
        payload: { activatedBy: "entitlement-sweep" },
      });
      if (grantResult.deduped) {
        // N-6: a REVOKED row the reversal pass revoked
        // (`reversedBy: payment-reversal`) re-activates when the
        // payment is CONFIRMED again — a payment that flips
        // CONFIRMED→FAILED→CONFIRMED keeps its grant.
        if (
          grantResult.row.status === "REVOKED" &&
          (grantResult.row.payload as Record<string, unknown> | null)
            ?.reversedBy === "payment-reversal"
        ) {
          try {
            await deps.entitlements.reactivate(grantResult.row.id);
            result.reactivated++;
          } catch (e) {
            err(`reactivate:${grantResult.row.id}`, e);
          }
        } else {
          result.deduped++;
        }
      } else {
        result.granted++;
      }
    } catch (e) {
      err(`attempt:${attempt.id}`, e);
    }
  }

  // 3) Reversal pass (audit H-5 / v2 N-4..N-6) — extracted to
  // sweeper-reversal.ts (max-lines split); same semantics.
  await runReversalPass(deps, result, maxReversals, err);

  return result;
}
