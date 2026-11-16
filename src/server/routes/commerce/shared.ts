/**
 * SLICE-224-3 (EPIC-224): shared helpers + zod schemas for the
 * commerce route files (tasks/offers/flows).
 */

import { isAddress } from "viem";
import { createHash } from "node:crypto";
import type { Context } from "hono";
import { verifyWalletSignature } from "../../middleware/agent-auth";
import { IdempotencyConflictError } from "../../lib/contract-guards";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes, type ErrorCode } from "../../lib/error-codes";
import { CommerceError } from "../../lib/commerce";

// ─── Signed-request auth (SLICE-224-6 / H2) ─────────────────────
//
// v2 challenge binds the signature to the exact request body hash and
// the idempotency key, under a commerce-specific domain separator — a
// signature captured from another AgentBadge surface (or another body
// on this surface) no longer verifies.
//
//   agentbadge-commerce:v2
//   wallet:<lowercased>
//   method:<METHOD>
//   path:<path>
//   timestamp:<unix seconds>
//   bodyHash:<sha256(raw body, "-" when empty)>
//   idemKey:<key or "-">
//   aud:agentbadge-commerce-api

const MAX_SKEW_SECONDS = 300;
const RAW_BODY_KEY = "commerce.rawBody";
const BODY_HASH_KEY = "commerce.bodyHash";

export const sha256Hex = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

/** Read the raw request body exactly once and cache it on the context. */
async function ensureRawBody(c: Context): Promise<string> {
  const cached = c.get(RAW_BODY_KEY);
  if (typeof cached === "string") return cached;
  const raw = await c.req.raw.text();
  c.set(RAW_BODY_KEY, raw);
  c.set(BODY_HASH_KEY, raw.length ? sha256Hex(raw) : "-");
  return raw;
}

export interface SignedWalletParams {
  wallet: string;
  method: string;
  path: string;
  timestamp: number;
  nonce: string;
  bodyHash: string;
  idemKey: string;
}

export function buildCommerceChallenge(p: SignedWalletParams): string {
  return [
    "agentbadge-commerce:v2",
    `wallet:${p.wallet.toLowerCase()}`,
    `method:${p.method.toUpperCase()}`,
    `path:${p.path}`,
    `timestamp:${p.timestamp}`,
    `nonce:${p.nonce}`,
    `bodyHash:${p.bodyHash}`,
    `idemKey:${p.idemKey}`,
    "aud:agentbadge-commerce-api",
  ].join("\n");
}

/**
 * Replay guard: an identical signed request (same wallet/method/path/
 * timestamp/signature) seen twice within the timestamp skew window is a
 * replay — first execution wins. Scoped per request fingerprint so the
 * same signature on a different request is NOT rejected (a wallet may
 * legitimately reuse keys/signatures across distinct bodies).
 */
const _seen = new Map<string, number>();
const REPLAY_TTL_MS = MAX_SKEW_SECONDS * 1000 * 2;
const REPLAY_MAX = 50_000;

function isReplay(key: string): boolean {
  const now = Date.now();
  const at = _seen.get(key);
  if (at !== undefined && now - at < REPLAY_TTL_MS) return true;
  if (_seen.size >= REPLAY_MAX) {
    // FIFO evict (Map insertion order) — bounded memory.
    _seen.delete(_seen.keys().next().value!);
  }
  _seen.set(key, now);
  return false;
}

/** Test seam — clears the replay cache. */
export function resetCommerceReplayCache(): void {
  _seen.clear();
}

type WalletCheck =
  | { ok: true; wallet: string }
  | { ok: false; status: 400 | 401 | 409; code: ErrorCode; message: string };

interface SignedWalletOpts {
  /** Exempt requests carrying an idempotency_key from the nonce
   *  replay guard (default true — store-level dedupe resolves
   *  them). Pass false where no dedupe exists (audit H-2). */
  allowIdemReplay?: boolean;
}

