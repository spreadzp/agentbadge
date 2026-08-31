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

import type { MiddlewareHandler, Context } from "hono";
import { createHash, randomBytes } from "node:crypto";
import { didToAccountId } from "@agentbadge/hedera-core";
import { logger } from "@agentbadge/passport";
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

// ─── Test Overrides ──────────────────────────────────────────────

let _overrideVerifier: VerifySignatureFn | null = null;
let _overrideNonceStore: NonceStore | null = null;
const _defaultNonceStore = new NonceStore();

export function configureDidAuthForTesting(config: {
  verifier?: VerifySignatureFn | null;
  nonceStore?: NonceStore | null;
}) {
  _overrideVerifier = config.verifier ?? null;
  _overrideNonceStore = config.nonceStore ?? null;
}

// ─── Middleware ──────────────────────────────────────────────────

export interface RequireDidSignatureOptions {
  verifySignature?: VerifySignatureFn;
  nonceStore?: NonceStore;
  maxSkewSeconds?: number;
}

/** Known actor field names in mutation bodies */
const ACTOR_FIELDS = ["posterDid", "claimerDid", "from"] as const;

export type DidAuthMode = "off" | "warn" | "enforce";

export function getDidAuthMode(): DidAuthMode {
  const mode = process.env.DID_AUTH_MODE ?? "enforce";
  if (mode === "off" || mode === "warn" || mode === "enforce") return mode;
  return "enforce";
}

