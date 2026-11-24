// EPIC-264 (SLICE-264-1): opk_ credential crypto — same shape as the
// intel operator_key (abop_): plaintext generated once, shown once,
// NEVER stored (sha256 hex + identification prefix only).

import { createHash, randomBytes } from "node:crypto";

export const ADMIN_KEY_PLAINTEXT_PREFIX = "opk_";
const SECRET_BYTES = 24; // 192-bit — 32 base64url chars

export function generateAdminKeyPlaintext(): string {
  return (
    ADMIN_KEY_PLAINTEXT_PREFIX +
    randomBytes(SECRET_BYTES).toString("base64url")
  );
}

export function hashAdminKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function adminKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, ADMIN_KEY_PLAINTEXT_PREFIX.length + 8);
}

export function isAdminKeyPlaintext(candidate: string): boolean {
  return (
    candidate.startsWith(ADMIN_KEY_PLAINTEXT_PREFIX) &&
    candidate.length === ADMIN_KEY_PLAINTEXT_PREFIX.length + 32
  );
}
