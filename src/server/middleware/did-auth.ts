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
import { didToAccountId } from "@agentbadge/hedera-core";
import { logger } from "@agentbadge/passport";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { NonceStore } from "./did-nonce";
import { buildChallenge } from "./did-challenge";
import { defaultVerifySignature, type VerifySignatureFn } from "./did-verify";

// Re-exports — consumers keep importing from "middleware/did-auth"
// (split into did-nonce/did-challenge/did-verify in SLICE-145-6, max-lines).
export { NonceStore } from "./did-nonce";
export {
  buildChallenge,
  challengeHandler,
  hashBody,
  type ChallengeHandlerOptions,
  type ChallengeParams,
} from "./did-challenge";
export { defaultVerifySignature, type VerifySignatureFn } from "./did-verify";

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
    if (!(await nonceStore.consume(nonce))) {
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
