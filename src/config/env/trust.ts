/**
 * Trust config section — domain ownership challenge secret.
 *
 *   TRUST_CHALLENGE_SECRET — HMAC key used to derive stateless domain
 *   ownership challenge tokens. Required in production (min 32 chars).
 *   Rotating it invalidates every outstanding challenge token.
 *
 * Outside production a random per-process secret is used when unset, so
 * tokens are stable within a process but change on restart.
 */

import { randomBytes } from "node:crypto";
import type { TrustEnvConfig } from "./types";
import { throwIfErrors } from "./validators";

export const MIN_TRUST_CHALLENGE_SECRET_LENGTH = 32;

let devFallbackSecret: string | null = null;
let cachedTrust: TrustEnvConfig | null = null;

export function loadTrust(errors: string[]): TrustEnvConfig {
  const secret = process.env.TRUST_CHALLENGE_SECRET;
  if (secret) {
    if (secret.length < MIN_TRUST_CHALLENGE_SECRET_LENGTH) {
      errors.push(
        `Invalid TRUST_CHALLENGE_SECRET: expected at least ${MIN_TRUST_CHALLENGE_SECRET_LENGTH} characters`,
      );
    }
    return { challengeSecret: secret };
  }

  if (process.env.NODE_ENV === "production") {
    errors.push("Missing TRUST_CHALLENGE_SECRET (required in production)");
    return { challengeSecret: "" };
  }

  devFallbackSecret ??= randomBytes(32).toString("hex");
  return { challengeSecret: devFallbackSecret };
}

/**
 * Trust config without loading the full AppConfig, so trust routes don't
 * depend on unrelated chain/payment env vars.
 */
export function getTrustConfig(): TrustEnvConfig {
  if (cachedTrust) return cachedTrust;
  const errors: string[] = [];
  const trust = loadTrust(errors);
  throwIfErrors(errors);
  cachedTrust = trust;
  return trust;
}

export function resetTrustConfigCache(): void {
  cachedTrust = null;
}
