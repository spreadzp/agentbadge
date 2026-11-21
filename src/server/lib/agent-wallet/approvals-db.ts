// SLICE-176-11: Postgres-backed ApprovalStore — mirror + write-behind.
// Mirrors createJson/memory semantics exactly: lazy expiry on reads
// (overdue pending reports expired without a write), newest-first lists,
// pending-queue cap on park. Writes update the mirror synchronously and
// enqueue a serialized repo op (conditional WHERE-on-state → atomic at
// PG level, SpendLedger precedent). Hydration restores parked intents
// and decide outcomes across restarts — the D-176-8 durability point.

import type { SpendApprovalRepository } from "@agentbadge/database";

import { logger } from "@agentbadge/passport/logger";

import { DbWriteBehind } from "../db-mirror";
import {
  APPROVED_PERMIT_TTL_MS,
  expiredView,
  findLivePendingByFingerprint,
  fingerprintMatches,
  type ApprovalParkInput,
  type ApprovalState,
  type ApprovalStore,
  type SpendApproval,
} from "./approvals";

/** Repo payload column type (JsonValue) — avoids importing codec-types. */
type RepoPayload = Parameters<SpendApprovalRepository["put"]>[0]["payload"];

const HYDRATE_LIMIT = 2_000;

export interface DbApprovalStore extends ApprovalStore {
  ready(): Promise<void>;
  flush(): Promise<void>;
}

const toRow = (a: SpendApproval) => ({
  id: a.id,
  wallet: a.wallet,
  venueId: null,
  amountUsd: a.amountUsd,
  kind: a.kind,
  refId: a.refId,
  state: a.state,
  decidedBy: a.decidedBy ?? null,
  decidedAtMs: a.decidedAt ?? null,
  consumedAtMs: a.consumedAt ?? null,
  expiresAtMs: a.expiresAt,
  createdAtMs: a.createdAt,
  dealFingerprint: a.dealFingerprint ?? null,
  payload: a as unknown as RepoPayload,
});

const toApproval = (row: { payload: unknown }): SpendApproval => {
  const p = row.payload;
  return (typeof p === "string" ? JSON.parse(p) : p) as SpendApproval;
};

/** PG partial unique constraint error (23505) — the only dedup backstop
 *  a mirror write can hit. */
const isUniqueConflict = (err: unknown): boolean =>
  /23505|unique/i.test(String(err));

