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
import { issueApiKey } from "./api-keys";
import type { AgentRegistration, AgentRegistrationStore } from "./store";

export interface RegisterInput {
  name: string;
  endpoint?: string;
  capabilities?: string[];
  description?: string;
}

/** `registerMirror` result — injected so tests can stub the chain mint. */
export type MintFn = (
  agentUri: string,
) => Promise<{ agentId: bigint; txHash: `0x${string}` }>;

export interface RegisterDeps {
  store: AgentRegistrationStore;
  mint: MintFn;
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
  return { name, endpoint, capabilities, description };
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
 * Rolling-24h per-key counter (registration sybil guard, D-184-7).
 * In-memory on purpose — an ops-level throttle, not a hard security boundary
 * (honest-zero reputation is the real disincentive). Key = client IP.
 */
export function createDailyLimiter(limit: number) {
  const hits = new Map<string, number[]>();
  const DAY = 86_400_000;
  return {
    allow(key: string): boolean {
      const now = Date.now();
      const arr = (hits.get(key) ?? []).filter((t) => now - t < DAY);
      if (arr.length >= limit) {
        hits.set(key, arr);
        return false;
      }
      arr.push(now);
      hits.set(key, arr);
      return true;
    },
  };
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

  const minted = await deps.mint(agentUri).catch((e) => {
    throw new RegistrationError(
      "ERC-8004 mint failed",
      "execution_failed",
      e,
    );
  });

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
  };
  await deps.store.put(record);
  return { record, apiKey: key, agentUri };
}
