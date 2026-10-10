/**
 * SLICE-184-2 (EPIC-184): self-serve registration pipeline.
 *
 *   validate input → buildAgentUri (EIP-8004 registration-v1 data-URI,
 *   ≤2KB) → mint (registerMirror on canonical registry) → issueApiKey →
 *   persist record (keyHash only) → return {record, apiKey} once.
 *
 * Mint failure throws RegistrationError("execution_failed") — NO record is
 * written, NO fake agentId (181 honest-refusal contract).
 */
import type { CacheProvider } from "@agentbadge/cache";
import { getAddress } from "viem";
import { issueApiKey } from "./api-keys";
import type { AgentRegistration, AgentRegistrationStore } from "./store";

export interface RegisterInput {
  name: string;
  endpoint?: string;
  capabilities?: string[];
  description?: string;
  /**
   * SLICE-184-5: user EOA that will own the ERC-8004 NFT (sponsored
   * mint+transfer path). Absent = treasury custody (legacy behavior).
   */
  owner?: `0x${string}`;
}

/** `registerMirror` result — injected so tests can stub the chain mint. */
export type MintFn = (
  agentUri: string,
) => Promise<{ agentId: bigint; txHash: `0x${string}` }>;

/**
 * SLICE-184-5 sponsored relayer: mint via treasury signer then
 * transferFrom(ops → owner) — user needs no USDC. Both tx hashes
 * are returned for the record + cost audit.
 */
export type SponsoredMintFn = (
  agentUri: string,
  owner: `0x${string}`,
) => Promise<{
  agentId: bigint;
  txHash: `0x${string}`;
  ownerTxHash: `0x${string}`;
}>;

export interface RegisterDeps {
  store: AgentRegistrationStore;
  mint: MintFn;
  /** Required to honor input.owner; wired when REGISTER_SPONSORED=1. */
  sponsoredMint?: SponsoredMintFn;
  /** Chain id embedded in the CAIP-style agentId (eip155:<id>:registry:token). */
  chainId: number;
  registryAddress: `0x${string}`;
}

export class RegistrationError extends Error {
  constructor(
    message: string,
    readonly code:
      | "invalid_input"
      | "execution_failed"
      | "uri_too_large" = "execution_failed",
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "RegistrationError";
  }
}

/* --------------------------- validation ------------------------------- */

const NAME_MAX = 80;
const ENDPOINT_MAX = 200;
const CAP_MAX = 12;
const CAP_ITEM_MAX = 40;
const AGENT_URI_LIMIT = 2048;

function validateInput(input: RegisterInput): RegisterInput {
  const name = (input.name ?? "").trim();
  if (!name || name.length > NAME_MAX) {
    throw new RegistrationError(
      `name required (1..${NAME_MAX} chars)`,
      "invalid_input",
    );
  }
  let endpoint: string | undefined;
  if (input.endpoint !== undefined && input.endpoint !== "") {
    const ep = input.endpoint.trim();
    if (ep.length > ENDPOINT_MAX || !/^https?:\/\//.test(ep)) {
      throw new RegistrationError(
        `endpoint must be http(s) and <= ${ENDPOINT_MAX} chars`,
        "invalid_input",
      );
    }
    endpoint = ep;
  }
  let capabilities: string[] | undefined;
  if (input.capabilities !== undefined) {
    if (!Array.isArray(input.capabilities)) {
      throw new RegistrationError(
        "capabilities must be an array",
        "invalid_input",
      );
    }
    const clean = input.capabilities
      .map((cap) => String(cap).trim())
      .filter(Boolean)
      .slice(0, CAP_MAX);
    if (clean.some((cap) => cap.length > CAP_ITEM_MAX)) {
      throw new RegistrationError(
        `capability entries <= ${CAP_ITEM_MAX} chars`,
        "invalid_input",
      );
    }
    capabilities = clean.length ? clean : undefined;
  }
  const description = input.description?.trim() || undefined;
  let owner: `0x${string}` | undefined;
  if (input.owner !== undefined) {
    if (!/^0x[0-9a-fA-F]{40}$/.test(input.owner))
      throw new RegistrationError("owner must be a 0x EOA address", "invalid_input");
    owner = getAddress(input.owner);
  }
  return { name, endpoint, capabilities, description, owner };
}

/* --------------------------- agentURI builder -------------------------- */

/**
 * EIP-8004 registration-file JSON → data-URI (v1; IPFS variant later — O2).
 * Fits ≤2KB on-chain; when oversized, fields are dropped in order:
 * description → capabilities → endpoint, marked via `truncated`.
 */
