/**
 * SLICE-207-3: backfill — scan historical records → canonical events.
 *
 * Safe to re-run: every event's idempotency key is deterministic
 * (`ev:{source}:{sourceId}:{seq}`), so a second run yields
 * duplicate:true for all rows — zero new entries.
 *
 * Sources:
 *  - board: all cards → journal entries (per-card seq preserved)
 *  - venue: all jobs (status→seq ordinals)
 *  - market: all cached tasks (current status → committed kinds)
 *  - eaas: all stored verdicts
 *  - x402: SpendEvent rows with kind="x402" (txHash → pay legs)
 *
 * Gate: requires Postgres (econLedgerOrNull) — in-memory mode = no-op.
 */

import {
  rebuildTrustEdges,
  type Database,
  type EconLedgerStore,
} from "@agentbadge/database";
import type { BuildEventInput } from "@agentbadge/econ-events";
import { logger } from "@agentbadge/passport/logger";
import { emitEconomicBatch } from "./emit.js";
import { boardEntryToEconomic } from "./board.js";
import { marketStatusToEconomic } from "./market.js";
import { venueJobToEconomic } from "./venue.js";
import { verdictToEconomic } from "./eaas.js";
import { settleToEconomic } from "./x402.js";

export interface BackfillReport {
  board: { scanned: number; appended: number; duplicate: number; dropped: number };
  venue: { scanned: number; appended: number; duplicate: number; dropped: number };
  market: { scanned: number; appended: number; duplicate: number; dropped: number };
  eaas: { scanned: number; appended: number; duplicate: number; dropped: number };
  x402: { scanned: number; appended: number; duplicate: number; dropped: number };
}

const EMPTY = { scanned: 0, appended: 0, duplicate: 0, dropped: 0 };

export async function runEconBackfill(
  database: Database,
): Promise<BackfillReport> {
  const ledger = database.econLedger as EconLedgerStore;
  const report: BackfillReport = {
    board: { ...EMPTY },
    venue: { ...EMPTY },
    market: { ...EMPTY },
    eaas: { ...EMPTY },
    x402: { ...EMPTY },
  };

  // ── board journal ────────────────────────────────────────────────
  try {
    const { boardStore } = await import("../board/store.js");
    const st = boardStore();
    const cards = st.listCards();
    const inputs: (BuildEventInput | null)[] = [];
    for (const card of cards) {
      for (const e of st.listEntries(card.cardId)) {
        inputs.push(boardEntryToEconomic(e));
      }
    }
    report.board = { scanned: inputs.length, ...(await emitEconomicBatch(inputs, ledger)) };
  } catch (err) {
    logger.warn("econ-backfill: board scan failed", { error: String(err) });
  }

  // ── venue jobs ───────────────────────────────────────────────────
  try {
    const { listJobs } = await import("../venue/store.js");
    const jobs = listJobs();
    const inputs = jobs.flatMap((j) => venueJobToEconomic(j));
    report.venue = { scanned: jobs.length, ...(await emitEconomicBatch(inputs, ledger)) };
  } catch (err) {
    logger.warn("econ-backfill: venue scan failed", { error: String(err) });
  }

  // ── market tasks (current status → committed events) ─────────────
  try {
    const { listTasks } = await import("@agentbadge/passport");
    const tasks = listTasks({ limit: 100_000 }) as unknown as Array<{
      taskId: string;
      status: string;
      posterDid: string;
      claimerDid?: string;
      priceHbar?: number;
      resultIpfs?: string;
      claimTxId?: string;
      deliverTxId?: string;
      paymentTxId?: string;
      completedTxId?: string;
    }>;
    const inputs: BuildEventInput[] = [];
    for (const t of tasks) {
      // Current status implies the earlier legs happened — emit them in
      // order. Completed additionally yields the escrow pay leg (seq 5).
      const legs =
        t.status === "claimed"
          ? ["claimed"]
          : t.status === "delivered"
            ? ["claimed", "delivered"]
            : t.status === "completed"
              ? ["claimed", "delivered", "completed"]
              : t.status === "cancelled"
                ? ["cancelled"]
                : []; // posted/expired/etc → nothing to project
      for (const s of legs) {
        inputs.push(...marketStatusToEconomic(s, t));
      }
    }
    report.market = { scanned: tasks.length, ...(await emitEconomicBatch(inputs, ledger)) };
  } catch (err) {
    logger.warn("econ-backfill: market scan failed", { error: String(err) });
  }

  // ── eaas verdicts ────────────────────────────────────────────────
  try {
    const repo = database.eaasVerdicts;
    if (repo) {
      const rows = await repo.list();
      const inputs = rows.map((r) =>
        verdictToEconomic(r.payload as never),
      );
      report.eaas = { scanned: rows.length, ...(await emitEconomicBatch(inputs, ledger)) };
    }
  } catch (err) {
    logger.warn("econ-backfill: eaas scan failed", { error: String(err) });
  }

  // ── x402 settles (SpendEvent kind="x402") ────────────────────────
  try {
    if (database.db) {
      const rows = await database.db.orm.public.SpendEvent
        .where({ kind: "x402" })
        .all();
      const inputs = rows.map((r) =>
        settleToEconomic({
          payer: r.wallet as string,
          payTo: (r.payload as Record<string, unknown>)["payTo"] as string,
          amountAtomic: BigInt(
            Math.round(Number(r.amountUsd) * 1e6),
          ),
          tx: (r.txHash as string | null) ?? undefined,
          network:
            ((r.payload as Record<string, unknown>)["network"] as string) ??
            "arc",
          scheme: "x402",
        }),
      );
      report.x402 = { scanned: rows.length, ...(await emitEconomicBatch(inputs, ledger)) };
    }
  } catch (err) {
    logger.warn("econ-backfill: x402 scan failed", { error: String(err) });
  }

  // SLICE-207-4: after any ledger backfill, fold the log into the
  // AgentTrustEdge table — covers events emitted before 207-4 existed.
  try {
    const edgeRep = await rebuildTrustEdges(ledger, database.trustEdges);
    logger.info("econ-backfill: trust edges rebuilt", {
      scanned: edgeRep.scanned,
      written: edgeRep.written,
    });
  } catch (err) {
    logger.warn("econ-backfill: edge rebuild failed", { error: String(err) });
  }

  logger.info("econ-backfill done", report as unknown as Record<string, unknown>);
  return report;
}
