/**
 * SLICE-102-3: Domain ownership challenge.
 *
 * Challenge tokens are stateless: derived as
 *   agentbadge-verify=<HMAC-SHA256(secret, domain + epoch), first 32 hex chars>
 * where epoch is a fixed 90-day window. Issuing a challenge is idempotent per
 * domain+epoch, survives restarts, and needs no server-side storage.
 * Verification accepts the current and previous epoch.
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { getTrustConfig } from "../../config/env/trust";

export interface Challenge {
  domain: string;
  token: string;
  created_at: string;
  expires_at: string;
}

export const CHALLENGE_TOKEN_PREFIX = "agentbadge-verify=";
export const CHALLENGE_EPOCH_MS = 90 * 24 * 60 * 60 * 1000;
const TOKEN_HEX_LENGTH = 32;

function toDate(now?: Date | string): Date {
  if (now === undefined) return new Date();
  return now instanceof Date ? now : new Date(now);
}

export function getChallengeEpoch(now?: Date | string): number {
  return Math.floor(toDate(now).getTime() / CHALLENGE_EPOCH_MS);
}

export function deriveChallengeToken(domain: string, epoch: number, secret: string): string {
  if (!secret) throw new Error("Challenge secret is not configured");
  const mac = createHmac("sha256", secret).update(`${domain}\n${epoch}`).digest("hex");
  return `${CHALLENGE_TOKEN_PREFIX}${mac.slice(0, TOKEN_HEX_LENGTH)}`;
}

function challengeForEpoch(domain: string, epoch: number, secret: string): Challenge {
  return {
    domain,
    token: deriveChallengeToken(domain, epoch, secret),
    created_at: new Date(epoch * CHALLENGE_EPOCH_MS).toISOString(),
    // Valid through the following epoch, since verification accepts epoch - 1.
    expires_at: new Date((epoch + 2) * CHALLENGE_EPOCH_MS).toISOString(),
  };
}

/**
 * Generate the domain ownership challenge for the epoch containing `now`.
 * Deterministic: the same domain, epoch and secret always yield the same token.
 */
export function generateChallenge(
  domain: string,
  now?: Date | string,
  secret: string = getTrustConfig().challengeSecret,
): Challenge {
  return challengeForEpoch(domain, getChallengeEpoch(now), secret);
}

function constantTimeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  return bufA.length === bufB.length && timingSafeEqual(bufA, bufB);
}

/**
 * Recompute the expected token for the current and previous epoch and compare
 * in constant time. Returns the matching challenge, or null if the token is
 * invalid, tampered, or older than the previous epoch.
 */
export function verifyChallengeToken(
  domain: string,
  token: string,
  now?: Date | string,
  secret: string = getTrustConfig().challengeSecret,
): Challenge | null {
  const current = getChallengeEpoch(now);
  let match: Challenge | null = null;
  for (const epoch of [current, current - 1]) {
    const candidate = challengeForEpoch(domain, epoch, secret);
    if (constantTimeEqual(candidate.token, token) && !match) match = candidate;
  }
  return match;
}

/**
 * Check if a challenge has expired.
 */
export function isChallengeExpired(challenge: Challenge, now?: Date): boolean {
  const checkTime = now ?? new Date();
  return checkTime.getTime() > new Date(challenge.expires_at).getTime();
}