/** Postgres approval store — null when repo absent (DATABASE_ENABLED off). */
export function createDbApprovalStore(
  repo: SpendApprovalRepository | null | undefined,
  maxPending = 20,
): DbApprovalStore | null {
  if (!repo) return null;
  const map = new Map<string, SpendApproval>();

  const wb = new DbWriteBehind("agent-wallet.approvals", async () => {
    const rows = await repo.listAll(HYDRATE_LIMIT);
    for (const r of rows) map.set(r.id, toApproval(r));
  });

  const buildPending = (
    input: ApprovalParkInput,
    now: number,
  ): SpendApproval => ({
    id: `ap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
    wallet: input.wallet,
    amountUsd: input.amountUsd,
    kind: input.kind,
    refId: input.refId,
    state: "pending",
    createdAt: now,
    expiresAt: input.expiresAt,
    ...(input.approvalReason ? { approvalReason: input.approvalReason } : {}),
    ...(input.dealFingerprint
      ? { dealFingerprint: input.dealFingerprint }
      : {}),
    ...(input.fingerprintVersion
      ? { fingerprintVersion: input.fingerprintVersion }
      : {}),
    ...(input.meta ? { meta: input.meta } : {}),
  });

  /**
   * M-8 fp-bound park lands SYNCHRONOUSLY — a returned id always exists
   * in PG. A 23505 on the partial unique index resolves right here:
   * live winner → return it; dead winner → expire + retry once.
   */
  const parkFpBound = async (
    a: SpendApproval,
    fp: string,
  ): Promise<SpendApproval> => {
    try {
      await repo.put(toRow(a));
      map.set(a.id, a);
      return a;
    } catch (err) {
      if (!isUniqueConflict(err)) throw err;
    }
    const winner = await repo
      .findPendingByFingerprint(a.wallet, fp)
      .catch(() => null);
    if (winner && winner.expiresAtMs <= BigInt(Date.now())) {
      // Dead-but-unswept pending still trips the constraint — expire it,
      // then our row lands on the retry.
      const dead = expiredView(toApproval(winner), Date.now());
      await repo
        .expire(winner.id, dead as unknown as RepoPayload)
        .catch(() => false);
      await repo.put(toRow(a));
      map.set(a.id, a);
      return a;
    }
    if (winner) {
      const w = toApproval(winner);
      map.set(w.id, w);
      return w;
    }
    throw new Error("approval_park_conflict");
  };

  return {
    name: "db",
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    async park(input: ApprovalParkInput) {
      const now = Date.now();
      // M-8: hydration must finish before the dedup scan — an unhydrated
      // mirror misses live pendings parked by other replicas.
      await wb.ready();
      if (input.dealFingerprint) {
        const hit = findLivePendingByFingerprint(
          map.values(),
          input.wallet,
          input.dealFingerprint,
          now,
        );
        if (hit) return hit;
      }
      const live = [...map.values()].filter(
        (a) =>
          a.wallet.toLowerCase() === input.wallet.toLowerCase() &&
          a.state === "pending" &&
          a.expiresAt > now,
      ).length;
      if (live >= maxPending) throw new Error("approval_queue_full");
      const a = buildPending(input, now);
      // fp-bound → sync put (the returned id is real); fp-less has no
      // unique constraint to trip — write-behind stays.
      if (input.dealFingerprint) return parkFpBound(a, input.dealFingerprint);
      map.set(a.id, a);
      wb.enqueue(() => repo.put(toRow(a)).then(() => undefined));
      return a;
    },
    async get(id) {
      const a = map.get(id);
      return a ? expiredView(a, Date.now()) : null;
    },
    async listByWallet(wallet, state?: ApprovalState) {
      const now = Date.now();
      const w = wallet.toLowerCase();
      return [...map.values()]
        .map((a) => expiredView(a, now))
        .filter(
          (a) =>
            a.wallet.toLowerCase() === w && (!state || a.state === state),
        )
        .sort((x, y) => y.createdAt - x.createdAt);
    },
    async decide(id, action, actor, expiresAt) {
      const now = Date.now();
      const a = map.get(id);
      // Mirror decides synchronously; the repo op is a conditional
      // UPDATE so a stale/racing write cannot resurrect a terminal row.
      if (!a || a.state !== "pending" || a.expiresAt <= now) return false;
      const next: SpendApproval = {
        ...a,
        state: action === "approve" ? "approved" : "rejected",
        decidedBy: actor,
        decidedAt: now,
        ...(action === "approve"
          ? { expiresAt: expiresAt ?? now + APPROVED_PERMIT_TTL_MS }
          : expiresAt !== undefined
            ? { expiresAt }
            : {}),
      };
      map.set(id, next);
      wb.enqueue(() =>
        repo
          .decide(
            id,
            next.state === "approved" ? "approved" : "rejected",
            actor,
            now,
            // resolved permit window (approve defaults to
            // APPROVED_PERMIT_TTL_MS), not the raw optional arg.
            next.expiresAt,
            next as unknown as RepoPayload,
          )
          .then(() => undefined),
      );
      return true;
    },
    async consume(id, expectedFingerprint) {
      // H-7: hydration + pending writes must land before the atomic
      // UPDATE — an unflushed decide leaves the repo row 'pending' and
      // the conditional WHERE would refuse a legitimately approved
      // permit.
      await wb.ready();
      await wb.flush();
      const a = map.get(id);
      // 257-14 (H-3): approved permits expire — consume refuses a
      // stale permit; fingerprint mismatch refuses WITHOUT consuming
      // (D-257-Q6, mirrored in the repo's conditional WHERE).
      if (!a || a.state !== "approved" || a.expiresAt <= Date.now())
        return false;
      if (!fingerprintMatches(a, expectedFingerprint)) return false;
      const consumedAt = Date.now();
      const next: SpendApproval = { ...a, state: "consumed", consumedAt };
      // H-7: the repo conditional UPDATE (id AND state='approved' AND
      // dealFingerprint=?) is the single cross-replica arbiter — two
      // processes both holding 'approved' mirrors yield exactly one
      // true. No mirror-first flip: a crash between mirror set and a
      // write-behind flush would leave a replayable approved permit.
      let ok: boolean;
      try {
        ok = await repo.consume(
          id,
          consumedAt,
          next as unknown as RepoPayload,
          expectedFingerprint,
        );
      } catch (err) {
        // Unknown outcome — fail closed (no spend); a landed consume
        // self-heals on the next attempt via the reconcile below.
        logger.error("approval consume repo call failed", {
          approvalId: id,
          err: String(err),
        });
        return false;
      }
      if (!ok) {
        // Repo refused — converge the mirror to PG truth (consumed or
        // expired elsewhere, or a phantom mirror record).
        const row = await repo.get(id).catch(() => null);
        if (row) map.set(id, toApproval(row));
        else map.delete(id);
        return false;
      }
      map.set(id, next);
      return true;
    },
    async countPending(wallet) {
      const now = Date.now();
      const w = wallet.toLowerCase();
      return [...map.values()].filter(
        (a) =>
          a.wallet.toLowerCase() === w &&
          a.state === "pending" &&
          a.expiresAt > now,
      ).length;
    },
    async expireOverdue(now = Date.now()) {
      const expired: SpendApproval[] = [];
      for (const a of map.values()) {
        if (a.state !== "pending" || a.expiresAt > now) continue;
        const next: SpendApproval = { ...a, state: "expired" };
        map.set(a.id, next);
        expired.push(next);
        wb.enqueue(() =>
          repo
            .expire(a.id, next as unknown as RepoPayload)
            .then(() => undefined),
        );
      }
      return expired;
    },
  };
}
