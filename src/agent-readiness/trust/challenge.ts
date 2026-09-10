/**
 * SLICE-102-3: Domain ownership challenge.
 *
 * Challenge token generation and types.
 */

import { randomBytes } from "node:crypto";

export interface Challenge {
  domain: string;
  token: string;
  created_at: string;
  expires_at: string;
}

/**
 * Generate a domain ownership challenge token.
 *
 * Token format: agentbadge-verify=<32-char hex>
 * Expiry: 90 days from creation.
 */
export function generateChallenge(domain: string, createdAt?: string): Challenge {
  const hex = randomBytes(16).toString("hex"); // 32 hex chars
  const token = `agentbadge-verify=${hex}`;
  const now = createdAt ? new Date(createdAt) : new Date();
  const expires = new Date(now.getTime() + 90 * 24 * 60 * 60 * 1000); // 90 days

  return {
    domain,
    token,
    created_at: now.toISOString(),
    expires_at: expires.toISOString(),
  };
}

/**
 * Check if a challenge has expired.
 */
export function isChallengeExpired(challenge: Challenge, now?: Date): boolean {
  const checkTime = now ?? new Date();
  return checkTime.getTime() > new Date(challenge.expires_at).getTime();
}
