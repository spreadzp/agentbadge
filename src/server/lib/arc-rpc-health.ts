// Arc RPC health: live chain head vs. the forensics indexer cursor, per network.
// Reads the head straight from the RPC (no cached block number) and the cursor
// from the database, so a stale value can never hide behind a healthy status.

import { createPublicClient, http } from "viem";
import { getDatabase } from "./database";

// Mirrors the forensics indexer RPC mapping (same env vars and defaults).
const CHAIN_RPC: Record<string, { env: string; def: string }> = {
  "5042": { env: "ARC_MAINNET_RPC_URL", def: "https://rpc.mainnet.arc.io" },
  "5042002": {
    env: "ARC_RPC_URL",
    def: "https://rpc.blockdaemon.testnet.arc.network",
  },
};

export interface ArcChainHealth {
  chain: string;
  name: string;
  rpc: "up" | "down";
  head: string | null;
  cursor: string | null;
  lag: string | null;
  error?: string;
}

export interface ArcRpcHealthDeps {
  getHead(chain: string): Promise<bigint>;
  getCursor(chain: string): Promise<bigint | null>;
}

const ARC_CHAINS = [
  { chain: "5042", name: "arc-mainnet" },
  { chain: "5042002", name: "arc-testnet" },
] as const;

const TIMEOUT_MS = 3000;
const CACHE_TTL_MS = 10_000;

function withTimeout<T>(p: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`timeout after ${ms}ms`)), ms);
  });
  return Promise.race([p, timeout]).finally(() => clearTimeout(timer));
}

const errorMessage = (e: unknown): string =>
  e instanceof Error ? e.message : String(e);

export async function probeArcRpcHealth(
  deps: ArcRpcHealthDeps,
  timeoutMs = TIMEOUT_MS,
): Promise<ArcChainHealth[]> {
  return Promise.all(
    ARC_CHAINS.map(async ({ chain, name }): Promise<ArcChainHealth> => {
      let head: bigint | null = null;
      let cursor: bigint | null = null;
      const errors: string[] = [];
      try {
        head = await withTimeout(deps.getHead(chain), timeoutMs);
      } catch (e) {
        errors.push(`rpc: ${errorMessage(e)}`);
      }
      try {
        cursor = await withTimeout(deps.getCursor(chain), timeoutMs);
      } catch (e) {
        errors.push(`cursor: ${errorMessage(e)}`);
      }
      return {
        chain,
        name,
        rpc: head !== null ? "up" : "down",
        head: head?.toString() ?? null,
        cursor: cursor?.toString() ?? null,
        lag: head !== null && cursor !== null ? (head - cursor).toString() : null,
        ...(errors.length ? { error: errors.join("; ") } : {}),
      };
    }),
  );
}

function defaultDeps(): ArcRpcHealthDeps {
  return {
    getHead: (chain) => {
      const cfg = CHAIN_RPC[chain];
      const url = process.env[cfg.env] ?? cfg.def;
      const client = createPublicClient({
        transport: http(url, { timeout: TIMEOUT_MS }),
      });
      return client.getBlockNumber();
    },
    getCursor: (chain) => getDatabase().forensics.cursor.get(chain),
  };
}

let cached: { at: number; value: ArcChainHealth[] } | null = null;

// Health endpoints can be polled often; a short TTL keeps public RPC load bounded.
export async function getArcRpcHealth(): Promise<ArcChainHealth[]> {
  const now = Date.now();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.value;
  const value = await probeArcRpcHealth(defaultDeps());
  cached = { at: now, value };
  return value;
}
