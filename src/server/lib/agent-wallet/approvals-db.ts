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

type RepoRow = Awaited<ReturnType<SpendApprovalRepository["get"]>>;

/**
 * 257-4 repo surface — published @agentbadge/database@0.6.19 predates
 * these ops (contract.prisma + repo updated in-source; bump the pin
 * when it ships). Declared optional and gated on runtime presence of
 * findPendingByFingerprint: single-process correctness lives in the
 * mirror regardless; the repo ops are the multi-process backstop.
 */
interface SpendApprovalRepo257 extends SpendApprovalRepository {
  findPendingByFingerprint(
    wallet: string,
    dealFingerprint: string,
  ): Promise<RepoRow>;
  consume(
    id: string,
    consumedAtMs: number,
    payload?: RepoPayload,
    expectedFingerprint?: string,
  ): Promise<boolean>;
}

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
  const repo257 = repo as SpendApprovalRepo257;
  const map = new Map<string, SpendApproval>();

  const wb = new DbWriteBehind("agent-wallet.approvals", async () => {
    const rows = await repo.listAll(HYDRATE_LIMIT);
    for (const r of rows) map.set(r.id, toApproval(r));
  });

  return {
    name: "db",
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    async park(input: ApprovalParkInput) {
      const now = Date.now();
      // D-257-Q6 find-or-create — the mirror is authoritative in-process
      // (sync scan+set); the PG partial unique constraint is only a
      // backstop for a multi-process race. A write-behind conflict is
      // reconcile-logged, never a silent drop (ROUND-3 §3).
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
      const a: SpendApproval = {
        id: `ap_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`,
        wallet: input.wallet,
        amountUsd: input.amountUsd,
        kind: input.kind,
        refId: input.refId,
        state: "pending",
        createdAt: now,
        expiresAt: input.expiresAt,
        ...(input.approvalReason
          ? { approvalReason: input.approvalReason }
          : {}),
        ...(input.dealFingerprint
          ? { dealFingerprint: input.dealFingerprint }
          : {}),
        ...(input.fingerprintVersion
          ? { fingerprintVersion: input.fingerprintVersion }
          : {}),
        ...(input.meta ? { meta: input.meta } : {}),
      };
      map.set(a.id, a);
      wb.enqueue(() =>
        repo
          .put(toRow(a))
          .then(() => undefined)
          .catch(async (err) => {
            if (!isUniqueConflict(err) || !a.dealFingerprint) throw err;
            // The partial unique constraint fired — find the conflicting
            // pending and reconcile the mirror to PG truth; never a
            // silent drop (ROUND-3 §3). findPendingByFingerprint may be
            // absent on the published repo — then we can only log + drop
            // the phantom (a constraint that can't fire pre-migration).
            const winner =
              (await repo257
                .findPendingByFingerprint?.(a.wallet, a.dealFingerprint)
                .catch(() => null)) ?? null;
            if (winner && winner.expiresAtMs <= BigInt(Date.now())) {
              // Dead-but-unswept pending still trips the constraint —
              // expire it, then our row lands on retry.
              const dead = expiredView(toApproval(winner), Date.now());
              await repo
                .expire(winner.id, dead as unknown as RepoPayload)
                .catch(() => false);
              const ok = await repo
                .put(toRow(a))
                .then(() => true)
                .catch(() => false);
              logger.error("approval park reconcile: dead row expired", {
                approvalId: a.id,
                dealFingerprint: a.dealFingerprint,
                deadId: winner.id,
                retried: ok,
              });
              if (!ok) map.delete(a.id);
              return;
            }
            // A live winner (or an unresolvable conflict) — the mirror's
            // record is a phantom; converge to PG truth.
            map.delete(a.id);
            if (winner) map.set(winner.id, toApproval(winner));
            logger.error("approval park reconcile: unique conflict", {
              approvalId: a.id,
              dealFingerprint: a.dealFingerprint,
              winnerId: winner?.id ?? null,
            });
          }),
      );
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
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      };
      map.set(id, next);
      wb.enqueue(() =>
        repo
          .decide(
            id,
            next.state === "approved" ? "approved" : "rejected",
            actor,
            now,
            expiresAt,
            next as unknown as RepoPayload,
          )
          .then(() => undefined),
      );
      return true;
    },
    async consume(id, expectedFingerprint) {
      const a = map.get(id);
      // approved never expires — single-use transition only; fingerprint
      // mismatch refuses WITHOUT consuming (D-257-Q6, mirrored in the
      // repo's conditional WHERE).
      if (!a || a.state !== "approved") return false;
      if (!fingerprintMatches(a, expectedFingerprint)) return false;
      const next: SpendApproval = {
        ...a,
        state: "consumed",
        consumedAt: Date.now(),
      };
      map.set(id, next);
      // Published repo lacks the 4th consume arg — the mirror fp-check
      // above is authoritative in-process; the WHERE pin is extra
      // multi-process defense forwarded only when the op exists.
      const fpAware = typeof repo257.findPendingByFingerprint === "function";
      wb.enqueue(() =>
        (fpAware
          ? repo257.consume(
              id,
              next.consumedAt!,
              next as unknown as RepoPayload,
              expectedFingerprint,
            )
          : repo.consume(id, next.consumedAt!, next as unknown as RepoPayload)
        ).then(() => undefined),
      );
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
