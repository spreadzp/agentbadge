/**
 * USDC payment monitor — timer-free core (EPIC-222-3, D-222-3/4).
 *
 * Each tick: list payable DIRECT_USDC attempts → per network scan
 * treasury-bound ERC-20 Transfers over a lookback window → pure
 * match/verify (222-1) → drive the state machine via the SAME
 * hardened confirm path webhooks use (`evidence` seam, H-4
 * expectations stay attempt-bound):
 *
 *   EXACT + CONFIRMED → confirmPayment({evidence}) → CONFIRMED →
 *     receipt + event + fulfillment dispatch (durable claim/done)
 *   EXACT + PENDING   → tx seen, finality short → PROCESSING + txHash
 *   EXACT + REJECTED  → attempt FAILED + failureReason; late funds →
 *     payment DISPUTED (captured money needs ops, never auto-confirm)
 *   FUZZY / AMBIGUOUS → flag events on involved attempts — never
 *     confirm, never merge collisions (spec invariants)
 *   NONE              → unrelated treasury income; reconciliation
 *     (222-5) owns stray transfers, the monitor stays quiet
 *
 * RPC failures are per-network isolated: a down chain skips that
 * network's tick, other networks keep scanning, attempts stay
 * PENDING/PROCESSING for the next tick (AC: RPC down → retry).
 * Per-transfer drive helpers live in usdc-monitor-drive.ts (lines).
 */

import {
  getPaymentNetwork,
  matchTransfer,
  type ArcChainClient,
  type ConfirmPaymentInput,
  type ConfirmPaymentOutcome,
  type PaymentServiceStores,
  type PersistedAttempt,
} from "@agentbadge/payments";

import {
  driveExactMatch,
  flagMatch,
  toExpectation,
  unitsToDecimal,
} from "./usdc-monitor-drive";

export { unitsToDecimal };

export interface UsdcMonitorLogger {
  info(message: string, ctx?: Record<string, unknown>): void;
  warn(message: string, ctx?: Record<string, unknown>): void;
  error(message: string, ctx?: Record<string, unknown>): void;
}

export interface UsdcMonitorDeps {
  stores: PaymentServiceStores;
  /** PaymentService.confirmPayment — the single confirm path. */
  confirm: (
    input: ConfirmPaymentInput,
  ) => Promise<ConfirmPaymentOutcome>;
  /**
   * Post-CONFIRMED entitlement hook — composed by the caller as
   * getFulfillmentInput + dispatchFulfillment (durable claim/done).
   * Errors are collected, never swallowed: the payment is CONFIRMED
   * and reconciliation (222-5) finds missing fulfillment-done.
   */
  fulfill?: (paymentId: string) => Promise<void>;
  /** caip2 → chain client (Arc-only v1; absent ⇒ network skipped). */
  chainFor: (caip2: string) => ArcChainClient | undefined;
  /** caip2 → configured treasury recipient (server config only). */
  treasuryFor: (caip2: string) => string | undefined;
  newId?: (prefix: string) => string;
  nowMs?: () => number;
  lookbackBlocks?: bigint;
  /**
   * 222-4: how far back terminal attempts stay in the match feed —
   * a late/duplicate tx against a recently-consumed attempt must
   * surface as an exception, not NONE. Default 1h.
   */
  recentTerminalMs?: number;
  logger?: UsdcMonitorLogger;
}

export interface UsdcMonitorTickResult {
  payableAttempts: number;
  networksScanned: number;
  transfersSeen: number;
  confirmed: number;
  pending: number;
  flagged: number;
  rejected: number;
  skipped: number;
  errors: { stage: string; message: string }[];
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e);
}

