/**
 * Agent wallet auth middleware (EPIC-137, SLICE-137-3).
 *
 * Replaces API keys for pro-bundle endpoints: the agent proves wallet
 * ownership by signing a timestamped challenge, then the server checks
 * AccessPassNFT.hasAccess(wallet, class) on Arc Testnet (cached).
 *
 * Headers:
 *   X-Wallet:    0x... EOA or contract wallet address
 *   X-Sig:       EIP-191 signature over the canonical challenge
 *   X-Timestamp: unix seconds (±300s skew window)
 *
 * Canonical challenge format:
 *   agentbadge-access:v1
 *   wallet:<lowercased address>
 *   method:<HTTP method>
 *   path:<route path>
 *   timestamp:<unix seconds>
 *
 * Signature verification: viem verifyMessage — EOA (local ecrecover),
 * ERC-1271 contract wallets and ERC-6492 counterfactual signatures via RPC (D12).
 */

import type { MiddlewareHandler } from "hono";
import { createPublicClient, http, isAddress } from "viem";
import { logger } from "@agentbadge/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

// ─── Class bits (mirror AccessPassNFT.sol) ─────────────────────
export const CLASS_MEDIUM = 1;
export const CLASS_HEAVY = 2;
export const CLASS_FULL = 4;

// ─── Challenge ─────────────────────────────────────────────────
export interface AccessChallengeParams {
  wallet: string;
  method: string;
  path: string;
  timestamp: number;
}

export function buildAccessChallenge(p: AccessChallengeParams): string {
  return [
    "agentbadge-access:v1",
    `wallet:${p.wallet.toLowerCase()}`,
    `method:${p.method.toUpperCase()}`,
    `path:${p.path}`,
    `timestamp:${p.timestamp}`,
  ].join("\n");
}

// ─── AccessPassNFT reader ──────────────────────────────────────
const ACCESS_PASS_ABI = [
  {
    name: "hasAccess",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "w", type: "address" },
      { name: "cls", type: "uint8" },
    ],
    outputs: [{ name: "", type: "bool" }],
  },
] as const;

export type HasAccessFn = (wallet: string, cls: number) => Promise<boolean>;
export type VerifyWalletSigFn = (
  wallet: string,
  message: string,
  signature: string,
) => Promise<boolean>;

let _client: ReturnType<typeof createPublicClient> | null = null;

function getClient() {
  if (_client) return _client;
  const rpcUrl =
    process.env.ARC_RPC_URL ?? "https://rpc.blockdaemon.testnet.arc.network";
  _client = createPublicClient({ transport: http(rpcUrl) });
  return _client;
}

/** On-chain hasAccess against deployed AccessPassNFT (Arc Testnet, D14). */
async function defaultHasAccess(wallet: string, cls: number): Promise<boolean> {
  const addr = process.env.ACCESS_PASS_NFT;
  if (!addr) {
    logger.warn("agent-auth: ACCESS_PASS_NFT not configured — denying access");
    return false;
  }
  try {
    return (await getClient().readContract({
      address: addr as `0x${string}`,
      abi: ACCESS_PASS_ABI,
      functionName: "hasAccess",
      args: [wallet as `0x${string}`, cls],
    })) as boolean;
  } catch (err) {
    logger.error("agent-auth: hasAccess RPC failed", { err: String(err) });
    return false; // fail closed
  }
}

/** viem verifyMessage — EOA local, ERC-1271/6492 via RPC (D12). */
async function defaultVerifyWalletSig(
  wallet: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    return await getClient().verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}

// ─── TTL cache for hasAccess ───────────────────────────────────
interface CacheEntry {
  value: boolean;
  expiresAt: number;
}

const _accessCache = new Map<string, CacheEntry>();
const DEFAULT_CACHE_TTL_MS = 60_000;

function cacheKey(wallet: string, cls: number): string {
  return `${wallet.toLowerCase()}:${cls}`;
}

// ─── Test overrides (mirrors did-auth.ts pattern) ──────────────
let _overrideVerifier: VerifyWalletSigFn | null = null;
let _overrideHasAccess: HasAccessFn | null = null;
let _cacheTtlMs = DEFAULT_CACHE_TTL_MS;

export function configureAgentAuthForTesting(config: {
  verifier?: VerifyWalletSigFn | null;
  hasAccess?: HasAccessFn | null;
  cacheTtlMs?: number;
}) {
  _overrideVerifier = config.verifier ?? null;
  _overrideHasAccess = config.hasAccess ?? null;
  _cacheTtlMs = config.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS;
  _accessCache.clear();
}

export function resetAgentAuthForTesting() {
  _overrideVerifier = null;
  _overrideHasAccess = null;
  _cacheTtlMs = DEFAULT_CACHE_TTL_MS;
  _accessCache.clear();
  _client = null;
}

async function checkAccess(wallet: string, cls: number): Promise<boolean> {
  const key = cacheKey(wallet, cls);
  const hit = _accessCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const fn = _overrideHasAccess ?? defaultHasAccess;
  const value = await fn(wallet, cls);
  _accessCache.set(key, { value, expiresAt: Date.now() + _cacheTtlMs });
  return value;
}

// ─── Middleware ────────────────────────────────────────────────
const MAX_SKEW_SECONDS = 300;

export interface AgentAuthVariables {
  agentWallet: string;
}

