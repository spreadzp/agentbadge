/**
 * Optional DID-signature verification (EPIC-259 SLICE-259-4).
 *
 * `requireDidSignature` enforces signed mutations on market/a2a routes;
 * surfaces like /mcp and /passport/:id/:serial/upgrade need the same
 * verified identity WITHOUT rejecting anonymous callers (public tools
 * must stay callable). This middleware is the enrichment variant:
 *
 *   - no X-AgentBadge-* headers at all → pass through (anonymous)
 *   - partial headers                  → 401 (don't silently downgrade
 *                                        a caller that tried to auth)
 *   - full headers, any failure        → 401 (bad sig is not "anon")
 *   - verified                         → c.set("verifiedDid", did)
 *
 * Unlike requireDidSignature there is no body actor-field check: the
 * JSON-RPC surface binds subjects inside tool arguments, and handlers
 * compare verifiedDid themselves (e.g. upgrade_tier matches the DID to
 * the target passport). The challenge still binds method+path+body, so
 * a signature cannot be replayed against a different route or payload.
 */

import type { MiddlewareHandler, Context } from "hono";
import { didToAccountId } from "@agentbadge/hedera-core";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { NonceStore } from "./did-nonce";
import { buildChallenge } from "./did-challenge";
import {
  defaultVerifySignature,
  type VerifySignatureFn,
} from "./did-verify";
import { didAuthTestOverrides } from "./did-auth";

const DID_HEADERS = [
  "X-AgentBadge-Signature",
  "X-AgentBadge-Timestamp",
  "X-AgentBadge-Nonce",
  "X-AgentBadge-Did",
] as const;

export interface DidEnrichOptions {
  verifySignature?: VerifySignatureFn;
  nonceStore?: NonceStore;
  maxSkewSeconds?: number;
}

const _defaultNonceStore = new NonceStore();

function reinjectBody(c: Context, rawBody: string): void {
  c.req.json = (async () =>
    rawBody ? JSON.parse(rawBody) : {}) as typeof c.req.json;
  c.req.text = (async () => rawBody) as typeof c.req.text;
  c.req.arrayBuffer = (async () => {
    const enc = new TextEncoder();
    return enc.encode(rawBody).buffer as ArrayBuffer;
  }) as typeof c.req.arrayBuffer;
}

export function didAuthEnrich(
  opts: DidEnrichOptions = {},
): MiddlewareHandler {
  const maxSkew = opts.maxSkewSeconds ?? 300;

  return async (c, next) => {
    // No identity to verify on bodiless methods.
    if (c.req.method !== "POST" && c.req.method !== "PUT" && c.req.method !== "PATCH") {
      await next();
      return;
    }

    // Idempotent under overlapping mounts ("/mcp" + "/mcp/*" both match
    // "/mcp" in Hono): the flag is set ONLY by this middleware after a
    // completed verification — a pre-seeded verifiedDid can't skip it,
    // but a second mount won't burn the single-use nonce again.
    if (c.get("__didEnriched")) {
      await next();
      return;
    }

    const overrides = didAuthTestOverrides();
    const nonceStore = opts.nonceStore ?? overrides.nonceStore ?? _defaultNonceStore;
    const verifySig = opts.verifySignature ?? overrides.verifier ?? defaultVerifySignature;

    const sig = c.req.header("X-AgentBadge-Signature");
    const tsStr = c.req.header("X-AgentBadge-Timestamp");
    const nonce = c.req.header("X-AgentBadge-Nonce");
    const did = c.req.header("X-AgentBadge-Did");

    const present = [sig, tsStr, nonce, did].filter((v) => !!v).length;
    if (present === 0) {
      await next();
      return;
    }
    if (present < DID_HEADERS.length) {
      return errorResponse(
        c, 401, ErrorCodes.MISSING_FIELDS,
        "Incomplete DID auth headers — send all of X-AgentBadge-Signature, X-AgentBadge-Timestamp, X-AgentBadge-Nonce, X-AgentBadge-Did or none",
      );
    }

    const ts = Number(tsStr);
    if (!Number.isFinite(ts)) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Invalid timestamp format");
    }
    const now = Math.floor(Date.now() / 1000);
    if (Math.abs(now - ts) > maxSkew) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Timestamp outside allowed skew window");
    }

    if (!(await nonceStore.consume(nonce as string))) {
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Nonce already used or invalid");
    }

    let rawBody = "";
    try {
      rawBody = await c.req.text();
    } catch {
      // empty body is fine
    }

    const challenge = buildChallenge({
      did: did as string,
      method: c.req.method,
      path: c.req.path,
      body: rawBody,
      timestamp: ts,
      nonce: nonce as string,
    });

    const accountId = await didToAccountId(did as string);
    if (!accountId) {
      reinjectBody(c, rawBody);
      return errorResponse(c, 401, ErrorCodes.PASSPORT_NOT_FOUND, "DID does not resolve to an account");
    }

    const valid = await verifySig(challenge, sig as string, accountId);
    if (!valid) {
      reinjectBody(c, rawBody);
      return errorResponse(c, 401, ErrorCodes.INVALID_INPUT, "Signature verification failed");
    }

    c.set("verifiedDid", did);
    c.set("__didEnriched", true);
    reinjectBody(c, rawBody);
    await next();
  };
}
