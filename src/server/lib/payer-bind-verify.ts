/**
 * Payer-binding signature verification plumbing (EPIC-171, SLICE-171-2).
 *
 * viem `verifyMessage` — EOA recovered locally, ERC-1271 contract
 * wallets and ERC-6492 counterfactual signatures verified via RPC
 * (same approach as middleware/agent-auth.ts). Results are cached by
 * wallet+challenge+sig prefix for 60s so contract-wallet checks never
 * hit the RPC on every paid request.
 */

import { createPublicClient, http } from "viem";

export type VerifyPayerSigFn = (
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

async function defaultVerifyPayerSig(
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

// ─── Sig-result cache ────────────────────────────────────────────
interface SigCacheEntry {
  value: boolean;
  expiresAt: number;
}
const SIG_CACHE_TTL_MS = 60_000;
const SIG_CACHE_MAX = 512;
const _sigCache = new Map<string, SigCacheEntry>();

export async function verifyPayerSigCached(
  verifier: VerifyPayerSigFn,
  wallet: string,
  message: string,
  signature: string,
): Promise<boolean> {
  const key = `${wallet.toLowerCase()}:${message}:${signature.slice(0, 42)}`;
  const hit = _sigCache.get(key);
  if (hit && hit.expiresAt > Date.now()) return hit.value;
  let value = false;
  try {
    value = await verifier(wallet, message, signature);
  } catch {
    value = false;
  }
  if (_sigCache.size >= SIG_CACHE_MAX) _sigCache.clear();
  _sigCache.set(key, { value, expiresAt: Date.now() + SIG_CACHE_TTL_MS });
  return value;
}

// ─── Test overrides (mirrors agent-auth.ts pattern) ──────────────
let _overrideVerifier: VerifyPayerSigFn | null = null;
let _overrideEnabled: (() => boolean) | null = null;

export function configurePayerBindingForTesting(config: {
  verifier?: VerifyPayerSigFn | null;
  enabled?: (() => boolean) | null;
}) {
  _overrideVerifier = config.verifier ?? null;
  _overrideEnabled = config.enabled ?? null;
  _sigCache.clear();
}

export function resetPayerBindingForTesting() {
  _overrideVerifier = null;
  _overrideEnabled = null;
  _sigCache.clear();
  _client = null;
}

/** Resolve the verifier: test override > per-middleware option > RPC. */
export function resolveVerifier(
  opt?: VerifyPayerSigFn,
): VerifyPayerSigFn {
  return _overrideVerifier ?? opt ?? defaultVerifyPayerSig;
}

/** Resolve the enabled gate: test override > per-middleware option. */
export function resolveEnabled(opt?: () => boolean): (() => boolean) | null {
  return _overrideEnabled ?? opt ?? null;
}