async function checkSignedWallet(
  c: Context,
  opts: SignedWalletOpts = {},
): Promise<WalletCheck> {
  const wallet = c.req.header("x-wallet");
  const signature = c.req.header("x-sig");
  const timestampRaw = c.req.header("x-timestamp");
  const nonce = c.req.header("x-nonce");
  if (!wallet || !signature || !timestampRaw || !nonce) {
    return {
      ok: false,
      status: 401,
      code: ErrorCodes.WRONG_SIGNER,
      message: "valid X-Wallet/X-Sig/X-Timestamp/X-Nonce required",
    };
  }
  // Malformed idempotency_key must not reach the dedupe rails — it is
  // part of the challenge, so reject at the gate with a 400.
  const idemHeader = c.req.header(IDEM_HEADER);
  if (idemHeader !== undefined && !IDEM_KEY_RE.test(idemHeader)) {
    return {
      ok: false,
      status: 400 as 401,
      code: ErrorCodes.INVALID_INPUT,
      message: "idempotency_key must match [A-Za-z0-9_-]{8,128}",
    };
  }
  if (
    !isAddress(wallet) ||
    !/^\d{1,13}$/.test(timestampRaw) ||
    !/^[A-Za-z0-9_-]{8,128}$/.test(nonce)
  ) {
    return {
      ok: false,
      status: 401,
      code: ErrorCodes.WRONG_SIGNER,
      message: "valid X-Wallet/X-Sig/X-Timestamp/X-Nonce required",
    };
  }
  const timestamp = Number(timestampRaw);
  const nowSec = Math.floor(Date.now() / 1000);
  if (Math.abs(nowSec - timestamp) > MAX_SKEW_SECONDS) {
    return {
      ok: false,
      status: 401,
      code: ErrorCodes.WRONG_SIGNER,
      message: "timestamp outside ±300s skew window",
    };
  }

  await ensureRawBody(c);
  const bodyHash = c.get(BODY_HASH_KEY) as string;
  const message = buildCommerceChallenge({
    wallet,
    method: c.req.method,
    path: c.req.path,
    timestamp,
    nonce,
    bodyHash,
    idemKey: idemKey(c) ?? "-",
  });
  if (!(await verifyWalletSignature(wallet, message, signature))) {
    return {
      ok: false,
      status: 401,
      code: ErrorCodes.WRONG_SIGNER,
      message: "signature does not verify against the v2 challenge",
    };
  }
  // Replay = a nonce already used on this scope (audit H-2).
  const replayKey = [
    wallet.toLowerCase(),
    c.req.method.toUpperCase(),
    c.req.path,
    nonce,
  ].join("|");
  if (
    (opts.allowIdemReplay === false || idemKey(c) === undefined) &&
    isReplay(replayKey)
  ) {
    return {
      ok: false,
      status: 409,
      code: ErrorCodes.CONFLICT,
      message: "replayed signed request",
    };
  }
  return { ok: true, wallet: wallet.toLowerCase() };
}

/** EIP-191 sig gate for writes — lowercase wallet or 400/401/409. */
export async function requireWallet(
  c: Context,
  opts: SignedWalletOpts = {},
): Promise<{ wallet: string } | Response> {
  const check = await checkSignedWallet(c, opts);
  if (!check.ok) {
    return errorResponse(
      c,
      check.status,
      check.code,
      check.message,
    );
  }
  return { wallet: check.wallet };
}

/** Optional auth for reads: verifies headers when present,
 *  returns null when none. */
export async function scopedWallet(c: Context): Promise<string | null | Response> {
  const any =
    c.req.header("x-wallet") ?? c.req.header("x-sig") ?? c.req.header("x-timestamp");
  if (!any) return null;
  const check = await checkSignedWallet(c);
  if (!check.ok) {
    return errorResponse(c, check.status, check.code, check.message);
  }
  return check.wallet;
}

export const IDEM_HEADER = "idempotency_key";

export function idemKey(c: Context): string | undefined {
  return c.req.header(IDEM_HEADER) ?? undefined;
}

/** Contract-guard shape for the idempotency header (audit H-2). */
export const IDEM_KEY_RE = /^[A-Za-z0-9_-]{8,128}$/;

/** sha256 of the raw request body — binds idempotentWrite to body content. */
export async function requestFingerprint(c: Context): Promise<string> {
  await ensureRawBody(c);
  return c.get(BODY_HASH_KEY) as string;
}

/** H4: payload is opaque per-entity private data — non-parties never see it. */
export function redactRow<T extends { payload: unknown }>(
  row: T,
  parties: readonly (string | null | undefined)[],
  viewer: string | null,
  sensitiveFields: readonly (keyof T)[] = [],
): T {
  if (viewer !== null && parties.includes(viewer)) return row;
  const redacted = { ...row, payload: null };
  for (const field of sensitiveFields) {
    (redacted as Record<string, unknown>)[field as string] = null;
  }
  return redacted;
}

export async function readJson(
  c: Context,
): Promise<Record<string, unknown> | Response> {
  try {
    const raw = await ensureRawBody(c);
    const body = JSON.parse(raw || "null") as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "JSON object body required");
    }
    return body as Record<string, unknown>;
  } catch {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
  }
}

/** Map CommerceError → canonical error shape; rethrows unknown errors. */
export function commerceError(c: Context, err: unknown): Response {
  if (err instanceof IdempotencyConflictError) {
    return errorResponse(c, 409, ErrorCodes.CONFLICT, err.message);
  }
  if (err instanceof CommerceError) {
    switch (err.code) {
      case "NOT_FOUND":
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, err.message);
      case "FORBIDDEN":
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER, err.message);
      case "INVALID_TRANSITION":
        return errorResponse(c, 409, ErrorCodes.INVALID_TRANSITION, err.message);
      case "GUARD_REJECTED":
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, err.message);
      case "CONFLICT":
        return errorResponse(c, 409, ErrorCodes.CONFLICT, err.message);
    }
  }
  throw err;
}