export function requireDidSignature(
  opts: RequireDidSignatureOptions = {},
): MiddlewareHandler {
  const maxSkew = opts.maxSkewSeconds ?? 300;

  return async (c, next) => {
    // Skip non-mutation methods
    if (c.req.method === "GET" || c.req.method === "HEAD") {
      await next();
      return;
    }

    // Skip -with-key convenience endpoints (reserved for EPIC-83)
    if (c.req.path.includes("-with-key")) {
      await next();
      return;
    }

    const mode = getDidAuthMode();

    // Mode: off — passthrough, no verification
    if (mode === "off") {
      await next();
      return;
    }

    // Resolve nonce store and verifier per-request (allows test overrides)
    const nonceStore = opts.nonceStore ?? _overrideNonceStore ?? _defaultNonceStore;
    const verifySig = opts.verifySignature ?? _overrideVerifier ?? defaultVerifySignature;

    const sig = c.req.header("X-AgentBadge-Signature");
    const tsStr = c.req.header("X-AgentBadge-Timestamp");
    const nonce = c.req.header("X-AgentBadge-Nonce");
    const did = c.req.header("X-AgentBadge-Did");

    // Mode: warn — allow unsigned through with warning header
    if (mode === "warn" && (!sig || !tsStr || !nonce || !did)) {
      const warnDate = new Date();
      warnDate.setDate(warnDate.getDate() + 14);
      c.header("X-AgentBadge-Auth-Warn", `required-after-${warnDate.toISOString().slice(0, 10)}`);
      logger.warn("DID-AUTH-WARN: unsigned mutation", { method: c.req.method, path: c.req.path });
      await next();
      return;
    }

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
      if (mode === "warn") {
        const warnDate = new Date();
        warnDate.setDate(warnDate.getDate() + 14);
        c.header("X-AgentBadge-Auth-Warn", `required-after-${warnDate.toISOString().slice(0, 10)}`);
        logger.warn("DID-AUTH-WARN: timestamp skew", { method: c.req.method, path: c.req.path });
        await next();
        return;
      }
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Timestamp outside allowed skew window");
    }

    // Nonce single-use
    if (!nonceStore.consume(nonce)) {
      if (mode === "warn") {
        const warnDate = new Date();
        warnDate.setDate(warnDate.getDate() + 14);
        c.header("X-AgentBadge-Auth-Warn", `required-after-${warnDate.toISOString().slice(0, 10)}`);
        logger.warn("DID-AUTH-WARN: invalid nonce", { method: c.req.method, path: c.req.path });
        await next();
        return;
      }
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
      if (mode === "warn") {
        const warnDate = new Date();
        warnDate.setDate(warnDate.getDate() + 14);
        c.header("X-AgentBadge-Auth-Warn", `required-after-${warnDate.toISOString().slice(0, 10)}`);
        logger.warn("DID-AUTH-WARN: DID not resolved", { method: c.req.method, path: c.req.path, did });
        // Re-inject body for downstream handlers
        (c.req as unknown as { rawBody: string }).rawBody = rawBody;
        c.req.json = (async () => (rawBody ? JSON.parse(rawBody) : {})) as typeof c.req.json;
        c.req.text = (async () => rawBody) as typeof c.req.text;
        c.req.arrayBuffer = (async () => {
          const enc = new TextEncoder();
          return enc.encode(rawBody).buffer as ArrayBuffer;
        }) as typeof c.req.arrayBuffer;
        await next();
        return;
      }
      return errorResponse(c, 401, ErrorCodes.PASSPORT_NOT_FOUND, "DID does not resolve to an account");
    }

    // Verify signature
    const valid = await verifySig(challenge, sig, accountId);
    if (!valid) {
      if (mode === "warn") {
        const warnDate = new Date();
        warnDate.setDate(warnDate.getDate() + 14);
        c.header("X-AgentBadge-Auth-Warn", `required-after-${warnDate.toISOString().slice(0, 10)}`);
        logger.warn("DID-AUTH-WARN: signature invalid", { method: c.req.method, path: c.req.path, did });
        // Re-inject body for downstream handlers
        (c.req as unknown as { rawBody: string }).rawBody = rawBody;
        c.req.json = (async () => (rawBody ? JSON.parse(rawBody) : {})) as typeof c.req.json;
        c.req.text = (async () => rawBody) as typeof c.req.text;
        c.req.arrayBuffer = (async () => {
          const enc = new TextEncoder();
          return enc.encode(rawBody).buffer as ArrayBuffer;
        }) as typeof c.req.arrayBuffer;
        await next();
        return;
      }
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

// ─── Actor Assertion Helper ──────────────────────────────────────

export function assertSameActor(c: Context, actorDid: string | undefined): Response | null {
  const verifiedDid = c.get("verifiedDid") as string | undefined;
  if (!verifiedDid) {
    // When auth is off, verifiedDid is never set — skip ownership check
    if (getDidAuthMode() === "off") return null;
    return errorResponse(c, 401, ErrorCodes.MISSING_FIELDS, "No verified DID found in context");
  }
  if (actorDid !== verifiedDid) {
    return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH, `Actor DID does not match verified DID`);
  }
  return null;
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
 *   GET {mirrorBase}/api/v1/accounts/{accountId}
 *
 * The signature is expected to be a hex-encoded Ed25519 or ECDSA signature
 * over the raw challenge bytes (NOT EIP-191 prefixed).
 */
async function defaultVerifySignature(
  challenge: string,
  signature: string,
  accountId: string,
): Promise<boolean> {
  const mirrorBase = process.env.HEDERA_NETWORK === "mainnet"
    ? "https://mainnet.mirrornode.hedera.com"
    : "https://testnet.mirrornode.hedera.com";

  try {
    const resp = await fetch(`${mirrorBase}/api/v1/accounts/${accountId}`);
    if (!resp.ok) return false;

    const data = await resp.json() as {
      keys?: Array<{ _type: string; key: string }>;
      key?: { _type: string; key: string };
    };

    // Mirror Node returns either a single key or an array of keys
    const keys = data.keys ?? (data.key ? [data.key] : []);
    if (keys.length === 0) return false;

    const challengeBytes = new TextEncoder().encode(challenge);
    const sigHex = signature.startsWith("0x") ? signature.slice(2) : signature;
    const sigBytes = Buffer.from(sigHex, "hex");

    for (const keyInfo of keys) {
      const keyType = keyInfo._type;
      const pubKeyHex = keyInfo.key;

      try {
        if (keyType === "ED25519") {
          // Use @hashgraph/sdk for ED25519 verification
          const { PublicKey } = await import("@hashgraph/sdk");
          const pubKey = PublicKey.fromString(`302a300506032b6570032100${pubKeyHex}`);
          const verified = pubKey.verify(sigBytes, challengeBytes);
          if (verified) return true;
        } else if (keyType === "ECDSA_secp256k1") {
          // Use ethers for ECDSA verification (EIP-191 personal Sign)
          const { ethers } = await import("ethers");
          // ethers expects 0x-prefixed signature and recovers address
          const sig = `0x${sigHex}`;
          const recovered = ethers.verifyMessage(
            new TextEncoder().encode(challenge),
            ethers.Signature.from(sig),
          );
          // Recover the address from the public key
          const pubKey = `0x${pubKeyHex}`;
          const expectedAddr = ethers.computeAddress(pubKey);
          if (recovered.toLowerCase() === expectedAddr.toLowerCase()) return true;
        }
      } catch {
        // Key type mismatch or verification error — try next key
        continue;
      }
    }

    return false;
  } catch {
    return false;
  }
}
