// EPIC-262 (SLICE-262-2): site_key crypto — scoped credential for plugin
// installs. Plaintext is generated once, shown once, and NEVER stored:
// persistence holds sha256 hex + a 13-char prefix for identification.

import { createHash, randomBytes } from "node:crypto";

export const SITE_KEY_PLAINTEXT_PREFIX = "absk_";
const SECRET_BYTES = 24; // 192-bit — 32 base64url chars

export function generateSiteKeyPlaintext(): string {
  return SITE_KEY_PLAINTEXT_PREFIX + randomBytes(SECRET_BYTES).toString("base64url");
}

export function hashSiteKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

// "absk_" + first 8 secret chars — enough to identify a key in logs/UI
// without leaking material.
export function siteKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, SITE_KEY_PLAINTEXT_PREFIX.length + 8);
}

export function isSiteKeyPlaintext(candidate: string): boolean {
  return (
    candidate.startsWith(SITE_KEY_PLAINTEXT_PREFIX) &&
    candidate.length === SITE_KEY_PLAINTEXT_PREFIX.length + 32
  );
}
