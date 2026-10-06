/**
 * SLICE-181-2: refund ledger for self-settled refusals (D-181-3).
 *
 * Arc self-settle ("eip3009-client-broadcast") payments land on-chain at
 * verify time, so an honest refusal can no longer withhold settlement —
 * the money must be returned. Every self-settled refusal is recorded as a
 * RefundRecord ("pending" | "sent" | "failed"); tryAutoRefund attempts the
 * treasury→payer USDC transfer only behind REFUND_AUTO_ENABLED.
 *
 * Pending records are the manual-ops queue — never silently dropped.
 * Storage follows the eval-store json pattern (.data/refunds.json).
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { logger } from "@agentbadge/passport";

export interface RefundRecord {
  id: string;
  payer: `0x${string}`;
  amountAtomic: string;
  /** The client's already-settled payment tx we are refunding. */
  paymentTx: string;
  /** Treasury → payer refund tx once sent. */
  refundTx?: string;
  status: "pending" | "sent" | "failed";
  reason: string;
  createdAt: string;
}

export interface RefundLog {
  get(id: string): RefundRecord | undefined;
  put(r: RefundRecord): void;
  list(): RefundRecord[];
}

export function createMemoryRefundLog(): RefundLog {
  const map = new Map<string, RefundRecord>();
  return {
    get: (id) => map.get(id),
    put: (r) => map.set(r.id, r),
    list: () => [...map.values()],
  };
}

export function createJsonRefundLog(file: string): RefundLog {
  const mem = createMemoryRefundLog();
  if (existsSync(file)) {
    try {
      for (const r of JSON.parse(readFileSync(file, "utf8")) as RefundRecord[]) {
        mem.put(r);
      }
    } catch {
      /* corrupt → start empty */
    }
  }
  const flush = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(mem.list(), null, 2));
  };
  return {
    get: (id) => mem.get(id),
    put: (r) => {
      mem.put(r);
      flush();
    },
    list: () => mem.list(),
  };
}

export interface RefundServiceDeps {
  log: RefundLog;
  /** REFUND_AUTO_ENABLED resolver — live read so tests/env flip it. */
  autoEnabled: () => boolean;
  /** Treasury → payer USDC transfer; absent = manual-refund mode. */
  send?: (rec: RefundRecord) => Promise<`0x${string}`>;
  now?: () => number;
}

export interface RefundService {
  recordRefund(r: Omit<RefundRecord, "id" | "status" | "createdAt">): RefundRecord;
  /**
   * Attempt the on-chain refund when REFUND_AUTO_ENABLED and a sender is
   * configured; resolves to the (possibly updated) record. Never throws —
   * failures land as status:"failed" for manual retry.
   */
  tryAutoRefund(rec: RefundRecord): Promise<RefundRecord>;
}

export function createRefundService(deps: RefundServiceDeps): RefundService {
  let seq = 0;
  return {
    recordRefund(r) {
      const rec: RefundRecord = {
        ...r,
        id: `rf_${Date.now().toString(36)}_${(seq++).toString(36)}`,
        status: "pending",
        createdAt: new Date(deps.now?.() ?? Date.now()).toISOString(),
      };
      deps.log.put(rec);
      logger.warn("refund recorded", {
        id: rec.id,
        payer: rec.payer,
        amountAtomic: rec.amountAtomic,
        paymentTx: rec.paymentTx,
        reason: rec.reason,
      });
      return rec;
    },

    async tryAutoRefund(rec) {
      if (!deps.autoEnabled() || !deps.send || rec.status === "sent") {
        return rec;
      }
      try {
        const refundTx = await deps.send(rec);
        const updated: RefundRecord = { ...rec, status: "sent", refundTx };
        deps.log.put(updated);
        return updated;
      } catch (e) {
        const updated: RefundRecord = { ...rec, status: "failed" };
        deps.log.put(updated);
        logger.error("auto-refund failed — manual retry needed", {
          id: rec.id,
          paymentTx: rec.paymentTx,
          err: e instanceof Error ? e.message : String(e),
        });
        return updated;
      }
    },
  };
}
