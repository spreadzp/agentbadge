/**
 * DID-control challenge + signature middleware (EPIC-82 SLICE-82-1).
 *
 * Canonical challenge format:
 *   agentbadge-action:v1
 *   did:<did>
 *   method:<HTTP method>
 *   path:<route path>
 *   body_sha256:<hex sha256 of raw body, or sha256 of empty string>
 *   timestamp:<unix seconds>
 *   nonce:<16-byte random hex issued per request>
 *
 * The client signs the exact canonical byte string with its Hedera account key
 * (ED25519 or ECDSA). The server verifies the signature against the account
 * bound to the claimed DID.
 */

import type { MiddlewareHandler } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { didToAccountId } from "@agentgate-hedera/hedera-core";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

// ─── Challenge Builder ───────────────────────────────────────────

export interface ChallengeParams {
  did: string;
  method: string;
  path: string;
  body: string;
  timestamp: number;
  nonce: string;
}

export function hashBody(body: string): string {
  return createHash("sha256").update(body, "utf8").digest("hex");
}

export function buildChallenge(params: ChallengeParams): string {
  return [
    "agentbadge-action:v1",
    `did:${params.did}`,
    `method:${params.method}`,
    `path:${params.path}`,
    `body_sha256:${hashBody(params.body)}`,
    `timestamp:${params.timestamp}`,
    `nonce:${params.nonce}`,
  ].join("\n");
}

// ─── Nonce Store ─────────────────────────────────────────────────

export class NonceStore {
  private issued = new Set<string>();
  private consumed = new Set<string>();
  private ttlMs: number;

  constructor(ttlMs = 600_000) {
    this.ttlMs = ttlMs;
  }

  issue(): string {
    const nonce = randomBytes(16).toString("hex");
    this.issued.add(nonce);
    setTimeout(() => this.issued.delete(nonce), this.ttlMs);
    return nonce;
  }

  consume(nonce: string): boolean {
    if (!this.issued.has(nonce)) return false;
    if (this.consumed.has(nonce)) return false;
    this.consumed.add(nonce);
    setTimeout(() => this.consumed.delete(nonce), this.ttlMs);
    return true;
  }
}

// ─── Signature Verifier ──────────────────────────────────────────

export type VerifySignatureFn = (
  challenge: string,
  signature: string,
  accountId: string,
) => Promise<boolean>;

// ─── Middleware ──────────────────────────────────────────────────

export interface RequireDidSignatureOptions {
  verifySignature?: VerifySignatureFn;
  nonceStore?: NonceStore;
  maxSkewSeconds?: number;
}

/** Known actor field names in mutation bodies */
const ACTOR_FIELDS = ["posterDid", "claimerDid", "from"] as const;

