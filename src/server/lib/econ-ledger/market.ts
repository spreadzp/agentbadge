/**
 * SLICE-207-3: market lifecycle → canonical events.
 *
 * `transitionTask` lives in @agentbadge/passport (published) — so emits
 * hook the committed call sites in market-handlers-*. Fixed seq
 * ordinals keep idempotency keys stable across re-emits and backfill:
 *   claim→1  deliver→2  complete→3  cancel→4
 * (`posted` is not emitted in v1 — task publication is off-ledger.)
 */

import type { BuildEventInput } from "@agentbadge/econ-events";
import type { EconLedgerStore } from "@agentbadge/database";
import { emitEconomicEvent } from "./emit.js";

const HEX32 = /^0x[0-9a-fA-F]{64}$/;
const hexOrUndef = (v: unknown) =>
  typeof v === "string" && HEX32.test(v) ? v : undefined;

/** `did:hcs:…:0.0.X:1` → `0.0.X`; `did:eip155:84532:0x…` → `0x…`. */
function didToAddress(did: string): string {
  const parts = did.split(":");
  return parts.length >= 4 ? parts[parts.length - 2]! : did;
}

export const MARKET_SEQ = {
  claimed: 1,
  delivered: 2,
  completed: 3,
  cancelled: 4,
} as const;

/** Minimal task shape needed for mapping (subset of market-task fields). */
export interface MarketEventTask {
  taskId: string;
  posterDid: string;
  claimerDid?: string;
  priceHbar?: number;
  resultIpfs?: string;
  claimTxId?: string;
  deliverTxId?: string;
  paymentTxId?: string;
  completedTxId?: string;
}

/**
 * Pure mapper — committed market status → canonical inputs (null =
 * nothing to emit). Completed emits BOTH verify AND the escrow pay leg
 * when a payment tx exists.
 */
export function marketStatusToEconomic(
  status: string,
  task: MarketEventTask,
): BuildEventInput[] {
  const poster = didToAddress(task.posterDid);
  const claimer = task.claimerDid ? didToAddress(task.claimerDid) : undefined;
  const at = new Date().toISOString();
  const base = { source: "market", sourceId: task.taskId, at };
  switch (status) {
    case "claimed":
      if (!claimer) return [];
      return [
        {
          ...base,
          seq: MARKET_SEQ.claimed,
          kind: "work_accept",
          actor: claimer,
          counterparty: poster,
          payload: { offerRef: task.taskId },
        },
      ];
    case "delivered":
      if (!claimer) return [];
      // deliverableHash must be hex32 — IPFS CIDs don't qualify; carry
      // them via evidenceRefs instead and skip when nothing hex-shaped.
      return [
        {
          ...base,
          seq: MARKET_SEQ.delivered,
          kind: "deliver",
          actor: claimer,
          counterparty: poster,
          payload: {
            taskRef: task.taskId,
            deliverableHash:
              hexOrUndef(task.deliverTxId) ??
              "0x0000000000000000000000000000000000000000000000000000000000000000",
            evidenceRefs: task.resultIpfs ? [task.resultIpfs] : undefined,
          },
        },
      ];
    case "completed": {
      if (!claimer) return [];
      const out: BuildEventInput[] = [
        {
          ...base,
          seq: MARKET_SEQ.completed,
          kind: "verify",
          actor: poster,
          counterparty: claimer,
          payload: {
            taskRef: task.taskId,
            outcome: "pass",
            txHash: hexOrUndef(task.completedTxId),
          },
        },
      ];
      if (task.paymentTxId) {
        out.push({
          ...base,
          seq: 5, // pay leg — kept off the transition ordinals
          kind: "pay",
          actor: poster,
          counterparty: claimer,
          amountUsdc:
            typeof task.priceHbar === "number" ? String(task.priceHbar) : undefined,
          payload: {
            rail: "escrow",
            txHash: hexOrUndef(task.paymentTxId),
            asset: "HBAR",
          },
        });
      }
      return out;
    }
    case "cancelled":
      return [
        {
          ...base,
          seq: MARKET_SEQ.cancelled,
          kind: "work_offer",
          actor: poster,
          payload: { taskRef: task.taskId, terms: { cancelled: true } },
        },
      ];
    default:
      return [];
  }
}

/** Emit after a committed market transition — call sites pass the task. */
export function emitMarketStatus(
  status: string,
  task: MarketEventTask,
  ledger?: EconLedgerStore | null,
): void {
  for (const input of marketStatusToEconomic(status, task)) {
    emitEconomicEvent(input, ledger);
  }
}
