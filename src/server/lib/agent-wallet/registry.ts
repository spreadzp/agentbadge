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

/* --------------------------------- types ---------------------------------- */

/** Platform-side spend caps (enforced in SLICE-155-2 envelope). */
export interface SpendCaps {
  perTxUsd?: string;
  dailyUsd?: string;
  weeklyUsd?: string;
  monthlyUsd?: string;
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

export interface AgentWalletStore {
  name: "json" | "memory";
  put(rec: AgentWalletRecord): void;
  get(address: string): AgentWalletRecord | undefined;
  /** Newest first. venueId filter when given. */
  list(venueId?: string): AgentWalletRecord[];
  /** Sets active=false. Returns false if unknown. */
  deactivate(address: string): boolean;
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
    put(rec) {
      const data = readJson(path);
      data.wallets[rec.address.toLowerCase()] = rec;
      writeJson(path, data);
    },
    get(address) {
      return readJson(path).wallets[address.toLowerCase()];
    },
    list(venueId) {
      const all = Object.values(readJson(path).wallets);
      return newestFirst(
        venueId ? all.filter((w) => w.venueId === venueId) : all,
      );
    },
    deactivate(address) {
      const data = readJson(path);
      const rec = data.wallets[address.toLowerCase()];
      if (!rec) return false;
      data.wallets[address.toLowerCase()] = { ...rec, active: false };
      writeJson(path, data);
      return true;
    },
  };
}

export function createMemoryAgentWalletStore(): AgentWalletStore {
  const map = new Map<string, AgentWalletRecord>();
  return {
    name: "memory",
    put(rec) {
      map.set(rec.address.toLowerCase(), rec);
    },
    get(address) {
      return map.get(address.toLowerCase());
    },
    list(venueId) {
      const all = [...map.values()];
      return newestFirst(
        venueId ? all.filter((w) => w.venueId === venueId) : all,
      );
    },
    deactivate(address) {
      const rec = map.get(address.toLowerCase());
      if (!rec) return false;
      map.set(address.toLowerCase(), { ...rec, active: false });
      return true;
    },
  };
}