export function buildAgentUri(input: RegisterInput): string {
  const build = (desc?: string, caps?: string[], ep?: string) => {
    const dropped: string[] = [];
    if (input.description && desc === undefined) dropped.push("description");
    if (input.capabilities?.length && caps === undefined)
      dropped.push("capabilities");
    if (input.endpoint && ep === undefined) dropped.push("endpoint");
    return JSON.stringify({
      type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
      name: input.name,
      ...(desc ? { description: desc } : {}),
      services: [{ name: "agent", endpoint: ep ?? "", version: "1" }],
      active: true,
      x402Support: true,
      ...(caps?.length ? { capabilities: caps } : {}),
      ...(dropped.length ? { truncated: dropped } : {}),
    });
  };
  const toUri = (j: string) =>
    `data:application/json;base64,${Buffer.from(j, "utf8").toString("base64")}`;

  let uri = toUri(
    build(input.description, input.capabilities, input.endpoint),
  );
  if (uri.length <= AGENT_URI_LIMIT) return uri;

  // Progressive shedding — landmine guard (spec: ≤2KB).
  uri = toUri(build(undefined, input.capabilities, input.endpoint));
  if (uri.length <= AGENT_URI_LIMIT) return uri;
  uri = toUri(build(undefined, undefined, input.endpoint));
  if (uri.length <= AGENT_URI_LIMIT) return uri;
  uri = toUri(build(undefined, undefined, undefined));
  if (uri.length > AGENT_URI_LIMIT) {
    throw new RegistrationError(
      `registration metadata exceeds ${AGENT_URI_LIMIT} bytes`,
      "uri_too_large",
    );
  }
  return uri;
}

/* ------------------------- daily rate limiter --------------------------- */

/**
 * Daily-UTC cap bucket `<prefix>:<tag>:<day>` — shared across replicas,
 * resets at UTC day boundary (48h TTL covers the trailing edge).
 * In-memory fallback when no cache — an ops-level throttle, not a hard
 * security boundary (honest-zero reputation is the real disincentive).
 * Fail-open on backend error (incr returns 0 → allowed), per EPIC-144
 * passthrough contract.
 */
export function createDailyBucket(
  prefix: string,
  limit: number,
  cache?: CacheProvider | null,
) {
  const fallback = new Map<string, number>();
  const TTL_SEC = 48 * 3600;
  const day = () => new Date().toISOString().slice(0, 10); // UTC yyyy-mm-dd
  return {
    async allow(tag: string): Promise<boolean> {
      const key = `${prefix}:${tag}:${day()}`;
      if (!cache) {
        const n = (fallback.get(key) ?? 0) + 1;
        fallback.set(key, n);
        return n <= limit;
      }
      const n = await cache.incr(key, TTL_SEC).catch(() => 0);
      if (n === 0) return true; // backend down → fail-open
      return n <= limit;
    },
  };
}

/** Per-IP daily registration cap (sybil guard, D-184-7): regcap:<ip>:<day>. */
export function createDailyLimiter(limit: number, cache?: CacheProvider | null) {
  return createDailyBucket("regcap", limit, cache);
}

/* ------------------------------ pipeline -------------------------------- */

export interface RegisterResult {
  record: AgentRegistration;
  /** Shown ONCE — never persisted, never logged. */
  apiKey: string;
  agentUri: string;
}

export async function registerAgent(
  deps: RegisterDeps,
  input: RegisterInput,
): Promise<RegisterResult> {
  const validated = validateInput(input);
  const agentUri = buildAgentUri(validated);

  // SLICE-184-5: owner present → treasury-paid mint+transfer relayer.
  // Callers must guarantee deps.sponsoredMint exists before allowing
  // owner through (route rejects 400 when sponsored is off).
  if (validated.owner && !deps.sponsoredMint)
    throw new RegistrationError("sponsored registration unavailable", "execution_failed");

  let minted: { agentId: bigint; txHash: `0x${string}` };
  let ownerTxHash: `0x${string}` | undefined;
  if (validated.owner) {
    const m = await deps.sponsoredMint!(agentUri, validated.owner).catch((e) => {
      throw new RegistrationError(
        "ERC-8004 sponsored mint failed",
        "execution_failed",
        e,
      );
    });
    minted = m;
    ownerTxHash = m.ownerTxHash;
  } else {
    minted = await deps.mint(agentUri).catch((e) => {
      throw new RegistrationError(
        "ERC-8004 mint failed",
        "execution_failed",
        e,
      );
    });
  }

  const { key, keyHash } = issueApiKey();
  const record: AgentRegistration = {
    agentId: `eip155:${deps.chainId}:${deps.registryAddress}:${minted.agentId}`,
    registryAddress: deps.registryAddress,
    registryTx: minted.txHash,
    name: validated.name,
    ...(validated.endpoint ? { endpoint: validated.endpoint } : {}),
    keyHash,
    tier: "observer",
    status: "active",
    createdAt: Date.now(),
    ...(validated.owner
      ? { owner: validated.owner, sponsored: true, ownerTx: ownerTxHash }
      : {}),
  };
  await deps.store.put(record);
  return { record, apiKey: key, agentUri };
}
