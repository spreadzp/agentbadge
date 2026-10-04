/**
 * SQLite backend for the SpendLedger — split from ledger.ts (300-line
 * file limit). bun:sqlite is Bun-only: under node/vitest the require
 * throws → openBunSqlite returns null → caller falls back to json.
 */
import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

import type { SpendEntry, SpendKind, SpendLedger, SpendState } from "./ledger";

type SqliteDatabase = InstanceType<typeof import("bun:sqlite").Database>;
const nodeRequire = createRequire(import.meta.url);

/** bun:sqlite is Bun-only — under node/vitest require throws → null. */
function openBunSqlite(path: string): SqliteDatabase | null {
  try {
    const mod = nodeRequire("bun:sqlite") as typeof import("bun:sqlite");
    mkdirSync(dirname(path), { recursive: true });
    const db = new mod.Database(path);
    db.run(`CREATE TABLE IF NOT EXISTS spend_ledger (
      id TEXT PRIMARY KEY,
      wallet TEXT NOT NULL,
      amountUsd REAL NOT NULL,
      kind TEXT NOT NULL,
      refId TEXT NOT NULL,
      txHash TEXT,
      sourceChain TEXT,
      venueId TEXT,
      denialReason TEXT,
      state TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
    // Guarded ALTERs for pre-existing DBs (duplicate column error
    // is expected, ignored): SLICE-156-3 sourceChain, 155-11 venueId/denialReason.
    for (const col of ["sourceChain TEXT", "venueId TEXT", "denialReason TEXT"]) {
      try {
        db.run(`ALTER TABLE spend_ledger ADD COLUMN ${col}`);
      } catch { /* column already present */ }
    }
    db.run("CREATE INDEX IF NOT EXISTS idx_spend_wallet ON spend_ledger(wallet)");
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
  txHash: string | null;
  sourceChain: string | null;
  venueId: string | null;
  denialReason: string | null;
  state: string;
  at: number;
}

function rowToEntry(r: SqliteRow): SpendEntry {
  return {
    id: r.id,
    wallet: r.wallet as `0x${string}`,
    amountUsd: r.amountUsd,
    kind: r.kind as SpendKind,
    refId: r.refId,
    state: r.state as SpendState,
    at: r.at,
    ...(r.txHash ? { txHash: r.txHash as `0x${string}` } : {}),
    ...(r.sourceChain ? { sourceChain: r.sourceChain } : {}),
    ...(r.venueId ? { venueId: r.venueId } : {}),
    ...(r.denialReason ? { denialReason: r.denialReason } : {}),
  };
}

export function createSqliteSpendLedger(
  path = join(process.cwd(), ".data", "agent-wallet-ledger.db"),
): SpendLedger | null {
  const db = openBunSqlite(path);
  if (!db) return null;
  return {
    name: "sqlite",
    async insert(entry) {
      db.run(
        `INSERT OR IGNORE INTO spend_ledger
         (id, wallet, amountUsd, kind, refId, txHash, sourceChain, venueId, denialReason, state, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.wallet,
          entry.amountUsd,
          entry.kind,
          entry.refId,
          entry.txHash ?? null,
          entry.sourceChain ?? null,
          entry.venueId ?? null,
          entry.denialReason ?? null,
          entry.state,
          entry.at,
        ],
      );
    },
    async transition(id, to, txHash, sourceChain) {
      const res = db.run(
        `UPDATE spend_ledger SET state = ?, txHash = COALESCE(?, txHash),
         sourceChain = COALESCE(?, sourceChain)
         WHERE id = ? AND state = 'reserved'`,
        [to, txHash ?? null, sourceChain ?? null, id],
      );
      return res.changes > 0;
    },
    async listByWallet(wallet) {
      const rows = db
        .query("SELECT * FROM spend_ledger WHERE wallet = ? ORDER BY at DESC")
        .all(wallet) as SqliteRow[];
      return rows.map(rowToEntry);
    },
  };
}
