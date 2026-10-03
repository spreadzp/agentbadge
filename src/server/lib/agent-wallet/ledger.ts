/**
 * SLICE-155-2: SpendLedger — append-only ledger of platform payments
 * per agent wallet. Drives rolling-window envelope usage.
 *
 * State machine: reserved → settled | released | failed.
 *   reserved — cap space held before payment execution (check-then-
 *   settle race guard: reserved counts toward windows until release).
 *   settled  — payment completed (txHash attached post-settle).
 *   released — payment attempt aborted/refunded — cap space returned.
 *   failed   — execution threw after reserve — cap space returned;
 *              kept for audit instead of deleted (ledger is append-only).
 *
 * Usage windows are ROLLING (now − windowSec), summed over
 * reserved+settled entries — a released/failed entry frees its amount.
 *
 * Backends: json (default, restart-safe) + sqlite via bun:sqlite when
 * running under Bun (returns null under node/vitest → callers fall
 * back), memory for tests — same contract as lib/eaas/store.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";

/* --------------------------------- types ---------------------------------- */

export type SpendKind = "venue-fee" | "subscription" | "eaas" | "x402";

export type SpendState = "reserved" | "settled" | "released" | "failed";

export interface SpendEntry {
  id: string;
  wallet: `0x${string}`;
  amountUsd: number;
  kind: SpendKind;
  /** jobId/verdictId/subscriptionId — caller-provided correlation. */
  refId: string;
  txHash?: `0x${string}`;
  state: SpendState;
  /** Reserved-at epoch ms — window anchoring timestamp. */
  at: number;
}

export interface SpendLedger {
  name: "json" | "sqlite" | "memory";
  /** Insert a new entry (id-unique, insert-or-ignore). */
  insert(entry: SpendEntry): void;
  /** Transition reserved → settled|released|failed. No-op otherwise. */
  transition(id: string, to: Exclude<SpendState, "reserved">, txHash?: string): boolean;
  /** All entries for a wallet (any state), newest first. */
  listByWallet(wallet: string): SpendEntry[];
}

/** Entry ids: `sp_<hex>` — enough entropy for a local ledger. */
export function newSpendId(): string {
  return `sp_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/* ------------------------------- windows ---------------------------------- */

export const WINDOW_SEC = { daily: 86_400, weekly: 604_800, monthly: 2_592_000 } as const;

/** Sum of reserved+settled amounts for wallet within `windowSec` (rolling). */
export function windowUsage(
  ledger: SpendLedger,
  wallet: string,
  windowSec: number,
  now = Date.now(),
): { used: number; oldestAt?: number } {
  const cutoff = now - windowSec * 1000;
  let used = 0;
  let oldestAt: number | undefined;
  for (const e of ledger.listByWallet(wallet)) {
    if (e.state !== "reserved" && e.state !== "settled") continue;
    if (e.at < cutoff) continue;
    used += e.amountUsd;
    if (oldestAt === undefined || e.at < oldestAt) oldestAt = e.at;
  }
  return { used, ...(oldestAt !== undefined ? { oldestAt } : {}) };
}

/* ---------------------------------- JSON ---------------------------------- */

interface LedgerJsonFile {
  entries: Record<string, SpendEntry>;
}

function readJson(path: string): LedgerJsonFile {
  if (!existsSync(path)) return { entries: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as LedgerJsonFile;
    return { entries: raw.entries ?? {} };
  } catch {
    return { entries: {} };
  }
}

function writeJson(path: string, data: LedgerJsonFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data));
}

const byNewest = (a: SpendEntry, b: SpendEntry) => b.at - a.at;

export function createJsonSpendLedger(
  path = join(process.cwd(), ".data", "agent-wallet-ledger.json"),
): SpendLedger {
  return {
    name: "json",
    insert(entry) {
      const data = readJson(path);
      if (data.entries[entry.id]) return; // idempotent
      data.entries[entry.id] = entry;
      writeJson(path, data);
    },
    transition(id, to, txHash) {
      const data = readJson(path);
      const e = data.entries[id];
      if (!e || e.state !== "reserved") return false;
      data.entries[id] = {
        ...e,
        state: to,
        ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
      };
      writeJson(path, data);
      return true;
    },
    listByWallet(wallet) {
      const w = wallet.toLowerCase();
      return Object.values(readJson(path).entries)
        .filter((e) => e.wallet.toLowerCase() === w)
        .sort(byNewest);
    },
  };
}

/* --------------------------------- sqlite --------------------------------- */

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
      state TEXT NOT NULL,
      at INTEGER NOT NULL
    )`);
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
  };
}

export function createSqliteSpendLedger(
  path = join(process.cwd(), ".data", "agent-wallet-ledger.db"),
): SpendLedger | null {
  const db = openBunSqlite(path);
  if (!db) return null;
  return {
    name: "sqlite",
    insert(entry) {
      db.run(
        `INSERT OR IGNORE INTO spend_ledger
         (id, wallet, amountUsd, kind, refId, txHash, state, at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          entry.id,
          entry.wallet,
          entry.amountUsd,
          entry.kind,
          entry.refId,
          entry.txHash ?? null,
          entry.state,
          entry.at,
        ],
      );
    },
    transition(id, to, txHash) {
      const res = db.run(
        `UPDATE spend_ledger SET state = ?, txHash = COALESCE(?, txHash)
         WHERE id = ? AND state = 'reserved'`,
        [to, txHash ?? null, id],
      );
      return res.changes > 0;
    },
    listByWallet(wallet) {
      const rows = db
        .query("SELECT * FROM spend_ledger WHERE wallet = ? ORDER BY at DESC")
        .all(wallet) as SqliteRow[];
      return rows.map(rowToEntry);
    },
  };
}

/* --------------------------------- memory --------------------------------- */

export function createMemorySpendLedger(): SpendLedger {
  const map = new Map<string, SpendEntry>();
  return {
    name: "memory",
    insert(entry) {
      if (!map.has(entry.id)) map.set(entry.id, entry);
    },
    transition(id, to, txHash) {
      const e = map.get(id);
      if (!e || e.state !== "reserved") return false;
      map.set(id, {
        ...e,
        state: to,
        ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
      });
      return true;
    },
    listByWallet(wallet) {
      const w = wallet.toLowerCase();
      return [...map.values()]
        .filter((e) => e.wallet.toLowerCase() === w)
        .sort(byNewest);
    },
  };
}

/**
 * Default ledger factory: sqlite under Bun → json fallback. `sqlite`
 * returns null under node (vitest) so json is the dev/test default.
 */
export function createSpendLedger(
  backend: "json" | "sqlite" | "memory" = "json",
  path?: string,
): SpendLedger {
  if (backend === "memory") return createMemorySpendLedger();
  if (backend === "sqlite") {
    return (
      createSqliteSpendLedger(path) ?? createJsonSpendLedger(
        (path ?? "").replace(/\.db$/, ".json") || undefined,
      )
    );
  }
  return createJsonSpendLedger(path);
}
