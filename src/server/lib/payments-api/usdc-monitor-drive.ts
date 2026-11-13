/**
 * USDC monitor — per-transfer drive helpers (EPIC-222-3).
 *
 * Extracted from usdc-monitor.ts (max-lines): expectation/evidence
 * shaping plus the EXACT-match state-machine drive and the
 * FUZZY/AMBIGUOUS flag path. Pure logic over injected deps.
 */

import {
  applyAttemptTransition,
  decimalToUnits,
  driveAttemptTo,
  drivePaymentTo,
  verifyTransfer,
  type AttemptPaymentExpectation,
  type ChainTxEvidence,
  type PaymentEvidence,
  type PaymentNetworkAsset,
  type PaymentNetworkConfig,
  type PersistedAttempt,
} from "@agentbadge/payments";
import { flagMatch, recordException } from "./usdc-monitor-exceptions";

import type { UsdcMonitorDeps, UsdcMonitorTickResult } from "./usdc-monitor";

const ACTOR = "usdc-monitor";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e);
}

/** bigint base units → decimal string ("9999964", 6) → "9.999964". */
export function unitsToDecimal(units: bigint, decimals: number): string {
  const s = units.toString().padStart(decimals + 1, "0");
  const int = s.slice(0, -decimals);
  const frac = s.slice(-decimals).replace(/0+$/, "");
  return frac ? `${int}.${frac}` : int;
}

/** Attempt row → verification expectation — create-time payload
 *  (H-4) wins over live config; both are server-side, never client. */
export function toExpectation(
  attempt: PersistedAttempt,
  net: PaymentNetworkConfig,
  asset: PaymentNetworkAsset,
): AttemptPaymentExpectation {
  const payload = (attempt.payload ?? {}) as Record<string, unknown>;
  const amount =
    typeof payload.expectedAmount === "string"
      ? payload.expectedAmount
      : attempt.amount;
  const recipient =
    typeof payload.expectedRecipient === "string"
      ? payload.expectedRecipient
      : (net.treasuryAddress ?? "");
  const boundMin =
    typeof payload.minConfirmations === "number" &&
      Number.isFinite(payload.minConfirmations)
      ? payload.minConfirmations
      : 0;
  return {
    attemptId: attempt.id,
    paymentId: attempt.paymentId,
    amount,
    amountUnits: decimalToUnits(amount, asset.decimals),
    recipient,
    tokenContract: asset.contractAddress,
    network: net.caip2,
    expiresAtMs: attempt.expiresAtMs ?? undefined,
    // Attempt may only tighten the network floor (H-2).
    minConfirmations: Math.max(boundMin, net.confirmationsRequired),
    // Terminal attempts stay in the feed as consumed expectations —
    // an exact-amount hit flags DUPLICATE/LATE, never EXACT.
    payable: !["CONFIRMED", "FAILED", "EXPIRED"].includes(
      attempt.status,
    ),
    // Audit H-3: the attempt's own bound tx re-scanned must NOT flag
    // DUPLICATE — only a different tx with the same amount does.
    boundTxHash: attempt.transactionHash ?? undefined,
  };
}

/** In-tick consumption (audit H-3): after a successful confirm the
 *  expectation snapshot is marked consumed + bound, so a second
 *  exact-amount tx in the SAME tick flags DUPLICATE instead of
 *  re-driving confirm/fulfillment on the stale payable snapshot. */
export function consumeExpectation(
  expectation: AttemptPaymentExpectation,
  txHash: string,
): void {
  expectation.payable = false;
  expectation.boundTxHash = txHash;
}

/** Chain evidence → normalized PaymentEvidence for the pipeline. */
export function toPaymentEvidence(
  tx: ChainTxEvidence,
  attempt: PersistedAttempt,
  decimals: number,
  atMs: number,
): PaymentEvidence {
  return {
    provider: "DIRECT_USDC",
    providerReference: attempt.providerReference ?? "",
    transactionHash: tx.txHash,
    network: tx.network,
    payer: tx.from,
    recipient: tx.to,
    amount: unitsToDecimal(tx.amountUnits, decimals),
    currency: "USDC",
    status: "SUCCESS",
    observedAt: new Date(atMs),
    finalizedAt: new Date(atMs),
    confirmations: tx.confirmations,
    metadata: {
      blockNumber: tx.blockNumber.toString(),
      tokenContract: tx.tokenContract,
    },
  };
}

export { flagMatch, recordException };

/** EXACT match → verify → drive the state machine. */
export async function driveExactMatch(
  deps: UsdcMonitorDeps,
  attempt: PersistedAttempt,
  tx: ChainTxEvidence,
  expectation: AttemptPaymentExpectation,
  net: PaymentNetworkConfig,
  asset: PaymentNetworkAsset,
  result: UsdcMonitorTickResult,
  atMs: number,
): Promise<void> {
  const at = new Date(atMs);
  const verdict = verifyTransfer(tx, expectation, {
    network: net,
    nowMs: atMs,
  });

  if (verdict.status === "PENDING") {
    // Tx seen onchain, finality short — bind the txHash early so the
    // service-side replay guard owns it, then wait for the next tick.
    if (attempt.status === "PENDING") {
      await applyAttemptTransition(deps.stores, attempt, "PROCESSING", {
        actor: ACTOR,
        reason: `onchain transfer detected, awaiting finality (tx ${tx.txHash})`,
        at,
        patch: { transactionHash: tx.txHash },
      });
    }
    result.pending++;
    return;
  }

  if (verdict.status === "REJECTED") {
    // Defensive path — payable attempts can't be late and an exact
    // match can't mis-amount; still honor the verdict honestly.
    await driveAttemptTo(deps.stores, attempt, "FAILED", {
      actor: ACTOR,
      reason: `onchain verify rejected: ${verdict.failureReason} (tx ${tx.txHash})`,
      at,
      patch: { transactionHash: tx.txHash },
    });
    await recordException(
      deps,
      attempt,
      verdict.failureReason ?? "AMOUNT_MISMATCH",
      tx,
      atMs,
      { stage: "verify", attemptStatus: "FAILED" },
    );
    if (verdict.failureReason === "LATE_PAYMENT") {
      // Funds captured late — dispute for ops, never auto-confirm.
      const payment = await deps.stores.payments.getById(attempt.paymentId);
      if (payment) {
        await drivePaymentTo(deps.stores, payment, "DISPUTED", {
          actor: ACTOR,
          reason: `late onchain payment captured (tx ${tx.txHash})`,
          at,
        });
      }
    }
    result.rejected++;
    return;
  }

  // CONFIRMED — feed evidence through the hardened confirm path.
  const evidence = toPaymentEvidence(tx, attempt, asset.decimals, atMs);
  const outcome = await deps.confirm({
    attemptId: attempt.id,
    evidence,
    actor: ACTOR,
  });
  if (outcome.status !== "CONFIRMED") {
    deps.logger?.warn("usdc-monitor: verify CONFIRMED but confirm rejected", {
      attemptId: attempt.id,
      outcome: outcome.status,
      reason: outcome.reason,
    });
    result.errors.push({
      stage: `confirm:${attempt.id}`,
      message: outcome.reason ?? outcome.status,
    });
    return;
  }
  result.confirmed++;
  consumeExpectation(expectation, tx.txHash);
  // Entitlement hook — durable claim/done inside dispatchFulfillment.
  try {
    await deps.fulfill?.(attempt.paymentId);
  } catch (e) {
    result.errors.push({
      stage: `fulfill:${attempt.paymentId}`,
      message: errMsg(e),
    });
  }
}
