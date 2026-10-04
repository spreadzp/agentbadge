/**
 * SLICE-155-1: AgentWalletRegistry — wallet ↔ ERC-8004 agentId ↔ venue.
 *
 * Non-custodial by design (landmine): records hold ADDRESS + metadata
 * only — no private keys, no seed material. Wallet creation is
 * operator-side (`circle wallet create --chain ARC`), we only register
 * an existing address after a wallet-sig ownership proof.
 *
 * `envelope` is the platform spend-caps placeholder wired in 155-2 —
 * the field exists on the record now so later slices don't migrate.
 *
 * Storage: JSON file by default (.data/agent-wallets.json), in-memory
 * backend for tests — same store pattern as lib/eaas/store.ts.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { isAddress, getAddress } from "viem";
import type { AgentWalletRepository } from "@agentbadge/database";

/* --------------------------------- types ---------------------------------- */

/** Platform-side spend caps — USD decimals, enforced in 155-2 envelope.
 *  Monotonic invariant: perTx ≤ daily ≤ weekly ≤ monthly. */
export interface SpendCaps {
  perTxUsd?: number;
  dailyUsd?: number;
  weeklyUsd?: number;
  monthlyUsd?: number;
}

export interface AgentWalletRecord {
  /** Unique EVM address, checksummed. */
  address: `0x${string}`;
  /** ERC-8004 agentId link (optional at registration). */
  agentId?: string;
  /** Venue scope — wallets may exist unscoped (no venueId). */
  venueId?: string;
  label: string;
  kind: "circle-agent" | "eoa";
  /** Platform caps — 155-2 envelope reads this. */
  envelope: SpendCaps;
  /** Wallet that signed the registration proof (lowercased). */
  registeredBy: `0x${string}`;
  createdAt: number;
  active: boolean;
}

export interface AgentWalletInput {
  address: string;
  agentId?: string;
  venueId?: string;
  label: string;
  kind?: AgentWalletRecord["kind"];
  envelope?: SpendCaps;
  /** Wallet-sig verified caller — becomes registeredBy. */
  registeredBy: string;
}

/**
 * Async store interface (SLICE-155-10): write-through to the backend —
 * Postgres for durable prod state, json/memory for dev & tests. Every
 * mutation is persisted BEFORE the caller sees the result; the process
 * holds no authoritative state so a restart loses nothing.
 */
export interface AgentWalletStore {
  name: "json" | "memory" | "db";
  put(rec: AgentWalletRecord): Promise<void>;
  get(address: string): Promise<AgentWalletRecord | undefined>;
  /** Newest first. venueId filter when given. */
  list(venueId?: string): Promise<AgentWalletRecord[]>;
  /** Sets active=false. Returns false if unknown. */
  deactivate(address: string): Promise<boolean>;
  /** Replace envelope caps. Returns false if unknown/inactive. */
  setEnvelope(address: string, caps: SpendCaps): Promise<boolean>;
}

/* ------------------------------- validation ------------------------------- */

const LABEL_MAX = 120;
const KINDS = new Set<AgentWalletRecord["kind"]>(["circle-agent", "eoa"]);

/** Throws Error with a client-safe message on invalid input. */
export function validateWalletInput(
  input: AgentWalletInput,
): Omit<AgentWalletRecord, "createdAt" | "active"> {
  if (!isAddress(input.address)) {
    throw new Error("invalid wallet address");
  }
  const address = getAddress(input.address);
  const label = (input.label ?? "").trim();
  if (!label || label.length > LABEL_MAX) {
    throw new Error(`label required (1..${LABEL_MAX} chars)`);
  }
  const kind = input.kind ?? "circle-agent";
  if (!KINDS.has(kind)) throw new Error(`invalid kind "${input.kind}"`);
  if (!isAddress(input.registeredBy)) {
    throw new Error("invalid registeredBy");
  }
  const agentId = input.agentId?.trim() || undefined;
  const venueId = input.venueId?.trim() || undefined;
  return {
    address,
    ...(agentId ? { agentId } : {}),
    ...(venueId ? { venueId } : {}),
    label,
    kind,
    envelope: input.envelope ?? {},
    registeredBy: input.registeredBy.toLowerCase() as `0x${string}`,
  };
}

/* ---------------------------------- JSON ---------------------------------- */

interface WalletsJsonFile {
  wallets: Record<string, AgentWalletRecord>;
}

