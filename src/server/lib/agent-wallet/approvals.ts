/**
 * SLICE-176-6: SpendApproval store — durable parked payment intents
 * for the owner-approval flow (176-7 hold-path, 176-9 approve API).
 *
 * Gate-state, NOT ledger (D-176-7): an approval record holds an intent
 * frozen by the enforcer until the wallet owner decides. State machine:
 *
 *   pending → approved → consumed
 *   pending → rejected
 *   pending → expired   (lazy on read + 60s sweeper → approval.expired)
 *
 * Terminal: rejected | expired | consumed. `consume` is atomic
 * approved→consumed (single-use permit); a second consume returns
 * false — sqlite enforces it with UPDATE ... WHERE state='approved'.
 *
 * Backends: json (.data/agent-approvals.json) + sqlite via bun:sqlite
 * (null under node/vitest → json fallback), memory for tests. "db"
 * (Postgres) is wired in 176-11 — same contract as SpendLedger.
 *
 * Queue cap: park() throws when pending count for the wallet reaches
 * maxPending (AGENT_WALLET_MAX_PENDING_APPROVALS, default 20) — the
 * error message is the wire code `approval_queue_full`.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SpendKind } from "./ledger";
import { createSqliteApprovalStore } from "./approvals-sqlite";

// bun:sqlite backend lives in approvals-sqlite (300-line guard) —
// re-exported so approvals.ts stays the single import surface.
export { createSqliteApprovalStore } from "./approvals-sqlite";

/* --------------------------------- types ---------------------------------- */

export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "consumed";

export interface SpendApproval {
  id: string;
  wallet: `0x${string}`;
  amountUsd: number;
  kind: SpendKind;
  /** Caller correlation (jobId/verdictId) — same as SpendEntry.refId. */
  refId: string;
  state: ApprovalState;
  createdAt: number;
  expiresAt: number;
  decidedBy?: string;
  decidedAt?: number;
  consumedAt?: number;
}

export interface ApprovalParkInput {
  wallet: `0x${string}`;
  amountUsd: number;
  kind: SpendKind;
  refId: string;
  /** Absolute expiry epoch ms — enforcer computes from approval TTL. */
  expiresAt: number;
}

export interface ApprovalStore {
  name: "json" | "sqlite" | "memory" | "db";
  /** Park a new pending intent; throws "approval_queue_full" over cap. */
  park(input: ApprovalParkInput): Promise<SpendApproval>;
  /** Lazy expiry applied: overdue pending reads as expired. */
  get(id: string): Promise<SpendApproval | null>;
  /** Newest first; state filter is post-lazy-expiry. */
  listByWallet(wallet: string, state?: ApprovalState): Promise<SpendApproval[]>;
  /** pending → approved|rejected; false on terminal/unknown/expired. */
  decide(id: string, action: "approve" | "reject", actor: string): Promise<boolean>;
  /** Atomic approved→consumed; false when already terminal/pending. */
  consume(id: string): Promise<boolean>;
  /** Live pending only (expired-but-unswept excluded). */
  countPending(wallet: string): Promise<number>;
  /** Bulk pending→expired for the sweeper; returns newly expired. */
  expireOverdue(now?: number): Promise<SpendApproval[]>;
}

