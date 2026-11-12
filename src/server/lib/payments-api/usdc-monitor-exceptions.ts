/**
 * SLICE-222-4 — monitor → PaymentException bridge (extracted from
 * usdc-monitor-drive.ts, file-size lint cap).
 *
 * Every flag path writes BOTH an append-only attempt event (audit)
 * AND a durable exception row (ops queue). Deterministic exception
 * ids dedupe re-scans — a repeated observation never double-fires.
 */
import type {
  AttemptPaymentExpectation,
  ChainTxEvidence,
  PaymentFailureReason,
  PersistedAttempt,
} from "@agentbadge/payments";
import type { UsdcMonitorDeps } from "./usdc-monitor";

const ACTOR = "usdc-monitor";

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e);
}

/** Reason an attempt was flagged — terminal-state aware (222-4):
 *  a tx hitting an EXPIRED attempt's expectation is LATE_PAYMENT,
 *  not a generic duplicate. */
function flagKind(
  failureReason: string,
  attempt: PersistedAttempt,
): PaymentFailureReason {
  if (
    failureReason === "DUPLICATE_TRANSFER" &&
    attempt.status === "EXPIRED"
  ) {
    return "LATE_PAYMENT";
  }
  return failureReason as PaymentFailureReason;
}

function flagSeverity(
  kind: PaymentFailureReason,
): "INFO" | "WARN" | "CRITICAL" {
  // Money captured against a consumed attempt = ops-critical.
  if (kind === "LATE_PAYMENT" || kind === "DUPLICATE_TRANSFER") {
    return "CRITICAL";
  }
  return "WARN";
}

/** 222-4: durable exception row — deterministic id dedupes re-scans. */
export async function recordException(
  deps: UsdcMonitorDeps,
  att: PersistedAttempt,
  kind: PaymentFailureReason,
  tx: ChainTxEvidence,
  atMs: number,
  extra?: Record<string, unknown>,
): Promise<void> {
  const store = deps.stores.exceptions;
  if (!store) return;
  try {
    await store.append({
      id: `exc-${att.id}-${tx.txHash}-${kind}`,
      paymentId: att.paymentId,
      attemptId: att.id,
      kind,
      severity: flagSeverity(kind),
      details: {
        txHash: tx.txHash,
        amountUnits: tx.amountUnits.toString(),
        payer: tx.from,
        recipient: tx.to,
        network: tx.network,
        confirmations: tx.confirmations,
        blockNumber: tx.blockNumber.toString(),
        ...extra,
      },
      status: "OPEN",
      createdAtMs: atMs,
    });
  } catch (e) {
    deps.logger?.warn("usdc-monitor: exception append failed", {
      attemptId: att.id,
      kind,
      error: errMsg(e),
    });
  }
}

/** FUZZY/AMBIGUOUS → deterministic flag events + exceptions
 *  (dedupe-safe on re-scan) on every involved attempt. Never
 *  confirms, never merges. */
export async function flagMatch(
  deps: UsdcMonitorDeps,
  matchStatus: "FUZZY" | "AMBIGUOUS",
  candidates: {
    expectation: AttemptPaymentExpectation;
    failureReason: string;
  }[],
  attemptsById: Map<string, PersistedAttempt>,
  tx: ChainTxEvidence,
  atMs: number,
): Promise<number> {
  let flagged = 0;
  for (const c of candidates) {
    const att = attemptsById.get(c.expectation.attemptId);
    if (!att) continue;
    try {
      await deps.stores.events.append({
        // Deterministic id — re-scanning the same tx re-appends null.
        id: `usdcmon-flag-${att.id}-${tx.txHash}-${matchStatus}`,
        entity: "PAYMENT_ATTEMPT",
        paymentId: att.paymentId,
        attemptId: att.id,
        from: att.status,
        to: att.status,
        actor: ACTOR,
        reason: `usdc-monitor ${matchStatus}: ${c.failureReason} (tx ${tx.txHash})`,
        atMs,
        payload: {
          txHash: tx.txHash,
          matchStatus,
          failureReason: c.failureReason,
          amountUnits: tx.amountUnits.toString(),
          payer: tx.from,
        },
      });
      flagged++;
    } catch (e) {
      deps.logger?.warn("usdc-monitor: flag event failed", {
        attemptId: att.id,
        error: errMsg(e),
      });
    }
    await recordException(
      deps,
      att,
      flagKind(c.failureReason, att),
      tx,
      atMs,
      {
        matchStatus,
        expectedAmountUnits: c.expectation.amountUnits.toString(),
        attemptStatus: att.status,
      },
    );
  }
  return flagged;
}
