/**
 * SLICE-184-1 (EPIC-184): Self-serve agent registration store.
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
  /** sha256 hex of the api_key — the plaintext key is never stored. */
  keyHash: string;
  tier: "observer";
  status: "active" | "revoked";
  createdAt: number;
  revokedAt?: number;
  revokedBy?: string;
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
}

function readJson(path: string): RegistrationsJsonFile {
  if (!existsSync(path)) return { registrations: {} };
  try {
    const raw = JSON.parse(readFileSync(path, "utf8")) as RegistrationsJsonFile;
    return { registrations: raw.registrations ?? {} };
  } catch {
    return { registrations: {} };
  }
}

function writeJson(path: string, data: RegistrationsJsonFile): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify(data, null, 2));
}

export function createJsonAgentRegistrationStore(
  path = join(process.cwd(), ".data", "agent-registrations.json"),
): AgentRegistrationStore {
  return {
    name: "json",
    async put(rec) {
      const data = readJson(path);
      data.registrations[rec.agentId] = rec;
      writeJson(path, data);
    },
    async get(agentId) {
      return readJson(path).registrations[agentId];
    },
    async byKeyHash(keyHash) {
      return Object.values(readJson(path).registrations).find(
        (r) => r.keyHash === keyHash,
      );
    },
    async list() {
      return newestFirst(Object.values(readJson(path).registrations));
    },
    async revoke(agentId, actor) {
      const data = readJson(path);
      const rec = data.registrations[agentId];
      if (!rec) return false;
      data.registrations[agentId] = revokedView(rec, actor);
      writeJson(path, data);
      return true;
    },
  };
}

/* ------------------------------- memory -------------------------------- */

export function createMemoryAgentRegistrationStore(): AgentRegistrationStore {
  const map = new Map<string, AgentRegistration>();
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
  };
}
