/**
 * SLICE-155-2: SpendLedger — append-only ledger of platform payments
 * per agent wallet. Drives rolling-window envelope usage.
 *
 * State machine: reserved → settled | released | failed (+ denied).
 *   reserved — cap space held before payment execution (check-then-
 *   settle race guard: reserved counts toward windows until release).
 *   settled  — payment completed (txHash attached post-settle).
 *   released — payment attempt aborted/refunded — cap space returned.
 *   failed   — execution threw after reserve — cap space returned;
 *              kept for audit instead of deleted (ledger is append-only).
 *   denied   — SLICE-155-11: spend_cap denial recorded as a terminal
 *              entry (denialReason) — durable audit of every blocked pay.
 *
 * Usage windows are ROLLING (now − windowSec), summed over
 * reserved+settled entries — a released/failed entry frees its amount.
 *
 * Backends: json (dev fallback) + sqlite via bun:sqlite under Bun
 * (returns null under node/vitest → callers fall back), memory for
 * tests — same contract as lib/eaas/store.ts — and "db" (SLICE-155-11):
 * Postgres via SpendLedgerRepository when DATABASE_ENABLED. The
 * interface is async for the db backend; all methods must be awaited.
 *
 * Fail-closed (grill Q2=A): a failed append/transition propagates —
 * the payment path must NOT succeed on an unwritten ledger.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import type { SpendLedgerRepository } from "@agentbadge/database";
import { createSqliteSpendLedger } from "./ledger-sqlite";

/** Repo insert payload column type (JsonValue) — avoids importing
 *  prisma codec-types transitively. */
type RepoPayload = Parameters<SpendLedgerRepository["append"]>[0]["payload"];

/* --------------------------------- types ---------------------------------- */

export type SpendKind = "venue-fee" | "subscription" | "eaas" | "x402";

/** Runtime set of valid spend kinds — EPIC-176 allow-list validation. */
export const SPEND_KINDS: ReadonlySet<SpendKind> = new Set<SpendKind>([
  "venue-fee",
  "subscription",
  "eaas",
  "x402",
]);

export type SpendState = "reserved" | "settled" | "released" | "failed" | "denied";

export interface SpendEntry {
  id: string;
  wallet: `0x${string}`;
  amountUsd: number;
  kind: SpendKind;
  /** jobId/verdictId/subscriptionId — caller-provided correlation. */
  refId: string;
  txHash?: `0x${string}`;
  /** SLICE-156-3: CAIP-2 source network for cross-chain attribution. */
  sourceChain?: string;
  /** SLICE-155-11: venue of the wallet at insert time (queryable col). */
  venueId?: string;
  /** SLICE-155-11: why a `denied` entry was blocked (cap name). */
  denialReason?: string;
  state: SpendState;
  /** Reserved-at epoch ms — window anchoring timestamp. */
  at: number;
}

export interface SpendLedger {
  name: "json" | "sqlite" | "memory" | "db";
  /** Insert a new entry (id-unique, insert-or-ignore). */
  insert(entry: SpendEntry): Promise<void>;
  /** Transition reserved → settled|released|failed. No-op otherwise. */
  transition(
    id: string,
    to: Exclude<SpendState, "reserved" | "denied">,
    txHash?: string,
    sourceChain?: string,
  ): Promise<boolean>;
  /** All entries for a wallet (any state), newest first. */
  listByWallet(wallet: string): Promise<SpendEntry[]>;
}

/** Entry ids: `sp_<hex>` — enough entropy for a local ledger. */
export function newSpendId(): string {
  return `sp_${crypto.randomUUID().replace(/-/g, "").slice(0, 16)}`;
}

/* ------------------------------- windows ---------------------------------- */

export const WINDOW_SEC = { daily: 86_400, weekly: 604_800, monthly: 2_592_000 } as const;

/** Sum of reserved+settled amounts for wallet within `windowSec` (rolling). */
export async function windowUsage(
  ledger: SpendLedger,
  wallet: string,
  windowSec: number,
  now = Date.now(),
): Promise<{ used: number; oldestAt?: number }> {
  const cutoff = now - windowSec * 1000;
  let used = 0;
  let oldestAt: number | undefined;
  for (const e of await ledger.listByWallet(wallet)) {
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
    async insert(entry) {
      const data = readJson(path);
      if (data.entries[entry.id]) return; // idempotent
      data.entries[entry.id] = entry;
      writeJson(path, data);
    },
    async transition(id, to, txHash, sourceChain) {
      const data = readJson(path);
      const e = data.entries[id];
      if (!e || e.state !== "reserved") return false;
      data.entries[id] = {
        ...e,
        state: to,
        ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
        ...(sourceChain ? { sourceChain } : {}),
      };
      writeJson(path, data);
      return true;
    },
    async listByWallet(wallet) {
      const w = wallet.toLowerCase();
      return Object.values(readJson(path).entries)
        .filter((e) => e.wallet.toLowerCase() === w)
        .sort(byNewest);
    },
  };
}

