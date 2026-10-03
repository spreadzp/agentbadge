// SLICE-156-3: settle attribution — cross-chain payment state machine.
//
// Gateway settle is async for money: authorize ok ≠ USDC at the seller.
// Finality is observable via `statusLookup(transferId)` (UUID → Gateway
// /x402/transfers). This module keeps a CrosschainPayment record per
// settled-or-settling call and a background poller that walks entries
// to terminal (settled | failed | expired).
//
// Semantics split (spec):
//   - business access (pack, subscription) → granted on `authorized`/
//     `settling` — we risk a small amount for UX;
//   - money metrics ("USDC arrived", venue stats byChain) → `settled`
//     only. Callers read `state`, never assume.
//
// In-memory store (failure ledger pattern) — persistence can come later
// with the database epic (143); records are observational, not billing.

import type { PaymentInfo, PaymentStatusLookup } from "@agentbadge/circle-payments";

export type CrosschainPaymentState =
  | "authorized"
  | "settling"
  | "settled"
  | "expired"
  | "failed";

export interface CrosschainPayment {
  id: string;
  payer: `0x${string}`;
  /** CAIP-2 source network (eip155:84532 Base Sepolia, …) */
  sourceChain: string;
  /** Rail used — "gateway-batch"/"exact"/arc self-settle scheme name */
  scheme: string;
  /** Human USD amount ("5.00") — atomic units arrive as string from middleware */
  amountUsd: string;
  payTo: `0x${string}`;
  /** Business correlation — route-side object this payment unlocks */
  ref: { kind: "venue-job" | "eaas" | "subscription" | "pack" | "x402"; id: string };
  state: CrosschainPaymentState;
  /** Terminal on-chain tx (Arc) once the batch lands */
  settleTx?: string;
  /** Gateway transfer UUID — the /x402/transfers lookup key */
  transferId?: string;
  authorizedAt: number;
  settledAt?: number;
  expiresAt?: number;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/;
const TERMINAL = new Set<CrosschainPaymentState>([
  "settled",
  "expired",
  "failed",
]);
const STORE_CAP = 1_000;

export interface CrosschainPaymentsStore {
  put(entry: CrosschainPayment): void;
  get(id: string): CrosschainPayment | undefined;
  /** Patch entry in place (state transitions, settleTx). */
  update(id: string, patch: Partial<CrosschainPayment>): boolean;
  /** Non-terminal entries — poller's working set. */
  pending(): CrosschainPayment[];
  list(): CrosschainPayment[];
}

export function createCrosschainPaymentsStore(): CrosschainPaymentsStore {
  const map = new Map<string, CrosschainPayment>();
  return {
    put(entry) {
      map.set(entry.id, entry);
      // FIFO eviction past cap — observational data, oldest first.
      if (map.size > STORE_CAP) {
        const oldest = map.keys().next().value;
        if (oldest) map.delete(oldest);
      }
    },
    get: (id) => map.get(id),
    update(id, patch) {
      const e = map.get(id);
      if (!e) return false;
      map.set(id, { ...e, ...patch });
      return true;
    },
    pending: () => [...map.values()].filter((e) => !TERMINAL.has(e.state)),
    list: () => [...map.values()],
  };
}

function atomicToUsd(amount: string): string {
  const n = Number(amount) / 1e6;
  return Number.isFinite(n) ? n.toFixed(2) : amount;
}

/** Route path → business ref kind (mirrors x402-hooks kindFor). */
function refKindFor(path: string): CrosschainPayment["ref"]["kind"] {
  if (path.startsWith("/api/eaas/")) return "eaas";
  if (path.endsWith("/subscribe")) return "subscription";
  if (path.includes("scan-packs") || path.includes("/packs")) return "pack";
  return "x402";
}

/**
 * Record a settled-call result as a CrosschainPayment.
 *
 * `payment.transaction` for the gateway rail is the transfer UUID when
 * the facilitator settles async, or an on-chain hash when it returns a
 * final tx — branch by shape. Exact/arc rails always get a tx hash and
 * land directly in `settled`.
 */
export function recordPayment(
  store: CrosschainPaymentsStore,
  payment: PaymentInfo,
  path: string,
  payTo: `0x${string}`,
  expiryGraceMs: number,
): CrosschainPayment {
  const tx = payment.transaction;
  const isUuid = !!tx && UUID_RE.test(tx);
  const isHash = !!tx && TX_HASH_RE.test(tx);
  const now = Date.now();
  const entry: CrosschainPayment = {
    id: tx ?? `pmt_${crypto.randomUUID()}`,
    payer: (payment.payer ?? "0x0") as `0x${string}`,
    sourceChain: payment.network,
    scheme: payment.scheme,
    amountUsd: atomicToUsd(payment.amount),
    payTo,
    ref: { kind: refKindFor(path), id: `${path}` },
    state:
      payment.scheme === "gateway-batch" && isUuid
        ? "settling"
        : isHash
          ? "settled"
          : "authorized",
    ...(isUuid ? { transferId: tx } : {}),
    ...(isHash ? { settleTx: tx } : {}),
    authorizedAt: now,
    ...(isHash ? { settledAt: now } : {}),
    // Gateway intents carry their own validity; we don't see it in
    // PaymentInfo — use a conservative grace window from authorize time.
    ...(isUuid ? { expiresAt: now + expiryGraceMs } : {}),
  };
  store.put(entry);
  return entry;
}

export interface SettlePollerDeps {
  store: CrosschainPaymentsStore;
  /** Existing runtime lookup — UUID → gateway transfer status. */
  statusLookup: PaymentStatusLookup;
  pollMs: number;
  /** Callback on terminal transitions (metrics, job hooks, alerts). */
  onTerminal?: (entry: CrosschainPayment) => void;
}

export interface SettlePoller {
  start(): void;
  stop(): void;
  /** One poll iteration — exposed for tests (no timer needed). */
  tick(): Promise<number>;
}

export function createSettlePoller(deps: SettlePollerDeps): SettlePoller {
  let timer: ReturnType<typeof setInterval> | undefined;
  let busy = false;

  async function tick(): Promise<number> {
    if (busy) return 0; // guard against overlapping ticks
    busy = true;
    let advanced = 0;
    try {
      const now = Date.now();
      for (const e of deps.store.pending()) {
        // Expiry: authorized/settling past grace → expired (no money, no metric)
        if (e.expiresAt !== undefined && now > e.expiresAt) {
          if (deps.store.update(e.id, { state: "expired" })) {
            advanced++;
            deps.onTerminal?.({ ...e, state: "expired" });
          }
          continue;
        }
        if (!e.transferId) continue;
        try {
          const st = await deps.statusLookup(e.transferId);
          if (st.status === "completed" || st.status === "confirmed") {
            deps.store.update(e.id, {
              state: "settled",
              settledAt: now,
              ...(TX_HASH_RE.test(st.ref) ? { settleTx: st.ref } : {}),
            });
            advanced++;
            deps.onTerminal?.({
              ...e,
              state: "settled",
              settledAt: now,
            });
          } else if (st.status === "failed") {
            deps.store.update(e.id, { state: "failed" });
            advanced++;
            deps.onTerminal?.({ ...e, state: "failed" });
          } else if (e.state === "authorized" && st.status === "pending") {
            deps.store.update(e.id, { state: "settling" });
          }
        } catch {
          // transient lookup failure — entry stays pending, retried next tick
        }
      }
      return advanced;
    } finally {
      busy = false;
    }
  }

  return {
    start() {
      if (timer) return;
      timer = setInterval(() => void tick(), deps.pollMs);
      timer.unref?.(); // never hold the process open for observability
    },
    stop() {
      if (timer) clearInterval(timer);
      timer = undefined;
    },
    tick,
  };
}