function readJson(path: string): WalletsJsonFile {
  if (!existsSync(path)) return { wallets: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as WalletsJsonFile;
    return { wallets: raw.wallets ?? {} };
  } catch {
    return { wallets: {} };
  }
}

function writeJson(path: string, data: WalletsJsonFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

const newestFirst = (list: AgentWalletRecord[]) =>
  [...list].sort((a, b) => b.createdAt - a.createdAt);

export function createJsonAgentWalletStore(
  path = join(process.cwd(), ".data", "agent-wallets.json"),
): AgentWalletStore {
  return {
    name: "json",
    async put(rec) {
      const data = readJson(path);
      data.wallets[rec.address.toLowerCase()] = rec;
      writeJson(path, data);
    },
    async get(address) {
      return readJson(path).wallets[address.toLowerCase()];
    },
    async list(venueId) {
      const all = Object.values(readJson(path).wallets);
      return newestFirst(
        venueId ? all.filter((w) => w.venueId === venueId) : all,
      );
    },
    async deactivate(address) {
      const data = readJson(path);
      const rec = data.wallets[address.toLowerCase()];
      if (!rec) return false;
      data.wallets[address.toLowerCase()] = { ...rec, active: false };
      writeJson(path, data);
      return true;
    },
    async setEnvelope(address, caps) {
      const data = readJson(path);
      const rec = data.wallets[address.toLowerCase()];
      if (!rec || !rec.active) return false;
      data.wallets[address.toLowerCase()] = { ...rec, envelope: caps };
      writeJson(path, data);
      return true;
    },
  };
}

export function createMemoryAgentWalletStore(): AgentWalletStore {
  const map = new Map<string, AgentWalletRecord>();
  return {
    name: "memory",
    async put(rec) {
      map.set(rec.address.toLowerCase(), rec);
    },
    async get(address) {
      return map.get(address.toLowerCase());
    },
    async list(venueId) {
      const all = [...map.values()];
      return newestFirst(
        venueId ? all.filter((w) => w.venueId === venueId) : all,
      );
    },
    async deactivate(address) {
      const rec = map.get(address.toLowerCase());
      if (!rec) return false;
      map.set(address.toLowerCase(), { ...rec, active: false });
      return true;
    },
    async setEnvelope(address, caps) {
      const rec = map.get(address.toLowerCase());
      if (!rec || !rec.active) return false;
      map.set(address.toLowerCase(), { ...rec, envelope: caps });
      return true;
    },
  };
}

/* ---------------------------------- Postgres ------------------------------ */

/**
 * SLICE-155-10: Postgres backend — write-through. The full record rides
 * in `payload` Json; typed columns stay in sync for indexed queries
 * (venue-scoped lists, active filter). `address` is stored lowercased —
 * keys are case-insensitive across all backends.
 */
export function createDbAgentWalletStore(
  repo: AgentWalletRepository,
): AgentWalletStore {
  const toRecord = (row: {
    payload: unknown;
  }): AgentWalletRecord => {
    const p = row.payload;
    return (typeof p === "string" ? JSON.parse(p) : p) as AgentWalletRecord;
  };
  const toRow = (rec: AgentWalletRecord) => ({
    address: rec.address.toLowerCase(),
    agentId: rec.agentId ?? null,
    venueId: rec.venueId ?? null,
    label: rec.label,
    kind: rec.kind,
    registeredBy: rec.registeredBy,
    active: rec.active,
    payload: rec as unknown as Parameters<
      AgentWalletRepository["upsert"]
    >[0]["payload"],
  });
  return {
    name: "db",
    async put(rec) {
      await repo.upsert(toRow(rec));
    },
    async get(address) {
      const row = await repo.getByAddress(address);
      return row ? toRecord(row) : undefined;
    },
    async list(venueId) {
      const rows = await repo.list(venueId ? { venueId } : undefined);
      return newestFirst(rows.map(toRecord));
    },
    async deactivate(address) {
      const row = await repo.getByAddress(address);
      if (!row) return false;
      const rec = { ...toRecord(row), active: false };
      await repo.upsert(toRow(rec));
      return true;
    },
    async setEnvelope(address, caps) {
      const row = await repo.getByAddress(address);
      if (!row) return false;
      const rec = toRecord(row);
      if (!rec.active) return false;
      await repo.upsert(toRow({ ...rec, envelope: caps }));
      return true;
    },
  };
}
