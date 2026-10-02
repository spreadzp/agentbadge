/**
 * SLICE-154-1: VerdictStore — persistence for issued VerdictArtifacts.
 *
 * Pattern cloned from venue/store.ts (151-9, 152-5): a backend interface
 * + json (default) and sqlite impls + module-level accessor with test
 * hooks. `put` is idempotent on verdictId — a re-requested verdict is
 * served from the store without a second write (acceptance criterion).
 *
 * consumerWallet rides along on StoredVerdict for billing/limits in
 * SLICE-154-2 (x402) and 154-5 (consumer profiles).
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import type { Hex } from "viem";
import { logger } from "@agentbadge/passport";
import type { VerdictArtifact } from "./verdict";

export interface StoredVerdict {
  artifact: VerdictArtifact;
  /** Requesting consumer wallet — billing/limits key (154-2/154-5). */
  consumerWallet?: string;
  /** x402 settlement transaction hash (SLICE-154-2 afterSettle record). */
  paymentTx?: string;
  /** Raw policy evidence kept for audit; only its hash is inside the artifact. */
  evidence?: unknown;
}

export interface VerdictStoreBackend {
  name: "json" | "sqlite";
  ready(): Promise<void>;
  /** Idempotent by verdictId — same id is a no-op. */
  put(verdict: StoredVerdict): void;
  get(verdictId: Hex): StoredVerdict | undefined;
  getByDeliverable(deliverableHash: Hex): StoredVerdict[];
  /** Newest first; filter by consumerWallet when given. */
  list(consumerWallet?: string, limit?: number): StoredVerdict[];
}

const DEFAULT_LIST_LIMIT = 100;

/* ---------------------------------- JSON ---------------------------------- */

interface EaasJsonFile {
  verdicts: Record<string, StoredVerdict>;
}

function readJsonFile(path: string): EaasJsonFile {
  if (!existsSync(path)) return { verdicts: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as EaasJsonFile;
    return { verdicts: raw.verdicts ?? {} };
  } catch {
    return { verdicts: {} };
  }
}

function writeJsonFile(path: string, data: EaasJsonFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

function sortNewestFirst(list: StoredVerdict[]): StoredVerdict[] {
  return [...list].sort((a, b) =>
    b.artifact.issuedAt.localeCompare(a.artifact.issuedAt),
  );
}

export function createJsonVerdictStore(
  path = join(process.cwd(), ".data", "eaas-verdicts.json"),
): VerdictStoreBackend {
  return {
    name: "json",
    ready: () => Promise.resolve(),
    put(verdict) {
      const data = readJsonFile(path);
      const id = verdict.artifact.verdictId;
      if (data.verdicts[id]) return; // idempotent
      data.verdicts[id] = verdict;
      writeJsonFile(path, data);
    },
    get(verdictId) {
      return readJsonFile(path).verdicts[verdictId];
    },
    getByDeliverable(deliverableHash) {
      const all = Object.values(readJsonFile(path).verdicts);
      return sortNewestFirst(
        all.filter((v) => v.artifact.deliverableHash === deliverableHash),
      );
    },
    list(consumerWallet, limit = DEFAULT_LIST_LIMIT) {
      const all = Object.values(readJsonFile(path).verdicts);
      const filtered = consumerWallet
        ? all.filter((v) => v.consumerWallet === consumerWallet)
        : all;
      return sortNewestFirst(filtered).slice(0, limit);
    },
  };
}

/* --------------------------------- sqlite --------------------------------- */

type SqliteDatabase = InstanceType<typeof import("bun:sqlite").Database>;
const nodeRequire = createRequire(import.meta.url);

/**
 * bun:sqlite exists only under the Bun runtime — under node/vitest the
 * require throws and we return null so callers fall back to json (same
 * shape as venue db-store's "backend unavailable" semantics).
 */
function openBunSqlite(path: string): SqliteDatabase | null {
  try {
    const mod = nodeRequire("bun:sqlite") as typeof import("bun:sqlite");
    mkdirSync(dirname(path), { recursive: true });
    const db = new mod.Database(path);
    db.run(`CREATE TABLE IF NOT EXISTS verdicts (
      verdictId TEXT PRIMARY KEY,
      deliverableHash TEXT NOT NULL,
      consumerWallet TEXT,
      kind TEXT NOT NULL,
      policy TEXT NOT NULL,
      issuedAt TEXT NOT NULL,
      payload TEXT NOT NULL
    )`);
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_verdicts_deliverable ON verdicts(deliverableHash)",
    );
    db.run(
      "CREATE INDEX IF NOT EXISTS idx_verdicts_consumer ON verdicts(consumerWallet)",
    );
    return db;
  } catch {
    return null;
  }
}

