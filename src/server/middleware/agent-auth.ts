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
 *   X-Nonce:     random 8-128 chars (SLICE-234-21 replay binding)
 *
 * Canonical challenge format (v2 — SLICE-234-21 hard cut):
 *   agentbadge-access:v2
 *   wallet:<lowercased address>
 *   method:<HTTP method>
 *   path:<route path>
 *   timestamp:<unix seconds>
 *   nonce:<x-nonce>
 *   bodyHash:<sha256(raw body, "-" when empty)>
 *   aud:agentbadge-access-api
 *
 * v1 (wallet+method+path+timestamp) allowed captured signatures to be
 * replayed with a substituted body (raise spend caps, inject delegates).
 * The v2 challenge binds the exact body hash; the nonce + server-side
 * replay store reject re-submitted signed requests.
 *
 * Signature verification: viem verifyMessage — EOA (local ecrecover),
 * ERC-1271 contract wallets and ERC-6492 counterfactual signatures via RPC (D12).
 */

import type { Context, MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";
import { createPublicClient, http, isAddress } from "viem";
import { logger } from "@agentbadge/passport/logger";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

// ─── Class bits (mirror AccessPassNFT.sol) ─────────────────────
export const CLASS_MEDIUM = 1;
export const CLASS_HEAVY = 2;
export const CLASS_FULL = 4;
/** SLICE-154-5: EaaS subscription pass (mirror AccessPassNFT.sol). */
export const CLASS_EAAS = 8;

// ─── Challenge ─────────────────────────────────────────────────
const MAX_SKEW_SECONDS = 300;

export interface AccessChallengeParams {
  wallet: string;
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  bodyHash: string;
}

export function buildAccessChallenge(p: AccessChallengeParams): string {
  return [
    "agentbadge-access:v2",
    `wallet:${p.wallet.toLowerCase()}`,
    `method:${p.method.toUpperCase()}`,
    `path:${p.path}`,
    `timestamp:${p.timestamp}`,
    `nonce:${p.nonce}`,
    `bodyHash:${p.bodyHash}`,
    "aud:agentbadge-access-api",
  ].join("\n");
}

/** Context key for the cached raw-body hash (SLICE-234-21). Call
 *  `accessBodyHash(c)` BEFORE any c.req.json()/text() consumption and the
 *  hash survives for later sig checks. */
const ACCESS_BODY_HASH_KEY = "access.bodyHash";

/** SLICE-234-21: sha256 of the raw request body — binds the signature
 *  to the exact payload. Reads through c.req.text() (Hono bodyCache) so
 *  a downstream c.req.json() reuses the same bytes — raw.clone() was
 *  flaky under undici tee (intermittent "invalid JSON body" 400s).
 *  Empty body hashes to the "-" sentinel (same as commerce v2);
 *  "-" when the body is unreadable — fail-closed. */
export async function accessBodyHash(c: Context): Promise<string> {
  const cached = c.get(ACCESS_BODY_HASH_KEY) as string | undefined;
  if (cached) return cached;
  let raw = "";
  try {
    raw = await c.req.text(); // bodyCache → downstream json()/text() reuse
  } catch {
    raw = "";
  }
  const hash = raw.length
    ? createHash("sha256").update(raw).digest("hex")
    : "-";
  c.set(ACCESS_BODY_HASH_KEY, hash);
  return hash;
}

// ─── Replay guard (SLICE-234-21) ───────────────────────────────
// A (wallet, method, path, nonce) tuple already accepted once inside
// the timestamp skew window is a replay — same shape as the commerce
// v2 guard; kept local so routes can't bypass it via the v1 helpers.
const _seenNonces = new Map<string, number>();
const REPLAY_TTL_MS = MAX_SKEW_SECONDS * 1000 * 2;
const REPLAY_MAX = 50_000;

function isNonceReplay(key: string): boolean {
  const now = Date.now();
  const at = _seenNonces.get(key);
  if (at !== undefined && now - at < REPLAY_TTL_MS) return true;
  if (_seenNonces.size >= REPLAY_MAX) {
    _seenNonces.delete(_seenNonces.keys().next().value!); // FIFO evict
  }
  _seenNonces.set(key, now);
  return false;
}

const NONCE_RE = /^[A-Za-z0-9_-]{8,128}$/;

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
  // M5: never expose the crypto-verifier test seam in production.
  if (process.env.NODE_ENV === "production") {
    throw new Error("configureAgentAuthForTesting is not available in production");
  }
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
  _seenNonces.clear();
  _client = null;
}

export async function checkAccess(wallet: string, cls: number): Promise<boolean> {
  const key = cacheKey(wallet, cls);
  const hit = _accessCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;

  const fn = _overrideHasAccess ?? defaultHasAccess;
  const value = await fn(wallet, cls);
  _accessCache.set(key, { value, expiresAt: Date.now() + _cacheTtlMs });
  return value;
}

// ─── Middleware ────────────────────────────────────────────────
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
export type WalletSigCheck = "no-headers" | "invalid" | "valid" | "replay";

