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
 * SLICE-257-4 (EPIC-257, D-257-Q6/Q9): counterparty-holds carry a
 * dealFingerprint binding the permit to ONE deal — park() is atomic
 * find-or-create by (wallet, dealFingerprint, pending) on every
 * backend (ROUND-3 §3), and consume(id, expectedFingerprint) refuses
 * a fingerprint mismatch. C1: consume is NOT payment idempotency —
 * uncertain money movement is never retried through it.
 *
 * Backends: json (.data/agent-approvals.json) + sqlite via bun:sqlite
 * (null under node/vitest → json fallback), memory for tests, "db"
 * (Postgres, 176-11) — same contract as SpendLedger.
 *
 * Queue cap: park() throws when pending count for the wallet reaches
 * maxPending (AGENT_WALLET_MAX_PENDING_APPROVALS, default 20) — the
 * error message is the wire code `approval_queue_full`.
 */

import type { SpendKind } from "./ledger";

// Backends live beside this file; re-exported so approvals.ts stays
// the single import surface (300-line guard).
export { createSqliteApprovalStore } from "./approvals-sqlite";
export {
  createJsonApprovalStore,
  createMemoryApprovalStore,
} from "./approvals-memory";
export { createApprovalStore } from "./approvals-factory";
export type { ApprovalStoreBackend } from "./approvals-factory";

/* --------------------------------- types ---------------------------------- */

export type ApprovalState =
  | "pending"
  | "approved"
  | "rejected"
  | "expired"
  | "consumed";

/**
 * Why a parked intent exists — a separate field, NOT part of the
 * closed SpendKind union (D-257-Q6). Values mirror the
 * @agentbadge/circle-payments ApprovalReason contract (257-1); the
 * server consumes the published package, so the union is re-declared
 * here — keep it verbatim.
 */
export type ApprovalReason =
  | "amount_threshold"
  | "counterparty_warn"
  | "counterparty_unmeasured";

/**
 * Owner-UI-safe check details (D-257-Q6) — verdict/codes/diff/age/
 * checkedAt only; never request bodies, secrets or raw URLs.
 */
export interface ApprovalMeta {
  /** vet402 wire verdict, when the hold came from a counterparty check. */
  verdict?: string;
  /** vet402 + our reason codes. */
  reasonCodes?: readonly string[];
  /** Per-field normalized diff when the terms check produced one. */
  termsDiff?: Record<string, { verified: string; offered: string }>;
  /** vet402 evidence age, seconds. */
  evidenceAgeSeconds?: number;
  /** ISO-8601 when the check ran. */
  checkedAt?: string;
}

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
  /** Why it was parked (amount cap vs counterparty WARN/unmeasured). */
  approvalReason?: ApprovalReason;
  /** `sha256:v1:<hex>` binding the permit to one deal (257-1). */
  dealFingerprint?: string;
  /** Fingerprint format version — always 1 today. */
  fingerprintVersion?: 1;
  /** Owner-UI-safe check details. */
  meta?: ApprovalMeta;
}

export interface ApprovalParkInput {
  wallet: `0x${string}`;
  amountUsd: number;
  kind: SpendKind;
  refId: string;
  /** Absolute expiry epoch ms — enforcer computes from approval TTL. */
  expiresAt: number;
  approvalReason?: ApprovalReason;
  /**
   * When set, park() is atomic find-or-create over
   * (wallet, dealFingerprint, pending): a concurrent/repeated park of
   * the same deal returns the EXISTING live pending — never a
   * duplicate, never an error (D-257-Q6).
   */
  dealFingerprint?: string;
  fingerprintVersion?: 1;
  meta?: ApprovalMeta;
}