/* --------------------------------- memory --------------------------------- */

export function createMemorySpendLedger(): SpendLedger {
  const map = new Map<string, SpendEntry>();
  return {
    name: "memory",
    async insert(entry) {
      if (!map.has(entry.id)) map.set(entry.id, entry);
    },
    async transition(id, to, txHash, sourceChain) {
      const e = map.get(id);
      if (!e || e.state !== "reserved") return false;
      map.set(id, {
        ...e,
        state: to,
        ...(txHash ? { txHash: txHash as `0x${string}` } : {}),
        ...(sourceChain ? { sourceChain } : {}),
      });
      return true;
    },
    async listByWallet(wallet) {
      const w = wallet.toLowerCase();
      return [...map.values()]
        .filter((e) => e.wallet.toLowerCase() === w)
        .sort(byNewest);
    },
  };
}

/* ---------------------------------- db ------------------------------------ */

type SpendEventRow = Awaited<
  ReturnType<SpendLedgerRepository["listByWallet"]>
>[number];

/** Overlay current typed columns onto the insert-time payload snapshot. */
function spendRowToEntry(r: SpendEventRow): SpendEntry {
  const payload = r.payload as unknown as SpendEntry;
  return {
    ...payload,
    state: r.state as SpendState,
    ...(r.txHash ? { txHash: r.txHash as `0x${string}` } : {}),
    ...(r.sourceChain ? { sourceChain: r.sourceChain } : {}),
    ...(r.venueId ? { venueId: r.venueId } : {}),
    ...(r.denialReason ? { denialReason: r.denialReason } : {}),
  };
}

/**
 * SLICE-155-11: Postgres-backed ledger over SpendLedgerRepository.
 * Write-through + fail-closed by construction: every method awaits the
 * DB call before returning, errors propagate to the payment path.
 */
export function createDbSpendLedger(repo: SpendLedgerRepository): SpendLedger {
  return {
    name: "db",
    async insert(entry) {
      await repo.append({
        id: entry.id,
        wallet: entry.wallet,
        venueId: entry.venueId ?? null,
        kind: entry.kind,
        amountUsd: entry.amountUsd,
        state: entry.state,
        refId: entry.refId,
        txHash: entry.txHash ?? null,
        sourceChain: entry.sourceChain ?? null,
        denialReason: entry.denialReason ?? null,
        at: entry.at,
        payload: entry as unknown as RepoPayload,
      });
    },
    async transition(id, to, txHash, sourceChain) {
      return repo.transition(id, to, txHash, sourceChain);
    },
    async listByWallet(wallet) {
      const rows = await repo.listByWallet(wallet);
      return rows.map(spendRowToEntry);
    },
  };
}

/* -------------------------------- factory --------------------------------- */

export type SpendLedgerBackend = "json" | "sqlite" | "memory" | "db" | "auto";

/**
 * Default ledger factory.
 *  - "db"    → Postgres via repo (throws when repo is null — explicit
 *              misconfiguration must fail fast, not silently degrade).
 *  - "auto"  → db when repo present (DATABASE_ENABLED), else the
 *              sqlite→json dev chain (pre-155-11 default).
 *  - "sqlite"→ bun:sqlite, json fallback under node/vitest.
 *  - "json"/"memory" → as named.
 */
export function createSpendLedger(
  backend: SpendLedgerBackend = "auto",
  path?: string,
  repo?: SpendLedgerRepository | null,
): SpendLedger {
  if (backend === "db") {
    if (!repo) {
      throw new Error(
        "AGENT_WALLET_LEDGER_STORE=db requires DATABASE_ENABLED — spendLedger repo is null",
      );
    }
    return createDbSpendLedger(repo);
  }
  if (backend === "auto" && repo) return createDbSpendLedger(repo);
  if (backend === "memory") return createMemorySpendLedger();
  if (backend === "sqlite" || backend === "auto") {
    return (
      createSqliteSpendLedger(path) ??
      createJsonSpendLedger(
        (path ?? "").replace(/\.db$/, ".json") || undefined,
      )
    );
  }
  return createJsonSpendLedger(path);
}