/**
 * verifyWalletSigRequest — signature-only check (EPIC-138, v2 in 234-21).
 * Same headers/challenge as checkAccessPassRequest but skips the
 * on-chain pass lookup — used by endpoints where the caller proves
 * wallet ownership without needing an access pass (passport mint,
 * service registration). Requires nonce + bodyHash (v2 challenge);
 * prefer verifySignedRequest(c) when a Context is available.
 */
export async function verifyWalletSigRequest(args: {
  wallet: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  bodyHash: string;
  method: string;
  path: string;
}): Promise<WalletSigCheck> {
  const { wallet, signature, timestamp: timestampRaw, nonce, bodyHash, method, path } = args;
  if (!wallet || !signature || !timestampRaw) return "no-headers";
  // 234-21: headers present but nonce missing/malformed = attempted
  // auth with weak creds → invalid (never "no-headers" pass-through).
  if (!nonce || !NONCE_RE.test(nonce)) return "invalid";
  if (!isAddress(wallet)) return "invalid";
  // M8: digits-only — Number() accepts '1e9', '0x…', '  42  ' etc.
  if (!/^\d{1,13}$/.test(timestampRaw)) return "invalid";
  const timestamp = Number(timestampRaw);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > MAX_SKEW_SECONDS) return "invalid";

  const message = buildAccessChallenge({ wallet, method, path, timestamp, nonce, bodyHash });
  if (!(await verifyWalletSignature(wallet, message, signature))) {
    return "invalid";
  }
  // 234-21: nonce already accepted on this wallet+method+path → replay.
  if (isNonceReplay([wallet.toLowerCase(), method.toUpperCase(), path, nonce].join("|"))) {
    return "replay";
  }
  return "valid";
}

/**
 * verifySignedRequest — canonical v2 gate: extracts X-Wallet/X-Sig/
 * X-Timestamp/X-Nonce headers and hashes the (cloned) raw body itself.
 * All v1 callers migrate here (SLICE-234-21).
 */
const SIG_OK_KEY = "access.sigOk";

export async function verifySignedRequest(c: Context): Promise<WalletSigCheck> {
  // Idempotent within one request: a second call (e.g. sigWallet then
  // requireVenueAccess on the same c) reuses the first verdict instead of
  // tripping the replay guard on the same nonce.
  if (c.get(SIG_OK_KEY)) return "valid";
  const result = await verifyWalletSigRequest({
    wallet: c.req.header("x-wallet"),
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    nonce: c.req.header("x-nonce"),
    bodyHash: await accessBodyHash(c),
    method: c.req.method,
    path: c.req.path,
  });
  if (result === "valid") c.set(SIG_OK_KEY, true);
  return result;
}

/**
 * Verify a signature over an arbitrary challenge string — the commerce
 * API signs a v2 challenge bound to the request body hash (H2). Reuses
 * the test override so e2e tests keep their deterministic verifier.
 */
export async function verifyWalletSignature(
  wallet: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const verifier = _overrideVerifier ?? defaultVerifyWalletSig;
  try {
    return await verifier(wallet, message, signature);
  } catch {
    return false;
  }
}

export async function checkAccessPassRequest(args: {
  wallet: string | undefined;
  signature: string | undefined;
  timestamp: string | undefined;
  nonce: string | undefined;
  bodyHash: string;
  method: string;
  path: string;
  cls: number;
}): Promise<AccessPassCheck> {
  const { wallet, signature, timestamp: timestampRaw, nonce, bodyHash, method, path, cls } = args;
  const sig = await verifyWalletSigRequest({
    wallet,
    signature,
    timestamp: timestampRaw,
    nonce,
    bodyHash,
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
    const result = await verifySignedRequest(c);
    if (result === "no-headers") {
      return errorResponse(
        c,
        401,
        ErrorCodes.MISSING_FIELDS,
        "Missing required headers: X-Wallet, X-Sig, X-Timestamp, X-Nonce",
      );
    }
    if (result === "replay") {
      return errorResponse(c, 409, ErrorCodes.CONFLICT, "replayed signed request");
    }
    if (result !== "valid") {
      return errorResponse(
        c,
        401,
        ErrorCodes.INVALID_INPUT,
        "Signature verification failed (v2 challenge: nonce + bodyHash required)",
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
    // 234-21: same v2 gate (nonce + bodyHash + replay) as requireWalletSig.
    const sig = await verifySignedRequest(c);
    if (sig === "no-headers") {
      return errorResponse(
        c,
        401,
        ErrorCodes.MISSING_FIELDS,
        "Missing required headers: X-Wallet, X-Sig, X-Timestamp, X-Nonce",
      );
    }
    if (sig === "replay") {
      return errorResponse(c, 409, ErrorCodes.CONFLICT, "replayed signed request");
    }
    if (sig !== "valid" || !wallet) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT,
        "Signature verification failed (v2 challenge: nonce + bodyHash required)");
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