export async function runUsdcMonitorTick(
  deps: UsdcMonitorDeps,
): Promise<UsdcMonitorTickResult> {
  const atMs = deps.nowMs?.() ?? Date.now();
  const lookback = deps.lookbackBlocks ?? 4096n;
  const result: UsdcMonitorTickResult = {
    payableAttempts: 0,
    networksScanned: 0,
    transfersSeen: 0,
    confirmed: 0,
    pending: 0,
    flagged: 0,
    rejected: 0,
    skipped: 0,
    errors: [],
  };

  const listPayable = deps.stores.attempts.listPayable?.bind(
    deps.stores.attempts,
  );
  if (!listPayable) {
    result.errors.push({
      stage: "feed",
      message: "attempts store has no listPayable — monitor cannot run",
    });
    return result;
  }
  const feed = await listPayable(atMs);
  const payable = feed.filter(
    (a) =>
      a.provider === "DIRECT_USDC" &&
      a.network != null &&
      (a.status === "PENDING" || a.status === "PROCESSING"),
  );
  result.payableAttempts = payable.length;

  // 222-4: recently-terminal feed — late/duplicate transfers on
  // consumed attempts surface as exceptions instead of NONE.
  const recentWindowMs = deps.recentTerminalMs ?? 3_600_000;
  const listRecent = deps.stores.attempts.listRecentTerminal?.bind(
    deps.stores.attempts,
  );
  const recentTerminal = listRecent
    ? (await listRecent(atMs - recentWindowMs)).filter(
        (a) =>
          a.provider === "DIRECT_USDC" && a.network != null,
      )
    : [];
  const payableIds = new Set(payable.map((a) => a.id));
  const terminalExtras = recentTerminal.filter(
    (a) => !payableIds.has(a.id),
  );
  if (payable.length === 0 && terminalExtras.length === 0) {
    return result;
  }

  const byNetwork = new Map<string, PersistedAttempt[]>();
  for (const a of [...payable, ...terminalExtras]) {
    const key = a.network ?? "";
    const group = byNetwork.get(key) ?? [];
    group.push(a);
    byNetwork.set(key, group);
  }

  for (const [caip2, group] of byNetwork) {
    const net = getPaymentNetwork(caip2);
    const chain = deps.chainFor(caip2);
    const treasury = deps.treasuryFor(caip2);
    const asset = net?.assets.find((a) => a.symbol === "USDC");
    if (!net || !chain || !treasury || !asset) {
      result.skipped += group.length;
      result.errors.push({
        stage: `network:${caip2}`,
        message: "no chain client / registry entry / treasury / asset",
      });
      continue;
    }
    try {
      const head = await chain.getHead();
      const fromBlock = head > lookback ? head - lookback : 0n;
      const transfers = await chain.scanTransfers({
        fromBlock,
        toBlock: head,
        treasury,
      });
      result.networksScanned++;
      result.transfersSeen += transfers.length;

      const expectations = group.map((a) => toExpectation(a, net, asset));
      const attemptsById = new Map(group.map((a) => [a.id, a]));

      for (const t of transfers) {
        try {
          const tx = await chain.txEvidence({
            txHash: t.txHash,
            tokenContract: asset.contractAddress,
            from: t.from,
            to: t.to,
            amountUnits: t.amountUnits,
            blockNumber: t.blockNumber,
          });
          const match = matchTransfer(tx, expectations, { network: net });
          if (match.status === "EXACT" && match.expectation) {
            const attempt = attemptsById.get(match.expectation.attemptId);
            if (attempt) {
              await driveExactMatch(
                deps,
                attempt,
                tx,
                match.expectation,
                net,
                asset,
                result,
                atMs,
              );
            }
          } else if (
            match.status === "FUZZY" ||
            match.status === "AMBIGUOUS"
          ) {
            result.flagged += await flagMatch(
              deps,
              match.status,
              match.candidates,
              attemptsById,
              tx,
              atMs,
            );
          }
          // NONE — unrelated treasury income, owned by 222-5.
        } catch (e) {
          result.errors.push({
            stage: `tx:${t.txHash}`,
            message: errMsg(e),
          });
        }
      }
    } catch (e) {
      // RPC down / transient — attempts stay payable for the next tick.
      result.errors.push({ stage: `network:${caip2}`, message: errMsg(e) });
    }
  }

  return result;
}
