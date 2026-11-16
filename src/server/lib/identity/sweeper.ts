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
 */
import type { PaymentRow, PaymentStores } from "@agentbadge/database";

import type { EntitlementService } from "./entitlements";
import { entitlementCatalogEntry } from "./types";

export interface EntitlementSweepResult {
  attemptsScanned: number;
  candidates: number;
  granted: number;
  deduped: number;
  /** Payments skipped — no resolvable owner wallet, unmapped
   *  product, or payment not CONFIRMED. */
  skipped: { paymentId: string; reason: string }[];
  expired: number;
  errors: { stage: string; message: string }[];
}

export interface EntitlementSweepDeps {
  entitlements: EntitlementService;
  payments: PaymentStores;
  /**
   * Resolve the grantee wallet for a confirmed payment. Default:
   * `customerId` when it is an EVM wallet; callers plug in
   * agentId→registration→owner resolution for non-wallet customers.
   */
  ownerFor?: (payment: PaymentRow) => Promise<string | null> | string | null;
  /** Window for `listRecentTerminal` when `sinceMs` is absent. */
  lookbackMs?: number;
  sinceMs?: number;
  nowMs?: () => number;
  /** Max grants per tick — bounds a backlog catch-up. */
  maxGrants?: number;
}

const WALLET_RE = /^0x[0-9a-f]{40}$/;

const errMsg = (e: unknown): string =>
  e instanceof Error ? e.message.slice(0, 300) : String(e);

function defaultOwnerFor(payment: PaymentRow): string | null {
  const c = payment.customerId;
  if (typeof c === "string" && WALLET_RE.test(c.toLowerCase())) {
    return c.toLowerCase();
  }
  return null;
}

export async function runEntitlementSweep(
  deps: EntitlementSweepDeps,
): Promise<EntitlementSweepResult> {
  const now = deps.nowMs ?? Date.now;
  const ownerFor = deps.ownerFor ?? defaultOwnerFor;
  const maxGrants = deps.maxGrants ?? 100;
  const sinceMs =
    deps.sinceMs ?? now() - (deps.lookbackMs ?? 24 * 60 * 60 * 1000);

  const result: EntitlementSweepResult = {
    attemptsScanned: 0,
    candidates: 0,
    granted: 0,
    deduped: 0,
    skipped: [],
    expired: 0,
    errors: [],
  };

  // 1) Expiry pass — converges stored state for overdue ACTIVE rows.
  try {
    const expired = await deps.entitlements.expireOverdue(now());
    result.expired = expired.length;
  } catch (e) {
    result.errors.push({ stage: "expire", message: errMsg(e) });
  }

  // 2) Activation pass — CONFIRMED attempts → CONFIRMED payments.
  const attempts = await deps.payments.attempts.listRecentTerminal(sinceMs);
  result.attemptsScanned = attempts.length;

  for (const attempt of attempts) {
    if (attempt.status !== "CONFIRMED") continue;
    result.candidates++;
    if (result.granted + result.deduped >= maxGrants) break;
    try {
      const payment = await deps.payments.payments.getById(
        attempt.paymentId,
      );
      if (!payment || payment.status !== "CONFIRMED") {
        result.skipped.push({
          paymentId: attempt.paymentId,
          reason: payment
            ? `payment status ${payment.status}`
            : "payment row missing",
        });
        continue;
      }
      const productCode = payment.productId;
      if (
        typeof productCode !== "string" ||
        !entitlementCatalogEntry(productCode)
      ) {
        result.skipped.push({
          paymentId: payment.id,
          reason: `productId ${productCode ?? "null"} not entitlement-eligible`,
        });
        continue;
      }
      const owner = await ownerFor(payment);
      if (!owner) {
        result.skipped.push({
          paymentId: payment.id,
          reason: "no resolvable owner wallet",
        });
        continue;
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

  return result;
}
