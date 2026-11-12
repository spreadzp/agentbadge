/**
 * USDC reconciliation — core tick (SLICE-222-5, D-222-5).
 *
 * Periodic diff of three SoTs per configured Arc network:
 *   attempt expectations ↔ chain Transfer evidence ↔ receipts.
 * Every mismatch becomes a PaymentException (kind
 * RECONCILIATION_MISMATCH) with a deterministic id — repeated runs
 * never duplicate. Detect+record ONLY: no auto-remediation, no
 * fulfillment re-trigger (Review-6.2: on-chain effect without
 * receipt surfaces as exception for manual/queued completion).
 *
 * Scan window is incremental: resumes from a persisted per-network
 * cursor (last reconciled block) instead of re-scanning history.
 */
import {
  getPaymentNetwork,
  reconcileTransfers,
  type ArcChainClient,
  type ChainTxEvidence,
  type PaymentServiceStores,
  type ReconAttempt,
  type ReconciliationMismatchKind,
} from "@agentbadge/payments";
import { toExpectation } from "./usdc-monitor-drive";

export interface ReconciliationCursorStore {
  get(caip2: string): Promise<bigint | null>;
  set(caip2: string, block: bigint): Promise<void>;
}

export interface UsdcReconciliationDeps {
  stores: PaymentServiceStores;
  /** caip2 → chain client (monitor's client cache is reusable). */
  chainFor: (caip2: string) => ArcChainClient | undefined;
  /** Configured DIRECT_USDC networks to reconcile. */
  networks: readonly string[];
  /** caip2 → configured treasury recipient (server config only). */
  treasuryFor: (caip2: string) => string | undefined;
  /** Per-network last-reconciled-block persistence (optional —
   *  absent → every run scans the lookback fallback window). */
  cursorStore?: ReconciliationCursorStore;
  newId?: (prefix: string) => string;
  nowMs?: () => number;
  /** First-run scan depth when no cursor exists (default 4096). */
  lookbackBlocks?: bigint;
  /** Terminal-attempt feed horizon — CONFIRMED rows reconcile only
   *  inside this window (default 24h). */
  recentTerminalMs?: number;
  logger?: {
    info: (msg: string, ctx?: Record<string, unknown>) => void;
    warn: (msg: string, ctx?: Record<string, unknown>) => void;
    error: (msg: string, ctx?: Record<string, unknown>) => void;
  };
}

export interface UsdcReconciliationResult {
  networksScanned: number;
  transfersSeen: number;
  mismatches: Record<string, number>;
  exceptionsWritten: number;
  errors: { stage: string; message: string }[];
}

const SEVERITY: Record<ReconciliationMismatchKind, "WARN" | "CRITICAL"> = {
  CHAIN_TX_WITHOUT_ATTEMPT: "WARN",
  CONFIRMED_WITHOUT_RECEIPT: "CRITICAL",
  RECEIPT_WITHOUT_CHAIN_TX: "CRITICAL",
  AMOUNT_DRIFT: "CRITICAL",
  RECIPIENT_DRIFT: "CRITICAL",
};

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message.slice(0, 300) : String(e);
}

/** DecodedTransfer → ChainTxEvidence for the diff (finality not
 *  needed — recon compares facts, not thresholds). The scanned
 *  contract is implicit in the scan call → passed explicitly. */
function toEvidence(
  tx: {
    txHash: string;
    blockNumber: bigint;
    from: string;
    to: string;
    amountUnits: bigint;
  },
  tokenContract: string,
  network: string,
): ChainTxEvidence {
  return { ...tx, tokenContract, network, confirmations: 0 };
}

