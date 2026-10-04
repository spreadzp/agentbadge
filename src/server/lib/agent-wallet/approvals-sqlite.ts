/**
 * SQLite backend for the ApprovalStore — split from approvals.ts
 * (300-line file limit). bun:sqlite is Bun-only: under node/vitest the
 * require throws → openBunSqlite returns null → caller falls back to json.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type {
  ApprovalState,
  ApprovalStore,
  SpendApproval,
} from "./approvals";
import { newApprovalId } from "./approvals";

type SqliteDatabase = InstanceType<typeof import("bun:sqlite").Database>;
const nodeRequire = createRequire(import.meta.url);

/** bun:sqlite is Bun-only — under node/vitest require throws → null. */
function openBunSqlite(path: string): SqliteDatabase | null {
  try {
    const mod = nodeRequire("bun:sqlite") as typeof import("bun:sqlite");
    mkdirSync(dirname(path), { recursive: true });
    const db = new mod.Database(path);
    db.run(`CREATE TABLE IF NOT EXISTS spend_approvals (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      amountUsd REAL NOT NULL,
      kind TEXT NOT NULL,
      refId TEXT NOT NULL,
      state TEXT NOT NULL,
      createdAt INTEGER NOT NULL,
      expiresAt INTEGER NOT NULL,
      decidedBy TEXT,
      decidedAt INTEGER,
      consumedAt INTEGER
    )`);
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_appr_wallet ON spend_approvals(wallet)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_appr_state ON spend_approvals(state)",
    );
    return db;
  } catch {
    return null;
  }
}

interface SqliteRow {
  id: string;
  wallet: string;
  amountUsd: number;
  kind: string;
  refId: string;
  state: string;
  createdAt: number;
  expiresAt: number;
  decidedBy: string | null;
  decidedAt: number | null;
  consumedAt: number | null;
}

function rowToApproval(r: SqliteRow): SpendApproval {
  return {
    id: r.id,
    wallet: r.wallet as `0x${string}`,
    amountUsd: r.amountUsd,
    kind: r.kind as SpendApproval["kind"],
    refId: r.refId,
    state: r.state as ApprovalState,
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    ...(r.decidedBy ? { decidedBy: r.decidedBy } : {}),
    ...(r.decidedAt ? { decidedAt: r.decidedAt } : {}),
    ...(r.consumedAt ? { consumedAt: r.consumedAt } : {}),
  };
}

/** View-only lazy expiry (same contract as memory/json): overdue
 *  pending reads as expired but is persisted only by expireOverdue —
 *  the sweeper stays the sole actor able to emit approval.expired. */
const expiredViewRow = (a: SpendApproval, now: number): SpendApproval =>
  a.state === "pending" && a.expiresAt <= now
    ? { ...a, state: "expired" }
    : a;

export function createSqliteApprovalStore(
  path = join(process.cwd(), ".data", "agent-approvals.db"),
  maxPending = 20,
): ApprovalStore | null {
  const db = openBunSqlite(path);
  if (!db) return null;

  /** Lazy expiry — flip overdue pending → expired, return the flipped ids. */
  const expireOverdueSql = (now: number): string[] => {
    const rows = db
      .query(
        "SELECT id FROM spend_approvals WHERE state = 'pending' AND expiresAt <= ?",
      )
      .all(now) as { id: string }[];
    if (rows.length) {
      db.run(
        "UPDATE spend_approvals SET state = 'expired' WHERE state = 'pending' AND expiresAt <= ?",
        [now],
      );
    }
    return rows.map((r) => r.id);
  };

  const selectById = (id: string): SqliteRow | null =>
    (db
      .query("SELECT * FROM spend_approvals WHERE id = ?")
      .get(id) as SqliteRow | null) ?? null;

  return {
    name: "sqlite",
    async park(inp) {
      const now = Date.now();
      // cap counts LIVE pending only — overdue ones are dead on arrival
      const pending = db
        .query(
          `SELECT COUNT(*) AS n FROM spend_approvals
           WHERE wallet = ? AND state = 'pending' AND expiresAt > ?`,
        )
        .get(inp.wallet, now) as { n: number };
      if (pending.n >= maxPending) throw new Error("approval_queue_full");
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
      db.run(
        `INSERT INTO spend_approvals
         (id, wallet, amountUsd, kind, refId, state, createdAt, expiresAt)
         VALUES (?, ?, ?, ?, ?, 'pending', ?, ?)`,
        [rec.id, rec.wallet, rec.amountUsd, rec.kind, rec.refId, now, rec.expiresAt],
      );
      return rec;
    },
    async get(id) {
      const row = selectById(id);
      return row ? expiredViewRow(rowToApproval(row), Date.now()) : null;
    },
    async listByWallet(wallet, state) {
      const now = Date.now();
      const rows = db
        .query(
          "SELECT * FROM spend_approvals WHERE wallet = ? ORDER BY createdAt DESC",
        )
        .all(wallet) as SqliteRow[];
      return rows
        .map((r) => expiredViewRow(rowToApproval(r), now))
        .filter((a) => !state || a.state === state);
    },
    async decide(id, action, actor) {
      const now = Date.now();
      // Atomic: pending AND not-expired → decided in one statement.
      const res = db.run(
        `UPDATE spend_approvals
         SET state = ?, decidedBy = ?, decidedAt = ?
         WHERE id = ? AND state = 'pending' AND expiresAt > ?`,
        [action === "approve" ? "approved" : "rejected", actor, now, id, now],
      );
      return res.changes > 0;
    },
    async consume(id) {
      const now = Date.now();
      // Atomic single-use: approved (and not lazily expired — approved
      // can't expire: expiry only applies to pending).
      const res = db.run(
        `UPDATE spend_approvals SET state = 'consumed', consumedAt = ?
         WHERE id = ? AND state = 'approved'`,
        [now, id],
      );
      return res.changes > 0;
    },
    async countPending(wallet) {
      const row = db
        .query(
          `SELECT COUNT(*) AS n FROM spend_approvals
           WHERE wallet = ? AND state = 'pending' AND expiresAt > ?`,
        )
        .get(wallet, Date.now()) as { n: number };
      return row.n;
    },
    async expireOverdue(now = Date.now()) {
      const ids = expireOverdueSql(now);
      return ids
        .map((id) => selectById(id))
        .filter((r): r is SqliteRow => !!r)
        .map(rowToApproval);
    },
  };
}
