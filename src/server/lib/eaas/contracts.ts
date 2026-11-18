/**
 * SLICE-154-3: external ERC-8183 contract registry (D7-154 allowlist).
 *
 * A third-party marketplace registers its escrow contract by wallet-sig;
 * registration probes ABI compatibility (getJob decodes / function
 * exists) before the contract goes `active`. Only allowlisted+active
 * contracts are evaluable via POST /api/eaas/jobs/evaluate.
 *
 * Store: JSON file (mirrors verdict store pattern) — durable across
 * restarts so the allowlist isn't lost.
 */

import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { dirname } from "node:path";
import { getAddress, isAddress } from "viem";
import {
  ERC8183_ABI,
  ERC8183_ACP_ABI,
  ERC8183_REF_ABI,
  type ReadClient,
} from "@agentbadge/circle-payments";

export interface EaasContract {
  address: `0x${string}`;
  chainId: number;
  /** Wallet that registered the contract (wallet-sig signer). */
  ownerWallet: `0x${string}`;
  active: boolean;
  probedAt: number;
  /** ABI flavor detected at probe: "circle" getJob has id+description;
   *  "acp" has token + getDescription(); "ref" is the erc8183-ref
   *  13-field packed Job struct. Drives escrowFor ABI choice. */
  variant?: "circle" | "acp" | "ref";
  terms?: { feeBps?: number; policyDefault?: string; noFeedback?: boolean };
}

export class ContractRegistryError extends Error {
  constructor(
    message: string,
    readonly code: "exists" | "not-found" | "forbidden" | "probe-failed",
  ) {
    super(message);
    this.name = "ContractRegistryError";
  }
}

export interface EaasContractStore {
  put(c: EaasContract): void;
  get(address: string, chainId: number): EaasContract | undefined;
  remove(address: string, chainId: number): boolean;
  list(owner?: string): EaasContract[];
}

const key = (address: string, chainId: number) =>
  `${chainId}:${address.toLowerCase()}`;

export function createMemoryContractStore(): EaasContractStore {
  const map = new Map<string, EaasContract>();
  return {
    put: (c) => map.set(key(c.address, c.chainId), { ...c }),
    get: (a, id) => map.get(key(a, id)),
    remove: (a, id) => map.delete(key(a, id)),
    list: (owner) =>
      [...map.values()].filter(
        (c) => !owner || c.ownerWallet.toLowerCase() === owner.toLowerCase(),
      ),
  };
}

/** JSON-file-backed registry — atomic-ish write on every mutation. */
export function createJsonContractStore(file: string): EaasContractStore {
  const mem = createMemoryContractStore();
  const load = () => {
    if (!existsSync(file)) return;
    try {
      const rows = JSON.parse(readFileSync(file, "utf8")) as EaasContract[];
      for (const r of rows) mem.put(r);
    } catch {
      /* corrupt file → start empty; probe data re-collects */
    }
  };
  const flush = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify(mem.list(), null, 2));
  };
  load();
  return {
    put: (c) => { mem.put(c); flush(); },
    get: (a, id) => mem.get(a, id),
    remove: (a, id) => { const ok = mem.remove(a, id); if (ok) flush(); return ok; },
    list: (owner) => mem.list(owner),
  };
}

/* --------------------------------- probe --------------------------------- */

/**
 * ABI-compat probe: call getJob(1) on the candidate address, trying the
 * known tuple layouts in a discriminating order:
 *   circle (9-field, description inline) → ref (13-field erc8183-ref
 *   packed Job) → acp (8-field, description via getDescription()).
 * Order matters: ref data decoded with the acp ABI yields a garbage
 * all-static tuple without throwing, so acp is tried last.
 * - decodes → contract speaks ERC-8183 → ok (+ detected variant)
 * - reverts WITH data / "execution reverted" → function exists, job
 *   absent → still ERC-8183-compatible (fail-open on revert, the
 *   evaluate-time getJob is the real gate)
 * - all layouts fail to decode or no data → not compatible
 * - empty bytecode (EOA) → rejected
 */
export interface ProbeResult {
  ok: boolean;
  variant?: "circle" | "acp" | "ref";
  error?: string;
}