/** Approval ids: `ap_<hex>` — local correlation only. */
export function newApprovalId(): string {
  return `ap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

const isOverdue = (a: SpendApproval, now: number) =>
  a.state === "pending" && a.expiresAt <= now;

/* ------------------------------- memory/json ------------------------------ */

/** Lazy expiry is VIEW-ONLY on reads — an overdue pending reads as
 *  "expired" but is not persisted there; expireOverdue() (sweeper) is
 *  the sole persisting actor, which is what lets it emit exactly one
 *  approval.expired alert per record. */
const expiredView = (a: SpendApproval, now: number): SpendApproval =>
  isOverdue(a, now) ? { ...a, state: "expired" } : a;

function memoryLikeStore(
  name: "memory" | "json",
  path: string | null,
  maxPending: number,
): ApprovalStore {
  const map = new Map<string, SpendApproval>();
  const load = (): Map<string, SpendApproval> => {
    if (name === "memory") return map;
    if (path && existsSync(path)) {
      try {
        const raw = JSON.parse(readFileSync(path, "utf8")) as {
          entries?: Record<string, SpendApproval>;
        };
        for (const [id, a] of Object.entries(raw.entries ?? {})) {
          map.set(id, a);
        }
      } catch {
        /* corrupt file → empty */
      }
    }
    return map;
  };
  const save = (): void => {
    if (name === "memory" || !path) return;
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({ entries: Object.fromEntries(map) }),
    );
  };
  const livePending = (wallet: string, now: number): number => {
    const w = wallet.toLowerCase();
    return [...map.values()].filter(
      (a) =>
        a.state === "pending" &&
        a.expiresAt > now &&
        a.wallet.toLowerCase() === w,
    ).length;
  };

  return {
    name,
    async park(inp) {
      load();
      const now = Date.now();
      if (livePending(inp.wallet, now) >= maxPending) {
        throw new Error("approval_queue_full");
      }
      const rec: SpendApproval = {
        id: newApprovalId(),
        wallet: inp.wallet,
        amountUsd: inp.amountUsd,
        kind: inp.kind,
        refId: inp.refId,
        state: "pending",
        createdAt: now,
        expiresAt: inp.expiresAt,
      };
      map.set(rec.id, rec);
      save();
      return rec;
    },
    async get(id) {
      load();
      const a = map.get(id);
      return a ? expiredView(a, Date.now()) : null;
    },
    async listByWallet(wallet, state) {
      load();
      const now = Date.now();
      const w = wallet.toLowerCase();
      return [...map.values()]
        .map((a) => expiredView(a, now))
        .filter(
          (a) => a.wallet.toLowerCase() === w && (!state || a.state === state),
        )
        .sort((x, y) => y.createdAt - x.createdAt);
    },
    async decide(id, action, actor) {
      load();
      const now = Date.now();
      const a = map.get(id);
      // pending AND live (overdue-pending reads expired → not decidable)
      if (!a || a.state !== "pending" || a.expiresAt <= now) return false;
      map.set(id, {
        ...a,
        state: action === "approve" ? "approved" : "rejected",
        decidedBy: actor,
        decidedAt: now,
      });
      save();
      return true;
    },
    async consume(id) {
      load();
      const a = map.get(id);
      // approved never expires — single-use transition only
      if (!a || a.state !== "approved") return false;
      map.set(id, { ...a, state: "consumed", consumedAt: Date.now() });
      save();
      return true;
    },
    async countPending(wallet) {
      load();
      return livePending(wallet, Date.now());
    },
    async expireOverdue(now = Date.now()) {
      load();
      const out: SpendApproval[] = [];
      for (const a of map.values()) {
        if (!isOverdue(a, now)) continue;
        const next = { ...a, state: "expired" as const };
        map.set(a.id, next);
        out.push(next);
      }
      if (out.length) save();
      return out;
    },
  };
}

export function createMemoryApprovalStore(
  maxPending = 20,
): ApprovalStore {
  return memoryLikeStore("memory", null, maxPending);
}

export function createJsonApprovalStore(
  path = join(process.cwd(), ".data", "agent-approvals.json"),
  maxPending = 20,
): ApprovalStore {
  return memoryLikeStore("json", path, maxPending);
}

/* -------------------------------- factory --------------------------------- */

export type ApprovalStoreBackend = "json" | "sqlite" | "memory" | "auto";

/**
 *  - "auto"/"sqlite" → bun:sqlite under Bun, json fallback under
 *    node/vitest. "db" lands in 176-11 (Postgres repo + wiring branch).
 */
export function createApprovalStore(
  backend: ApprovalStoreBackend = "auto",
  path?: string,
  maxPending = 20,
): ApprovalStore {
  if (backend === "memory") return createMemoryApprovalStore(maxPending);
  if (backend === "sqlite" || backend === "auto") {
    return (
      createSqliteApprovalStore(path, maxPending) ??
      createJsonApprovalStore(
        (path ?? "").replace(/\.db$/, ".json") || undefined,
        maxPending,
      )
    );
  }
  return createJsonApprovalStore(path, maxPending);
}

/* -------------------------------- sweeper --------------------------------- */

/** Process-wide store singleton — wiring installs it; enforcer (176-7)
 *  and the approvals API (176-9) read it via getApprovalStore(). */
let storeSingleton: ApprovalStore | null = null;

export function initApprovalStore(store: ApprovalStore | null): void {
  storeSingleton = store;
}

export function getApprovalStore(): ApprovalStore | null {
  return storeSingleton;
}

// TTL sweeper lives in approvals-sweeper.ts (300-line guard) —
// re-exported so approvals.ts stays the single import surface.
export {
  sweepExpiredApprovals,
  startApprovalSweeper,
  stopApprovalSweeper,
} from "./approvals-sweeper";
