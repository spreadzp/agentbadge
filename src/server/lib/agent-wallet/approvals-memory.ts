/**
 * memory/json ApprovalStore backends — split from approvals.ts
 * (300-line guard) when SLICE-257-4 added fingerprint fields.
 *
 * Dedup note (ROUND-3 §3): find-or-create over
 * (wallet, dealFingerprint, pending) is a synchronous map scan+set —
 * atomic in-process. Single-process guarantee only: the json file
 * itself carries no lock, two processes sharing it would still race.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import {
  expiredView,
  findLivePendingByFingerprint,
  fingerprintMatches,
  newApprovalId,
  type ApprovalStore,
  type SpendApproval,
} from "./approvals";

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
      // D-257-Q6 find-or-create: same deal → same pending record.
      if (inp.dealFingerprint) {
        const existing = findLivePendingByFingerprint(
          map.values(),
          inp.wallet,
          inp.dealFingerprint,
          now,
        );
        if (existing) return existing;
      }
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
        ...(inp.approvalReason ? { approvalReason: inp.approvalReason } : {}),
        ...(inp.dealFingerprint
          ? { dealFingerprint: inp.dealFingerprint }
          : {}),
        ...(inp.fingerprintVersion
          ? { fingerprintVersion: inp.fingerprintVersion }
          : {}),
        ...(inp.meta ? { meta: inp.meta } : {}),
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
    async decide(id, action, actor, expiresAt) {
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
        ...(expiresAt !== undefined ? { expiresAt } : {}),
      });
      save();
      return true;
    },
    async consume(id, expectedFingerprint) {
      load();
      const a = map.get(id);
      // approved never expires — single-use transition only
      if (!a || a.state !== "approved") return false;
      if (!fingerprintMatches(a, expectedFingerprint)) return false;
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
        if (a.state === "pending" && a.expiresAt <= now) {
          const next = { ...a, state: "expired" as const };
          map.set(a.id, next);
          out.push(next);
        }
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
