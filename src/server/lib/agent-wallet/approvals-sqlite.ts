/**
 * SQLite backend for the ApprovalStore — split from approvals.ts
 * (300-line guard). bun:sqlite is Bun-only: under node/vitest require
 * throws → openBunSqlite null → caller falls back to json.
 *
 * SLICE-257-4 (D-257-Q6, ROUND-3 §3): fingerprint columns + partial
 * unique index (wallet, dealFingerprint) WHERE pending; park() is a
 * transactional find-or-create (SELECT live → INSERT OR IGNORE →
 * re-SELECT on conflict), never SELECT→INSERT.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type {
  ApprovalMeta,
  ApprovalReason,
  ApprovalStore,
  SpendApproval,
} from "./approvals";
import { APPROVED_PERMIT_TTL_MS, expiredView, pendingFromParkInput } from "./approvals";

type SqliteDatabase = InstanceType<typeof import("bun:sqlite").Database>;
const nodeRequire = createRequire(import.meta.url);

/** Columns added by 257-4 — ALTER path for DBs created before it. */
const V257_COLS: ReadonlyArray<[string, string]> = [
  ["approvalReason", "TEXT"],
  ["dealFingerprint", "TEXT"],
  ["fingerprintVersion", "INTEGER"],
  ["meta", "TEXT"],
];

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
      consumedAt INTEGER,
      approvalReason TEXT,
      dealFingerprint TEXT,
      fingerprintVersion INTEGER,
      meta TEXT
    )`);
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_appr_wallet ON spend_approvals(wallet)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_appr_state ON spend_approvals(state)",
    );
    // 257-4: at most ONE pending per (wallet, dealFingerprint) — the
    // dedup backstop inside the park txn; NULL fps (pre-257 amount
    // holds) never conflict (SQL NULL ≠ NULL).
    db.run(
      `CREATE UNIQUE INDEX IF NOT EXISTS ux_appr_wallet_fp_pending
       ON spend_approvals(wallet, dealFingerprint)
       WHERE state = 'pending' AND dealFingerprint IS NOT NULL`,
    );
    // Upgrade path for pre-257 DBs (no IF NOT EXISTS for columns —
    // probe the pragma instead).
    const cols = new Set(
      (db.query("PRAGMA table_info(spend_approvals)").all() as {
        name: string;
      }[]).map((c) => c.name),
    );
    for (const [col, type] of V257_COLS) {
      if (!cols.has(col)) {
        db.run(`ALTER TABLE spend_approvals ADD COLUMN ${col} ${type}`);
      }
    }
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
  approvalReason: string | null;
  dealFingerprint: string | null;
  fingerprintVersion: number | null;
  meta: string | null;
}

const opt = <T>(v: T | false | null | undefined) => (v ? v : {});

function rowToApproval(r: SqliteRow): SpendApproval {
  return {
    id: r.id,
    wallet: r.wallet as `0x${string}`,
    amountUsd: r.amountUsd,
    kind: r.kind as SpendApproval["kind"],
    refId: r.refId,
    state: r.state as SpendApproval["state"],
    createdAt: r.createdAt,
    expiresAt: r.expiresAt,
    ...opt(r.decidedBy && { decidedBy: r.decidedBy }),
    ...opt(r.decidedAt && { decidedAt: r.decidedAt }),
    ...opt(r.consumedAt && { consumedAt: r.consumedAt }),
    ...opt(r.approvalReason && {
      approvalReason: r.approvalReason as ApprovalReason,
    }),
    ...opt(r.dealFingerprint && { dealFingerprint: r.dealFingerprint }),
    ...opt(r.fingerprintVersion && {
      fingerprintVersion: r.fingerprintVersion as 1,
    }),
    ...opt(r.meta && { meta: JSON.parse(r.meta) as ApprovalMeta }),
  };
}

const LIVE_PENDING = "state = 'pending' AND expiresAt > ?";
const LIVE_PENDING_WALLET = `${LIVE_PENDING} AND wallet = ? COLLATE NOCASE`;

export function createSqliteApprovalStore(
  path = join(process.cwd(), ".data", "agent-approvals.db"),
  maxPending = 20,
): ApprovalStore | null {
  const db = openBunSqlite(path);
  if (!db) return null;

  const selectById = (id: string): SqliteRow | null =>
    (db
      .query("SELECT * FROM spend_approvals WHERE id = ?")
      .get(id) as SqliteRow | null) ?? null;

  const livePendingByFingerprint = (
    wallet: string,
    fp: string,
    now: number,
  ): SqliteRow | null =>
    (db
      .query(
        `SELECT * FROM spend_approvals
         WHERE ${LIVE_PENDING_WALLET} AND dealFingerprint = ?`,
      )
      .get(now, wallet, fp) as SqliteRow | null) ?? null;

  const livePendingCount = (wallet: string, now: number): number =>
    (
      db
        .query(
          `SELECT COUNT(*) AS n FROM spend_approvals WHERE ${LIVE_PENDING_WALLET}`,
        )
        .get(now, wallet) as { n: number }
    ).n;

  const INSERT_SQL = `INSERT OR IGNORE INTO spend_approvals
    (id, wallet, amountUsd, kind, refId, state, createdAt, expiresAt,
     approvalReason, dealFingerprint, fingerprintVersion, meta)
    VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?, ?, ?)`;

  const insertArgs = (r: SpendApproval) => [
    r.id, r.wallet, r.amountUsd, r.kind, r.refId, r.createdAt, r.expiresAt,
    r.approvalReason ?? null,
    r.dealFingerprint ?? null,
    r.fingerprintVersion ?? null,
    r.meta ? JSON.stringify(r.meta) : null,
  ];

  return {
    name: "sqlite",
    async park(inp) {
      const now = Date.now();
      // D-257-Q6 find-or-create in ONE transaction — never SELECT→INSERT.
      return db.transaction((): SpendApproval => {
        if (inp.dealFingerprint) {
          // A dead pending for this deal still trips the partial unique
          // index — flip it inside the txn (event cost: sweeper skips
          // approval.expired for this row; documented trade-off).
          db.run(
            `UPDATE spend_approvals SET state = 'expired'
             WHERE ${LIVE_PENDING.replace(">", "<=")}
               AND wallet = ? COLLATE NOCASE AND dealFingerprint = ?`,
            [now, inp.wallet, inp.dealFingerprint],
          );
          const hit = livePendingByFingerprint(
            inp.wallet,
            inp.dealFingerprint,
            now,
          );
          if (hit) return rowToApproval(hit);
        }
        // cap counts LIVE pending only — overdue ones are dead on arrival
        if (livePendingCount(inp.wallet, now) >= maxPending) {
          throw new Error("approval_queue_full");
        }
        const rec = pendingFromParkInput(inp, now);
        const res = db.run(INSERT_SQL, insertArgs(rec));
        if (res.changes === 0 && inp.dealFingerprint) {
          // Unique index fired — a concurrent insert won; its pending
          // IS our answer (never a dup, never an error).
          const won = livePendingByFingerprint(
            inp.wallet,
            inp.dealFingerprint,
            now,
          );
          if (won) return rowToApproval(won);
        }
        return rec;
      })();
    },
    async get(id) {
      const row = selectById(id);
      return row ? expiredView(rowToApproval(row), Date.now()) : null;
    },
    async listByWallet(wallet, state) {
      const now = Date.now();
      const rows = db
        .query(
          "SELECT * FROM spend_approvals WHERE wallet = ? COLLATE NOCASE ORDER BY createdAt DESC",
        )
        .all(wallet) as SqliteRow[];
      return rows
        .map((r) => expiredView(rowToApproval(r), now))
        .filter((a) => !state || a.state === state);
    },
    async decide(id, action, actor, expiresAt) {
      const now = Date.now();
      // Atomic decide. 257-14 (H-3): approve defaults expiresAt to
      // now + APPROVED_PERMIT_TTL_MS (caller override wins).
      const res = db.run(
        `UPDATE spend_approvals
         SET state = ?, decidedBy = ?, decidedAt = ?, expiresAt = COALESCE(?, expiresAt)
         WHERE id = ? AND ${LIVE_PENDING}`,
        [
          action === "approve" ? "approved" : "rejected",
          actor,
          now,
          action === "approve"
            ? (expiresAt ?? now + APPROVED_PERMIT_TTL_MS)
            : (expiresAt ?? null),
          id,
          now,
        ],
      );
      return res.changes > 0;
    },
    async consume(id, expectedFingerprint) {
      const now = Date.now();
      // Atomic single-use; WHERE pins expiresAt > now (H-3: stale
      // permit fails → caller re-holds) + dealFingerprint IS (D-257-Q6).
      const res =
        expectedFingerprint === undefined
          ? db.run(
              `UPDATE spend_approvals SET state = 'consumed', consumedAt = ?
               WHERE id = ? AND state = 'approved' AND expiresAt > ?`,
              [now, id, now],
            )
          : db.run(
              `UPDATE spend_approvals SET state = 'consumed', consumedAt = ?
               WHERE id = ? AND state = 'approved' AND expiresAt > ?
               AND dealFingerprint IS ?`,
              [now, id, now, expectedFingerprint],
            );
      return res.changes > 0;
    },
    async countPending(wallet) {
      return livePendingCount(wallet, Date.now());
    },
    async expireOverdue(now = Date.now()) {
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
      return rows
        .map((r) => selectById(r.id))
        .filter((r): r is SqliteRow => !!r)
        .map(rowToApproval);
    },
  };
}
