/**
 * SLICE-199-13 (EPIC-199, D-199-7): ChainTxOutbox dispatcher — the
 * missing ops-signer leg. Every board mutation enqueues an outbox row;
 * this worker drains `listPendingOutbox` FIFO and ships the chain leg:
 *
 *   kind          role        ref-contract calls
 *   createJob     client      createJob(provider=0x0) → decode jobId
 *   setProvider   client+prov setProvider → setPayoutReceiver →
 *                             setBudget → approve+fund
 *   fund          client+prov setBudget → approve+fund
 *   submit        client+prov bind+fund composite (idempotent) → submit
 *   complete      evaluator   complete(jobId, reasonHash)
 *   reject        evaluator   reject(jobId, reasonHash)
 *   claimRefund   client      claimRefund(jobId)
 *   giveFeedback  client      reputationRegistry.giveFeedback
 *
 * "Ops-signed" model: provider_ onchain = the SERVER provider EOA (it
 * signs setBudget/setPayoutReceiver/submit), the agent's payoutWallet
 * is bound via setPayoutReceiver — escrow pays the agent, agent never
 * sends a tx. Contract requires client != provider != evaluator.
 *
 * Idempotency vs chain state (D-199-7 reconciler duty): each row
 * pre-flights getJob and composes only the MISSING legs — a resend
 * after crash between broadcast and patch is a no-op on the already-
 * executed legs. Handlers live in ./dispatch-handlers.
 *
 * Single-replica v1: sequential drain via a `running` flag + the
 * route-level `board:idem` cache lock. Multi-replica needs ops:nonce
 * (decisions.md D-199-7 note).
 */
import type { Hex } from "viem";

import type { VenueNetwork } from "../venue/chain";
import { resolveVenueNetwork } from "../venue/chain";
import type { VenueRole } from "../venue/lifecycle-sign";
import type { PreparedTx } from "../venue/lifecycle";

import { boardStore, type BoardStoreBackend } from "./store";
import type { ChainTxOutboxRecord } from "./types";
import { isRefVenue, type RefJob } from "./erc8183-ref";
import {
  handleBindOrFund,
  handleClaimRefund,
  handleCreateJob,
  handleGiveFeedback,
  handleReviewTx,
  handleSubmit,
  type LegResult,
} from "./dispatch-handlers";

const MAX_ATTEMPTS = 8;
const ERR_REF_ONLY = "dispatcher only supports the ref ERC-8183 deploy";

export interface DispatchDeps {
  now?: () => number;
  network?: VenueNetwork;
  store?: BoardStoreBackend;
  /** Injectable sender for tests — default sendAsRole. */
  sendTxs?: (
    role: VenueRole,
    txs: PreparedTx[],
    net: VenueNetwork,
  ) => Promise<Hex[] | null>;
  readJob?: (jobId: bigint, net: VenueNetwork) => Promise<RefJob | null>;
  decodeJobId?: (txHash: Hex, net: VenueNetwork) => Promise<bigint | null>;
  /** Older-than gate for pending selection (default 0 = all pending). */
  olderThanMs?: number;
  log?: (msg: string) => void;
}

export interface DrainResult {
  processed: number;
  confirmed: number;
  failed: number;
  skipped: number;
  errors: string[];
}

function failRow(
  st: BoardStoreBackend,
  row: ChainTxOutboxRecord,
  err: string,
): void {
  const attempts = row.attempts + 1;
  st.patchOutbox(row.id, {
    attempts,
    lastError: err.slice(0, 400),
    ...(attempts >= MAX_ATTEMPTS ? { status: "failed" } : {}),
  });
}

function confirmRow(
  st: BoardStoreBackend,
  row: ChainTxOutboxRecord,
  txHash: string,
): void {
  st.patchOutbox(row.id, {
    status: "confirmed",
    txHash,
    attempts: row.attempts + 1,
  });
}

/**
 * One drain pass over pending outbox rows. Called by the interval
 * service and directly by tests. Rows stay `pending` on send failure
 * (retry next tick) until MAX_ATTEMPTS → `failed`.
 */
export async function drainBoardOutbox(
  deps: DispatchDeps = {},
): Promise<DrainResult> {
  const st = deps.store ?? boardStore();
  const net = deps.network ?? resolveVenueNetwork();
  const res: DrainResult = {
    processed: 0,
    confirmed: 0,
    failed: 0,
    skipped: 0,
    errors: [],
  };
  if (!isRefVenue(net)) {
    res.errors.push(ERR_REF_ONLY);
    return res;
  }

  // listPendingOutbox takes an epoch-ms cutoff (createdAt < cutoff) —
  // convert the older-than delay so the default drains all pending rows.
  const rows = st.listPendingOutbox(Date.now() - (deps.olderThanMs ?? 0));
  for (const row of rows) {
    res.processed++;
    const ctx = { ...deps, store: st, network: net };
    try {
      let leg: LegResult;
      switch (row.kind) {
        case "createJob":
          leg = await handleCreateJob(ctx, st, net, row);
          break;
        case "setProvider":
        case "fund":
          leg = await handleBindOrFund(ctx, st, net, row);
          break;
        case "submit":
          leg = await handleSubmit(ctx, st, net, row);
          break;
        case "complete":
        case "reject":
          leg = await handleReviewTx(ctx, st, net, row);
          break;
        case "claimRefund":
          leg = await handleClaimRefund(ctx, st, net, row);
          break;
        case "giveFeedback":
          leg = await handleGiveFeedback(ctx, st, net, row);
          break;
        default:
          res.skipped++;
          continue;
      }
      if (leg.err) {
        failRow(st, row, leg.err);
        res.failed++;
        res.errors.push(`${row.id} ${row.kind}: ${leg.err}`);
        continue;
      }
      if (leg.noop) {
        // Chain state already past this leg (crash-reconcile path) —
        // mark confirmed with the existing or sentinel hash.
        confirmRow(st, row, row.txHash ?? "0x0");
      } else if (leg.hash) {
        confirmRow(st, row, leg.hash);
      }
      res.confirmed++;
      // Journal audit — the read route joins outbox txHash onto
      // entries, so no entry write needed here.
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      failRow(st, row, msg);
      res.failed++;
      res.errors.push(`${row.id} ${row.kind}: ${msg}`);
    }
  }
  return res;
}

// ─── interval service ────────────────────────────────────────────

let _timer: ReturnType<typeof setInterval> | null = null;
let _running = false;

/**
 * Env-gated worker (D-199-7). Default on when the ref deploy is
 * configured; disable with BOARD_DISPATCHER_ENABLED=0. Interval via
 * BOARD_DISPATCHER_INTERVAL_MS (default 5s — Arc finality is sub-second
 * but receipts take a beat).
 */
export function startBoardOutboxDispatcher(): void {
  if (process.env.BOARD_DISPATCHER_ENABLED === "0") return;
  if (!process.env.ERC8183_REF_ADDRESS) return;
  if (_timer) return;
  const intervalMs = Number(process.env.BOARD_DISPATCHER_INTERVAL_MS ?? 5000);
  _timer = setInterval(() => {
    if (_running) return;
    _running = true;
    drainBoardOutbox()
      .then((r) => {
        if (r.errors.length) {
          console.warn("[board-dispatch]", r.errors.join(" | "));
        }
      })
      .catch((e) => console.error("[board-dispatch] drain error", e))
      .finally(() => {
        _running = false;
      });
  }, intervalMs);
  if (typeof _timer.unref === "function") _timer.unref();
}