const PROBE_CANDIDATES = [
  { variant: "circle", abi: ERC8183_ABI },
  { variant: "ref", abi: ERC8183_REF_ABI },
  { variant: "acp", abi: ERC8183_ACP_ABI },
] as const;

const REVERTISH = /revert|not found|does not exist|invalid/i;

export async function probeErc8183(
  read: ReadClient & { getBytecode?(a: { address: `0x${string}` }): Promise<unknown> },
  address: `0x${string}`,
): Promise<ProbeResult> {
  if (!isAddress(address)) return { ok: false, error: "invalid address" };
  if (read.getBytecode) {
    const code = await read.getBytecode({ address }).catch(() => "0x");
    if (code === "0x" || code == null) {
      return { ok: false, error: "no contract code at address" };
    }
  }
  let lastError = "probe failed";
  for (const { variant, abi } of PROBE_CANDIDATES) {
    try {
      const raw = await read.readContract({
        address,
        abi,
        functionName: "getJob",
        args: [1n],
      });
      // Must decode to a struct with a numeric status field.
      const rec = raw as { status?: unknown } | null;
      const s = rec?.status;
      if (typeof s !== "number" && typeof s !== "bigint") continue;
      return { ok: true, variant };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // Function exists but job 1 is absent → revert is still 8183-speak.
      if (REVERTISH.test(msg)) return { ok: true };
      // Decode mismatch (e.g. string offset out of range) → next layout.
      lastError = msg;
    }
  }
  return { ok: false, error: `probe failed: ${lastError}` };
}

/* ------------------------------- registry -------------------------------- */

export interface EaasContractRegistry {
  register(
    input: {
      address: string;
      chainId: number;
      terms?: EaasContract["terms"];
    },
    ownerWallet: `0x${string}`,
  ): Promise<EaasContract>;
  get(address: string, chainId: number): EaasContract | undefined;
  /** owner-only deactivate. */
  remove(address: string, chainId: number, ownerWallet: string): EaasContract;
  list(owner?: string): EaasContract[];
}

export function createContractRegistry(deps: {
  store: EaasContractStore;
  /** Chain RPC reader used for the ABI probe — injectable for tests. */
  read: ReadClient & {
    getBytecode?(a: { address: `0x${string}` }): Promise<unknown>;
  };
  /** Contract must live on this chain (server's Arc network). */
  chainId: number;
  now?: () => number;
}): EaasContractRegistry {
  const now = deps.now ?? (() => Date.now());
  const normalize = (a: string): `0x${string}` =>
    isAddress(a) ? getAddress(a) : (() => {
      throw new ContractRegistryError(`invalid address ${a}`, "forbidden");
    })();

  return {
    async register(input, ownerWallet) {
      const address = normalize(input.address);
      if (input.chainId !== deps.chainId) {
        throw new ContractRegistryError(
          `chainId ${input.chainId} != server chain ${deps.chainId}`,
          "forbidden",
        );
      }
      const existing = deps.store.get(address, input.chainId);
      if (existing) {
        if (existing.ownerWallet.toLowerCase() !== ownerWallet.toLowerCase()) {
          throw new ContractRegistryError(
            "contract already registered by another wallet",
            "forbidden",
          );
        }
        return existing; // idempotent re-register
      }
      const probe = await probeErc8183(deps.read, address);
      if (!probe.ok) {
        throw new ContractRegistryError(
          `contract probe failed: ${probe.error}`,
          "probe-failed",
        );
      }
      const rec: EaasContract = {
        address,
        chainId: input.chainId,
        ownerWallet,
        active: true,
        probedAt: now(),
        ...(probe.variant ? { variant: probe.variant } : {}),
        ...(input.terms ? { terms: input.terms } : {}),
      };
      deps.store.put(rec);
      return rec;
    },

    get: (address, chainId) =>
      deps.store.get(normalize(address), chainId),

    remove(address, chainId, ownerWallet) {
      const rec = deps.store.get(normalize(address), chainId);
      if (!rec) {
        throw new ContractRegistryError("contract not registered", "not-found");
      }
      if (rec.ownerWallet.toLowerCase() !== ownerWallet.toLowerCase()) {
        throw new ContractRegistryError("only the registrant may remove", "forbidden");
      }
      deps.store.remove(rec.address, chainId);
      return { ...rec, active: false };
    },

    list: (owner) => deps.store.list(owner),
  };
}
