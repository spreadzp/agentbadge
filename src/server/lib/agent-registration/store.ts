/**
 * SLICE-184-1 (EPIC-184): Self-serve agent registration store.
 * SLICE-184-8 (Arc Studio review): C-2 — json mutations serialized per
 * path through an async mutex (read-modify-write was racy → clobber);
 * M-5 — persisted `keyHashIndex` makes byKeyHash O(1); C-1 —
 * `consumedSignatures` set gives single-use sponsored intents.
 *
 * Async write-through store, same contract as AgentWalletStore (registry.ts):
 * every mutation is persisted BEFORE the caller sees the result; the process
 * holds no authoritative state so a restart loses nothing.
 *
 * Backends: json (.data/agent-registrations.json), memory (tests/dev).
 * db backend (Postgres via @agentbadge/database) — O3, json→db migration later;
 * the interface is async already so swapping is transparent.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export interface AgentRegistration {
  /** eip155:<chainId>:<registryAddress>:<tokenId> */
  agentId: string;
  registryAddress: `0x${string}`;
  registryTx: `0x${string}`;
  name: string;
  endpoint?: string;
  /** sha256 hex of the api key — the plaintext key is never stored. */
  keyHash: string;
  tier: "observer";
  status: "active" | "revoked";
  createdAt: number;
  revokedAt?: number;
  revokedBy?: string;
  /**
   * SLICE-184-5: user wallet that owns the ERC-8004 NFT after the
   * mint+transfer relayer path. Absent on legacy records = treasury
   * custody (ops wallet is the on-chain owner).
   */
  owner?: `0x${string}`;
  /** True when the mint was paid by treasury on the user's behalf. */
  sponsored?: boolean;
  /** transferFrom(ops→owner) tx hash — second leg of the sponsored mint. */
  ownerTx?: `0x${string}`;
}

export interface AgentRegistrationStore {
  name: "json" | "memory" | "db";
  put(rec: AgentRegistration): Promise<void>;
  get(agentId: string): Promise<AgentRegistration | undefined>;
  byKeyHash(keyHash: string): Promise<AgentRegistration | undefined>;
  /** Newest first. */
  list(): Promise<AgentRegistration[]>;
  /**
   * Marks the record revoked (stamps revokedAt/revokedBy).
   * Idempotent: returns true if already revoked, false if unknown agentId.
   */
  revoke(agentId: string, actor?: string): Promise<boolean>;
  /**
   * SLICE-184-8 (C-1): single-use sponsored intent signatures. Atomically
   * marks `sigHash` consumed — returns true on first use, false on replay.
   * Implementations must be atomic (json backend runs under the mutex).
   */
  consumeSignature(sigHash: string): Promise<boolean>;
}

const newestFirst = (list: AgentRegistration[]) =>
  [...list].sort((a, b) => b.createdAt - a.createdAt);

const revokedView = (
  rec: AgentRegistration,
  actor?: string,
): AgentRegistration => ({
  ...rec,
  status: "revoked",
  revokedAt: rec.revokedAt ?? Date.now(),
  revokedBy: rec.revokedBy ?? actor,
});

/* ------------------------------- json ---------------------------------- */

interface RegistrationsJsonFile {
  registrations: Record<string, AgentRegistration>;
  /** keyHash → agentId — O(1) auth lookup (M-5). */
  keyHashIndex?: Record<string, string>;
  /** sha256(signature) → consumedAt ms — single-use intents (C-1). */
  consumedSignatures?: Record<string, number>;
}

function readJson(path: string): RegistrationsJsonFile {
  if (!existsSync(path)) return { registrations: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RegistrationsJsonFile;
    return {
      registrations: raw.registrations ?? {},
      ...(raw.keyHashIndex ? { keyHashIndex: raw.keyHashIndex } : {}),
      ...(raw.consumedSignatures
        ? { consumedSignatures: raw.consumedSignatures }
        : {}),
    };
  } catch {
    return { registrations: {} };
  }
}

function writeJson(path: string, data: RegistrationsJsonFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

/**
 * Serializes async mutations per path — plain promise chain, no deps.
 * Prevents concurrent read-modify-write clobbers inside one process
 * (C-2). Multi-replica deployments still need the db backend (O3).
 */
function createMutex(): <T>(fn: () => Promise<T>) => Promise<T> {
  let tail: Promise<unknown> = Promise.resolve();
  return <T>(fn: () => Promise<T>): Promise<T> => {
    const next = tail.then(fn);
    tail = next.catch(() => {});
    return next;
  };
}

export function createJsonAgentRegistrationStore(
  path = join(process.cwd(), ".data", "agent-registrations.json"),
): AgentRegistrationStore {
  const locked = createMutex();
  const indexKey = (data: RegistrationsJsonFile, rec: AgentRegistration) => {
    data.keyHashIndex = data.keyHashIndex ?? {};
    data.keyHashIndex[rec.keyHash] = rec.agentId;
  };
  return {
    name: "json",
    async put(rec) {
      return locked(async () => {
        const data = readJson(path);
        data.registrations[rec.agentId] = rec;
        indexKey(data, rec);
        writeJson(path, data);
      });
    },
    async get(agentId) {
      return readJson(path).registrations[agentId];
    },
    async byKeyHash(keyHash) {
      const data = readJson(path);
      const indexed = data.keyHashIndex?.[keyHash];
      if (indexed) return data.registrations[indexed];
      // Legacy files written before keyHashIndex — scan once.
      return Object.values(data.registrations).find(
        (r) => r.keyHash === keyHash,
      );
    },
    async list() {
      return newestFirst(Object.values(readJson(path).registrations));
    },
    async revoke(agentId, actor) {
      return locked(async () => {
        const data = readJson(path);
        const rec = data.registrations[agentId];
        if (!rec) return false;
        data.registrations[agentId] = revokedView(rec, actor);
        writeJson(path, data);
        return true;
      });
    },
    async consumeSignature(sigHash) {
      return locked(async () => {
        const data = readJson(path);
        data.consumedSignatures = data.consumedSignatures ?? {};
        if (data.consumedSignatures[sigHash] !== undefined) return false;
        data.consumedSignatures[sigHash] = Date.now();
        writeJson(path, data);
        return true;
      });
    },
  };
}

/* ------------------------------- memory -------------------------------- */

export function createMemoryAgentRegistrationStore(): AgentRegistrationStore {
  const map = new Map<string, AgentRegistration>();
  const consumed = new Set<string>();
  return {
    name: "memory",
    async put(rec) {
      map.set(rec.agentId, rec);
    },
    async get(agentId) {
      return map.get(agentId);
    },
    async byKeyHash(keyHash) {
      return [...map.values()].find((r) => r.keyHash === keyHash);
    },
    async list() {
      return newestFirst([...map.values()]);
    },
    async revoke(agentId, actor) {
      const rec = map.get(agentId);
      if (!rec) return false;
      map.set(agentId, revokedView(rec, actor));
      return true;
    },
    async consumeSignature(sigHash) {
      if (consumed.has(sigHash)) return false;
      consumed.add(sigHash);
      return true;
    },
  };
}
