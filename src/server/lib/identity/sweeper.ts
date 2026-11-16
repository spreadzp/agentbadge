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
 * SLICE-225-6 audit fixes:
 * - C-2: catalog payment binding — when a catalog entry declares
 *   `minAmount`/`currency`, the payment must cover it (string-equal
 *   productId alone proved nothing); `customerId` must also match
 *   the resolved owner (no gift/squat grants).
 * - H-4: only NEW grants count against `maxGrants` — deduped rows
 *   no longer starve real candidates; `skipped[]` is capped.
 * - H-5: reversal pass — ACTIVE entitlements whose source payment
 *   is no longer CONFIRMED (refund/chargeback) are revoked.
 * - M-4: the actor row is ensured (lazy resolveOrCreate) before a
 *   grant, so FK'd or join-reading consumers never see orphans.
 */
import type {
  PaymentAttemptRow,
  PaymentRow,
  PaymentStores,
} from "@agentbadge/database";

import type { EntitlementService } from "./entitlements";
import { entitlementCatalogEntry } from "./types";

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
  /** ACTIVE entitlements revoked because their source payment lost
   *  CONFIRMED status (refund/chargeback) — audit H-5. */
  revoked: number;
  errors: { stage: string; message: string }[];
}

export interface EntitlementSweepDeps {
  entitlements: EntitlementService;
  payments: PaymentStores;
  /** Actor service — lazy-create the grantee row before grant
   *  (M-4; no dangling owner references). */
  actors?: { resolveOrCreate(wallet: string): Promise<unknown> };
  /**
   * Resolve the grantee wallet for a confirmed payment. Default:
   * `customerId` when it is an EVM wallet; callers plug in
   * agentId→registration→owner resolution for non-wallet customers.
   * Whatever it returns must still equal `payment.customerId`
   * (C-2 — the grantee IS the payer of record; resolver output
   * that disagrees is an error, not a grant).
   */
  ownerFor?: (payment: PaymentRow) => Promise<string | null> | string | null;
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

const WALLET_RE = /^0x[0-9a-f]{40}$/;
const MAX_SKIPPED = 200;

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.slice(0, 300) : String(e);

function defaultOwnerFor(payment: PaymentRow): string | null {
  const c = payment.customerId;
  if (typeof c === "string" && WALLET_RE.test(c.toLowerCase())) {
    return c.toLowerCase();
  }
  return null;
}

/** Decimal-string compare without floats: ≥ returns true. */
function amountAtLeast(amount: string, min: string): boolean {
  const a = Number(amount);
  const m = Number(min);
  return Number.isFinite(a) && Number.isFinite(m) && a >= m;
}

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
    errors: [],
  };

  const skip = (paymentId: string, reason: string) => {
    result.skippedCount++;
    if (result.skipped.length < MAX_SKIPPED) {
      result.skipped.push({ paymentId, reason });
    }
  };

  // 1) Expiry pass — converges stored state for overdue ACTIVE rows.
  try {
    const expired = await deps.entitlements.expireOverdue(now());
    result.expired = expired.length;
  } catch (e) {
    result.errors.push({ stage: "expire", message: errMsg(e) });
  }

  // 2) Activation pass — CONFIRMED attempts → CONFIRMED payments.
  let attempts: PaymentAttemptRow[];
  try {
    attempts = await deps.payments.attempts.listRecentTerminal(sinceMs);
  } catch (e) {
    result.errors.push({ stage: "attempt-feed", message: errMsg(e) });
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
      // C-2 payment binding: declared catalog price/currency must be
      // covered — a bare productId string proves nothing.
      if (
        entry.currency !== undefined &&
        (payment.currency ?? "USD") !== entry.currency
      ) {
        skip(
          payment.id,
          `payment currency ${payment.currency ?? "null"} != ${entry.currency}`,
        );
        continue;
      }
      if (
        entry.minAmount !== undefined &&
        !amountAtLeast(payment.amount, entry.minAmount)
      ) {
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
      // C-2: grantee must be the payer of record — the resolver can
      // only NARROW customerId, never reroute the grant elsewhere.
      if (payment.customerId?.toLowerCase() !== owner) {
        result.errors.push({
          stage: `attempt:${attempt.id}`,
          message: `ownerFor resolved ${owner} but payment.customerId is ${payment.customerId ?? "null"} — refusing grant`,
        });
        continue;
      }
      // M-4: ensure the actor row exists before granting (FK/read
      // joins downstream must not see dangling owners).
      if (deps.actors) {
        await deps.actors.resolveOrCreate(owner);
      }
      const { deduped } = await deps.entitlements.grant({
        ownerId: owner,
        productCode,
        sourcePaymentId: payment.id,
        validFromMs: attempt.confirmedAtMs ?? now(),
        payload: { activatedBy: "entitlement-sweep" },
      });
      if (deduped) result.deduped++;
      else result.granted++;
    } catch (e) {
      result.errors.push({
        stage: `attempt:${attempt.id}`,
        message: errMsg(e),
      });
    }
  }

  // 3) Reversal pass (audit H-5) — an ACTIVE entitlement whose
  // source payment lost CONFIRMED status (refund/chargeback/changed
  // record) is revoked; the dedupe key on the revoked row also
  // blocks re-activation of the same payment.
  try {
    const active = await deps.entitlements.listActiveWithSource?.(
      maxReversals,
    );
    for (const row of active ?? []) {
      const payment = row.sourcePaymentId
        ? await deps.payments.payments.getById(row.sourcePaymentId)
        : null;
      if (payment && payment.status === "CONFIRMED") continue;
      try {
        await deps.entitlements.revoke(row.id);
        result.revoked++;
      } catch (e) {
        result.errors.push({
          stage: `reversal:${row.id}`,
          message: errMsg(e),
        });
      }
    }
  } catch (e) {
    result.errors.push({ stage: "reversal-feed", message: errMsg(e) });
  }

  return result;
}