export type AccessPassCheck = "no-headers" | "granted" | "invalid" | "no-pass";

/**
 * checkAccessPassRequest — pass-check for the x402 `onProtectedRequest` hook.
 * Same verification as requireAccessPass but returns a result enum:
 * - "no-headers" → caller continues to the x402 payment flow
 * - "granted"    → valid signature + valid pass → grantAccess
 * - "invalid"    → malformed headers / stale timestamp / bad signature → abort
 * - "no-pass"    → valid signature but no pass → caller continues to payment (402)
 */
export type WalletSigCheck = "no-headers" | "invalid" | "valid";

/**
 * verifyWalletSigRequest — signature-only check (EPIC-138).
 * Same headers/challenge as checkAccessPassRequest but skips the
 * on-chain pass lookup — used by endpoints where the caller proves
 * wallet ownership without needing an access pass (passport mint,
 * service registration).
 */
export async function verifyWalletSigRequest(args: {
  wallet: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  method: string;
  path: string;
}): Promise<WalletSigCheck> {
  const { wallet, signature, timestamp: timestampRaw, method, path } = args;
  if (!wallet || !signature || !timestampRaw) return "no-headers";
  if (!isAddress(wallet)) return "invalid";
  const timestamp = Number(timestampRaw);
  if (!Number.isFinite(timestamp)) return "invalid";
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > MAX_SKEW_SECONDS) return "invalid";

  const message = buildAccessChallenge({ wallet, method, path, timestamp });
  const verifier = _overrideVerifier ?? defaultVerifyWalletSig;
  let valid = false;
  try {
    valid = await verifier(wallet, message, signature);
  } catch {
    valid = false;
  }
  return valid ? "valid" : "invalid";
}

export async function checkAccessPassRequest(args: {
  wallet: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  method: string;
  path: string;
  cls: number;
}): Promise<AccessPassCheck> {
  const { wallet, signature, timestamp: timestampRaw, method, path, cls } = args;
  const sig = await verifyWalletSigRequest({
    wallet,
    signature,
    timestamp: timestampRaw,
    method,
    path,
  });
  if (sig !== "valid") return sig === "no-headers" ? "no-headers" : "invalid";
  if (!wallet) return "no-headers"; // unreachable: valid sig implies wallet

  return (await checkAccess(wallet, cls)) ? "granted" : "no-pass";
}

/**
 * requireWalletSig — gate a route behind a valid wallet signature only
 * (no access-pass check). On success sets c.set("agentWallet", wallet).
 */
export function requireWalletSig(): MiddlewareHandler<{
  Variables: AgentAuthVariables;
}> {
  return async (c, next) => {
    const result = await verifyWalletSigRequest({
      wallet: c.req.header("x-wallet"),
      signature: c.req.header("x-sig"),
      timestamp: c.req.header("x-timestamp"),
      method: c.req.method,
      path: c.req.path,
    });
    if (result === "no-headers") {
      return errorResponse(
        c,
        401,
        ErrorCodes.MISSING_FIELDS,
        "Missing required headers: X-Wallet, X-Sig, X-Timestamp",
      );
    }
    if (result !== "valid") {
      return errorResponse(
        c,
        401,
        ErrorCodes.INVALID_INPUT,
        "Signature verification failed",
      );
    }
    c.set("agentWallet", c.req.header("x-wallet")!.toLowerCase());
    await next();
  };
}

/**
 * requireAccessPass(cls) — gate a route behind a valid access pass.
 * On success sets c.set("agentWallet", wallet).
 */
export function requireAccessPass(
  cls: number,
): MiddlewareHandler<{ Variables: AgentAuthVariables }> {
  return async (c, next) => {
    const wallet = c.req.header("x-wallet");
    const signature = c.req.header("x-sig");
    const timestampRaw = c.req.header("x-timestamp");

    if (!wallet || !signature || !timestampRaw) {
      return errorResponse(
        c,
        401,
        ErrorCodes.MISSING_FIELDS,
        "Missing required headers: X-Wallet, X-Sig, X-Timestamp",
      );
    }

    if (!isAddress(wallet)) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Invalid X-Wallet address");
    }

    const timestamp = Number(timestampRaw);
    if (!Number.isFinite(timestamp)) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Invalid X-Timestamp");
    }
    const nowSec = Math.floor(Date.now() / 1000);
    if (Math.abs(nowSec - timestamp) > MAX_SKEW_SECONDS) {
      return errorResponse(
        c,
        401,
        ErrorCodes.INVALID_INPUT,
        "X-Timestamp outside ±300s skew window",
      );
    }

    const message = buildAccessChallenge({
      wallet,
      method: c.req.method,
      path: c.req.path,
      timestamp,
    });

    const verifier = _overrideVerifier ?? defaultVerifyWalletSig;
    let valid = false;
    try {
      valid = await verifier(wallet, message, signature);
    } catch {
      valid = false;
    }
    if (!valid) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Signature verification failed");
    }

    const allowed = await checkAccess(wallet, cls);
    if (!allowed) {
      return errorResponse(
        c,
        402,
        ErrorCodes.PAYMENT_REQUIRED,
        "No valid access pass for this wallet and class — purchase via x402",
      );
    }

    c.set("agentWallet", wallet.toLowerCase());
    await next();
  };
}