export async function runReconciliationTick(
  deps: UsdcReconciliationDeps,
): Promise<UsdcReconciliationResult> {
  const atMs = deps.nowMs?.() ?? Date.now();
  const lookback = deps.lookbackBlocks ?? 4096n;
  const recentMs = deps.recentTerminalMs ?? 24 * 3_600_000;
  const result: UsdcReconciliationResult = {
    networksScanned: 0,
    transfersSeen: 0,
    mismatches: {},
    exceptionsWritten: 0,
    errors: [],
  };
  const { attempts, receipts } = deps.stores;
  if (!attempts.listPayable || !attempts.listRecentTerminal) {
    result.errors.push({
      stage: "feed",
      message:
        "attempts store lacks listPayable/listRecentTerminal — recon cannot run",
    });
    return result;
  }

  for (const caip2 of deps.networks) {
    const net = getPaymentNetwork(caip2);
    const chain = deps.chainFor(caip2);
    const treasury = deps.treasuryFor(caip2);
    const asset = net?.assets.find((a) => a.symbol === "USDC");
    if (!net || !chain || !treasury || !asset) {
      result.errors.push({
        stage: `network:${caip2}`,
        message: "no chain client / registry entry / treasury / asset",
      });
      continue;
    }
    try {
      const head = await chain.getHead();
      const cursor = (await deps.cursorStore?.get(caip2)) ?? null;
      const fromBlock =
        cursor !== null
          ? cursor + 1n
          : head - lookback + 1n > 0n
            ? head - lookback + 1n
            : 0n;
      if (fromBlock > head) continue; // nothing new
      const transfers = await chain.scanTransfers({
        fromBlock,
        toBlock: head,
        treasury,
      });
      result.networksScanned++;
      result.transfersSeen += transfers.length;

      // Attempt snapshot: open + recently-terminal on this network.
      const open = await attempts.listPayable(atMs);
      const terminal = await attempts.listRecentTerminal(
        atMs - recentMs,
      );
      const seen = new Set<string>();
      const recon: ReconAttempt[] = [];
      for (const a of [...open, ...terminal]) {
        if (
          a.provider !== "DIRECT_USDC" ||
          a.network !== caip2 ||
          seen.has(a.id)
        ) {
          continue;
        }
        seen.add(a.id);
        recon.push({
          id: a.id,
          paymentId: a.paymentId,
          status: a.status,
          transactionHash: a.transactionHash,
          expectation: toExpectation(a, net, asset),
        });
      }

      // Receipts for every involved payment.
      const paymentIds = [...new Set(recon.map((r) => r.paymentId))];
      const receiptRows = (
        await Promise.all(
          paymentIds.map((p) => receipts.listByPayment(p)),
        )
      ).flat();

      const evidence = transfers.map((t) =>
        toEvidence(t, asset.contractAddress, caip2),
      );
      const mismatches = reconcileTransfers({
        attempts: recon,
        transfers: evidence,
        receipts: receiptRows,
      });

      const exceptions = deps.stores.exceptions;
      for (const m of mismatches) {
        result.mismatches[m.kind] =
          (result.mismatches[m.kind] ?? 0) + 1;
        if (!exceptions) continue;
        const appended = await exceptions.append({
          id: `exc-recon-${m.kind}-${m.key}`,
          paymentId: m.paymentId,
          attemptId: m.attemptId,
          kind: "RECONCILIATION_MISMATCH",
          severity: SEVERITY[m.kind],
          details: {
            mismatchKind: m.kind,
            reason: m.reason,
            txHash: m.txHash ?? null,
            network: caip2,
            ...m.details,
          },
          status: "OPEN",
          createdAtMs: atMs,
        });
        if (appended) result.exceptionsWritten++;
      }

      // Cursor advances only after a fully successful network pass.
      await deps.cursorStore?.set(caip2, head);
    } catch (e) {
      result.errors.push({
        stage: `network:${caip2}`,
        message: errMsg(e),
      });
      deps.logger?.warn("usdc-recon: network pass failed", {
        network: caip2,
        error: errMsg(e),
      });
    }
  }

  deps.logger?.info("usdc-recon: tick done", {
    networks: result.networksScanned,
    transfers: result.transfersSeen,
    mismatches: result.mismatches,
    exceptions: result.exceptionsWritten,
  });
  return result;
}
