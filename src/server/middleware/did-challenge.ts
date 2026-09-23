/**
 * DID-auth challenge construction + the challenge-issuing endpoint
 * (EPIC-82 SLICE-82-1). Split out of did-auth.ts (SLICE-145-6, max-lines).
 *
 * Canonical challenge format:
 *   agentbadge-action:v1
 *   did:<did>
 *   method:<HTTP method>
 *   path:<route path>
 *   body_sha256:<hex sha256 of raw body, or sha256 of empty string>
 *   timestamp:<unix seconds>
 *   nonce:<16-byte random hex issued per request>
 */

import type { MiddlewareHandler } from "hono";
import { createHash } from "node:crypto";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { NonceStore } from "./did-nonce";

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

    const nonce = await nonceStore.issue();
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
