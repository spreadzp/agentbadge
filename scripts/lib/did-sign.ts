/**
 * SLICE-82-4: DID Auth signing helper for demo/seed scripts.
 *
 * Provides a simple function to sign canonical challenge strings
 * with an EVM private key (ethers EIP-191 personal sign) and attach
 * the required X-AgentBadge-* headers to a fetch request.
 */

import { ethers } from "ethers";
import { createHash, randomBytes } from "node:crypto";

export interface DidAuthSignOptions {
  did: string;
  method: string;
  path: string;
  body: string;
  privateKey: string;
  nonce?: string;
  timestamp?: number;
}

export function buildCanonicalChallenge(opts: {
  did: string;
  method: string;
  path: string;
  body: string;
  timestamp: number;
  nonce: string;
}): string {
  const bodyHash = createHash("sha256").update(opts.body, "utf8").digest("hex");
  return [
    "agentbadge-action:v1",
    `did:${opts.did}`,
    `method:${opts.method}`,
    `path:${opts.path}`,
    `body_sha256:${bodyHash}`,
    `timestamp:${opts.timestamp}`,
    `nonce:${opts.nonce}`,
  ].join("\n");
}

export function signDidAuth(opts: DidAuthSignOptions): Record<string, string> {
  const timestamp = opts.timestamp ?? Math.floor(Date.now() / 1000);
  const nonce = opts.nonce ?? randomBytes(16).toString("hex");
  const wallet = new ethers.Wallet(opts.privateKey);

  const challenge = buildCanonicalChallenge({
    did: opts.did,
    method: opts.method,
    path: opts.path,
    body: opts.body,
    timestamp,
    nonce,
  });

  // EIP-191 personal sign (same as ethers.signMessage)
  const signature = wallet.signMessageSync(challenge);

  return {
    "X-AgentBadge-Signature": signature,
    "X-AgentBadge-Timestamp": String(timestamp),
    "X-AgentBadge-Nonce": nonce,
    "X-AgentBadge-Did": opts.did,
  };
}

/**
 * Fetch wrapper that automatically adds DID auth headers for mutation requests.
 * Use for POST/PUT/DELETE to /market/* or /a2a/* endpoints.
 */
export async function signedFetch(
  url: string,
  opts: {
    method: string;
    body: string;
    did: string;
    privateKey: string;
    headers?: Record<string, string>;
  },
): Promise<Response> {
  const path = new URL(url).pathname;
  const authHeaders = signDidAuth({
    did: opts.did,
    method: opts.method,
    path,
    body: opts.body,
    privateKey: opts.privateKey,
  });

  return fetch(url, {
    method: opts.method,
    headers: { "Content-Type": "application/json", ...opts.headers, ...authHeaders },
    body: opts.body,
  });
}