export interface ApprovalStore {
  name: "json" | "sqlite" | "memory" | "db";
  /**
   * Park a new pending intent; throws "approval_queue_full" over cap.
   * With dealFingerprint: atomic find-or-create — an existing LIVE
   * pending for the same deal is returned as-is.
   */
  park(input: ApprovalParkInput): Promise<SpendApproval>;
  /** Lazy expiry applied: overdue pending reads as expired. */
  get(id: string): Promise<SpendApproval | null>;
  /** Newest first; state filter is post-lazy-expiry. */
  listByWallet(wallet: string, state?: ApprovalState): Promise<SpendApproval[]>;
  /** pending → approved|rejected; false on terminal/unknown/expired. expiresAt 
   * (optional) refreshes the permit window on approve (176-9). */
  decide(
    id: string,
    action: "approve" | "reject",
    actor: string,
    expiresAt?: number,
  ): Promise<boolean>;
  /**
   * Atomic approved→consumed; false when already terminal/pending.
   * With expectedFingerprint the transition only fires when the
   * record's dealFingerprint matches — a mismatched or missing
   * fingerprint returns false WITHOUT consuming (D-257-Q6: the owner
   * approved THIS deal, not "some payment to this wallet").
   */
  consume(id: string, expectedFingerprint?: string): Promise<boolean>;
  /** Live pending only (expired-but-unswept excluded). */
  countPending(wallet: string): Promise<number>;
  /** Bulk pending→expired for the sweeper; returns newly expired. */
  expireOverdue(now?: number): Promise<SpendApproval[]>;
}

/** Approval ids: `ap_<hex>` — local correlation only. */
export function newApprovalId(): string {
  return `ap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/** Parked-intent TTL (APPROVAL_TTL_MS, default 1h per D-176-2) —
 *  silence = denial: overdue pending is not decidable/consumable. */
export const DEFAULT_APPROVAL_TTL_MS = 3_600_000;

export const isOverdue = (a: SpendApproval, now: number) =>
  a.state === "pending" && a.expiresAt <= now;

/* ------------------------------- shared views ----------------------------- */

/** Lazy expiry is VIEW-ONLY on reads — an overdue pending reads as
 *  "expired" but is not persisted there; expireOverdue() (sweeper) is
 *  the sole persisting actor, which is what lets it emit exactly one
 *  approval.expired alert per record. */
export const expiredView = (a: SpendApproval, now: number): SpendApproval =>
  isOverdue(a, now) ? { ...a, state: "expired" } : a;

/** D-257-Q6 dedup scan — a LIVE pending for the same deal wins over
 *  creating a second record; an expired-but-unswept one never does. */
export const findLivePendingByFingerprint = (
  approvals: Iterable<SpendApproval>,
  wallet: string,
  dealFingerprint: string,
  now: number,
): SpendApproval | undefined => {
  const w = wallet.toLowerCase();
  for (const a of approvals) {
    if (
      a.state === "pending" &&
      a.expiresAt > now &&
      a.wallet.toLowerCase() === w &&
      a.dealFingerprint === dealFingerprint
    ) {
      return a;
    }
  }
  return undefined;
};

/** Fingerprint guard for consume — undefined expected = legacy
 *  unconditional single-use transition. */
export const fingerprintMatches = (
  a: SpendApproval,
  expected: string | undefined,
): boolean => expected === undefined || a.dealFingerprint === expected;

/** Defined-only spread for optional record fields — undefined keys are
 *  never stored, so JSON/sqlite rows stay sparse. */
const opt = <T extends object>(v: T | false | "" | 0 | null | undefined) =>
  v ? v : {};

/** Shared pending-record constructor — every backend's park() builds the
 *  same shape with the same defined-only optional fields. */
export const pendingFromParkInput = (
  inp: ApprovalParkInput,
  now: number,
): SpendApproval => ({
  id: newApprovalId(),
  wallet: inp.wallet,
  amountUsd: inp.amountUsd,
  kind: inp.kind,
  refId: inp.refId,
  state: "pending",
  createdAt: now,
  expiresAt: inp.expiresAt,
  ...opt(inp.approvalReason && { approvalReason: inp.approvalReason }),
  ...opt(inp.dealFingerprint && { dealFingerprint: inp.dealFingerprint }),
  ...opt(
    inp.fingerprintVersion && { fingerprintVersion: inp.fingerprintVersion },
  ),
  ...opt(inp.meta && { meta: inp.meta }),
});

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
