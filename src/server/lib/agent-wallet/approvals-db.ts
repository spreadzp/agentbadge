// SLICE-176-11: Postgres-backed ApprovalStore — mirror + write-behind.
// Mirrors createJson/memory semantics exactly: lazy expiry on reads
// (overdue pending reports expired without a write), newest-first lists,
// pending-queue cap on park. Writes update the mirror synchronously and
// enqueue a serialized repo op (conditional WHERE-on-state → atomic at
// PG level, SpendLedger precedent). Hydration restores parked intents
// and decide outcomes across restarts — the D-176-8 durability point.

import type { SpendApprovalRepository } from "@agentbadge/database";

import { DbWriteBehind } from "../db-mirror";
import type {
  ApprovalParkInput,
  ApprovalState,
  ApprovalStore,
  SpendApproval,
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
  payload: a as unknown as RepoPayload,
});

const toApproval = (row: { payload: unknown }): SpendApproval => {
  const p = row.payload;
  return (typeof p === "string" ? JSON.parse(p) : p) as SpendApproval;
};

/** Lazy expiry — pending past expiresAt reads as expired (no write). */
const expiredView = (a: SpendApproval, now: number): SpendApproval =>
  a.state === "pending" && a.expiresAt <= now
    ? { ...a, state: "expired" }
    : a;

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

  return {
    name: "db",
    ready: () => wb.ready(),
    flush: () => wb.flush(),
    async park(input: ApprovalParkInput) {
      const now = Date.now();
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
      };
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
    async consume(id) {
      const a = map.get(id);
      // approved never expires — single-use transition only
      if (!a || a.state !== "approved") return false;
      const next: SpendApproval = {
        ...a,
        state: "consumed",
        consumedAt: Date.now(),
      };
      map.set(id, next);
      wb.enqueue(() =>
        repo
          .consume(id, next.consumedAt!, next as unknown as RepoPayload)
          .then(() => undefined),
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