export function requireDidSignature(
  opts: RequireDidSignatureOptions = {},
): MiddlewareHandler {
  const nonceStore = opts.nonceStore ?? new NonceStore();
  const maxSkew = opts.maxSkewSeconds ?? 300;
  const verifySig = opts.verifySignature ?? defaultVerifySignature;

  return async (c, next) => {
    // Skip non-mutation methods
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      await next();
      return;
    }

    const sig = c.req.header("X-AgentBadge-Signature");
    const tsStr = c.req.header("X-AgentBadge-Timestamp");
    const nonce = c.req.header("X-AgentBadge-Nonce");
    const did = c.req.header("X-AgentBadge-Did");

    if (!sig || !tsStr || !nonce || !did) {
      return errorResponse(
        c, 401, ErrorCodes.MISSING_FIELDS,
        "Missing required auth headers: X-AgentBadge-Signature, X-AgentBadge-Timestamp, X-AgentBadge-Nonce, X-AgentBadge-Did",
      );
    }

    // Timestamp freshness
    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Invalid timestamp format");
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > maxSkew) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Timestamp outside allowed skew window");
    }

    // Nonce single-use
    if (!nonceStore.consume(nonce)) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Nonce already used or invalid");
    }

    // Read body for hashing + ownership check
    let rawBody = "";
    try {
      rawBody = await c.req.text();
    } catch {
      // empty body is fine
    }

    // Reconstruct canonical challenge
    const challenge = buildChallenge({
      did,
      method: c.req.method,
      path: c.req.path,
      body: rawBody,
      timestamp: ts,
      nonce,
    });

    // Resolve DID → accountId
    const accountId = await didToAccountId(did);
    if (!accountId) {
      return errorResponse(c, 401, ErrorCodes.PASSPORT_NOT_FOUND, "DID does not resolve to an account");
    }

    // Verify signature
    const valid = await verifySig(challenge, sig, accountId);
    if (!valid) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Signature verification failed");
    }

    // Ownership check: verified DID must match actor field in body
    if (rawBody) {
      try {
        const bodyJson = JSON.parse(rawBody) as Record<string, unknown>;
        for (const field of ACTOR_FIELDS) {
          if (field in bodyJson) {
            if (bodyJson[field] !== did) {
              return errorResponse(
                c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
                `Verified DID does not match body field '${field}'`,
              );
            }
            break;
          }
        }
      } catch {
        // non-JSON body — skip ownership check
      }
    }

    // Re-inject body for downstream handlers
    c.set("verifiedDid", did);
    // Hono doesn't allow re-reading body, so we monkey-patch like existing middleware
    (c.req as unknown as { rawBody: string }).rawBody = rawBody;
    // Override .json() and .text() to return cached body
    const cached = rawBody;
    c.req.json = (async () => (cached ? JSON.parse(cached) : {})) as typeof c.req.json;
    c.req.text = (async () => cached) as typeof c.req.text;
    c.req.arrayBuffer = (async () => {
      const enc = new TextEncoder();
      return enc.encode(cached).buffer as ArrayBuffer;
    }) as typeof c.req.arrayBuffer;

    await next();
  };
}

// ─── Challenge Endpoint ──────────────────────────────────────────

export interface ChallengeHandlerOptions {
  nonceStore?: NonceStore;
}

export function challengeHandler(opts: ChallengeHandlerOptions = {}): MiddlewareHandler {
  const nonceStore = opts.nonceStore ?? new NonceStore();

  return async (c) => {
    const did = c.req.query("did");
    const method = c.req.query("method");
    const path = c.req.query("path");

    if (!did || !method || !path) {
      return errorResponse(
        c, 400, ErrorCodes.MISSING_FIELDS,
        "Missing required query params: did, method, path",
      );
    }

    const nonce = nonceStore.issue();
    const timestamp = Math.floor(Date.now() / 1000);

    const challenge = buildChallenge({
      did,
      method,
      path,
      body: "",
      timestamp,
      nonce,
    });

    return c.json({
      challenge,
      nonce,
      timestamp,
      algorithm: "EIP-191",
      instructions: "Sign the challenge string with your Hedera account key. Send the signature in X-AgentBadge-Signature header.",
    }, 200, {
      "Cache-Control": "no-store",
    });
  };
}

// ─── Default Verifier (Mirror Node key fetch) ────────────────────

/**
 * Default signature verifier.
 *
 * Fetches the account's public key from the Hedera Mirror Node and verifies
 * the signature. Supports both ECDSA (via ethers) and ED25519 (via Hedera SDK).
 *
 * In production, this makes a Mirror Node API call to:
 *   GET https://testnet.mirrornode.hedera.com/api/v1/accounts/{accountId}
 */
async function defaultVerifySignature(
  _challenge: string,
  _signature: string,
  _accountId: string,
): Promise<boolean> {
  // TODO: implement Mirror Node key fetch + verification
  // For now, this is a stub that will be replaced with real verification.
  // SLICE-82-1 Green Phase focuses on the middleware plumbing;
  // the actual key verification will use the same patterns as
  // verifyWalletOwnership from passport package.
  void _challenge;
  void _signature;
  void _accountId;
  throw new Error("defaultVerifySignature not yet implemented — provide verifySignature option");
}