interface SqliteRow {
  payload: string;
}

export function createSqliteVerdictStore(
  path = join(process.cwd(), ".data", "eaas-verdicts.db"),
): VerdictStoreBackend | null {
  const db = openBunSqlite(path);
  if (!db) return null;
  return {
    name: "sqlite",
    ready: () => Promise.resolve(),
    put(verdict) {
      const a = verdict.artifact;
      // INSERT OR IGNORE makes put idempotent on the PRIMARY KEY.
      db.run(
        `INSERT OR IGNORE INTO verdicts
         (verdictId, deliverableHash, consumerWallet, kind, policy, issuedAt, payload)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
          a.verdictId,
          a.deliverableHash,
          verdict.consumerWallet ?? null,
          a.kind,
          a.policy,
          a.issuedAt,
          JSON.stringify(verdict),
        ],
      );
    },
    get(verdictId) {
      const row = db
        .query("SELECT payload FROM verdicts WHERE verdictId = ?")
        .get(verdictId) as SqliteRow | undefined;
      return row ? (JSON.parse(row.payload) as StoredVerdict) : undefined;
    },
    getByDeliverable(deliverableHash) {
      const rows = db
        .query(
          "SELECT payload FROM verdicts WHERE deliverableHash = ? ORDER BY issuedAt DESC",
        )
        .all(deliverableHash) as SqliteRow[];
      return rows.map((r) => JSON.parse(r.payload) as StoredVerdict);
    },
    list(consumerWallet, limit = DEFAULT_LIST_LIMIT) {
      const rows = (
        consumerWallet
          ? db
            .query(
              "SELECT payload FROM verdicts WHERE consumerWallet = ? ORDER BY issuedAt DESC LIMIT ?",
            )
            .all(consumerWallet, limit)
          : db
            .query(
              "SELECT payload FROM verdicts ORDER BY issuedAt DESC LIMIT ?",
            )
            .all(limit)
      ) as SqliteRow[];
      return rows.map((r) => JSON.parse(r.payload) as StoredVerdict);
    },
  };
}

/* ------------------------------- singleton -------------------------------- */

let _store: VerdictStoreBackend | undefined;

/**
 * Shared backend for the app — ARC_EAAS_STORE (json default | sqlite).
 * sqlite falling back to json mirrors the venue store's prisma fallback.
 */
export function getVerdictStore(): VerdictStoreBackend {
  if (!_store) {
    const kind = (process.env.ARC_EAAS_STORE ?? "json").toLowerCase();
    if (kind === "sqlite") {
      const sqlite = createSqliteVerdictStore();
      if (sqlite) {
        _store = sqlite;
      } else {
        logger.warn("eaas: sqlite backend unavailable, falling back to json");
        _store = createJsonVerdictStore();
      }
    } else {
      _store = createJsonVerdictStore();
    }
  }
  return _store;
}

/** Test hook — inject a backend or reset to force re-resolution. */
export function setVerdictStoreForTesting(
  store: VerdictStoreBackend | undefined,
): void {
  _store = store;
}
