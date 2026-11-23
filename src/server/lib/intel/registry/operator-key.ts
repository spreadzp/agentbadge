// EPIC-262 (SLICE-262-7): operator_key crypto — tenant-scoped human
// credential, same shape as site_key: plaintext generated once, shown
// once, NEVER stored (sha256 hex + identification prefix only).

import { createHash, randomBytes } from "node:crypto";

export const OPERATOR_KEY_PLAINTEXT_PREFIX = "abop_";
const SECRET_BYTES = 24; // 192-bit — 32 base64url chars

export function generateOperatorKeyPlaintext(): string {
  return (
    OPERATOR_KEY_PLAINTEXT_PREFIX +
    randomBytes(SECRET_BYTES).toString("base64url")
  );
}

export function hashOperatorKey(plaintext: string): string {
  return createHash("sha256").update(plaintext).digest("hex");
}

export function operatorKeyPrefix(plaintext: string): string {
  return plaintext.slice(0, OPERATOR_KEY_PLAINTEXT_PREFIX.length + 8);
}

export function isOperatorKeyPlaintext(candidate: string): boolean {
  return (
    candidate.startsWith(OPERATOR_KEY_PLAINTEXT_PREFIX) &&
    candidate.length === OPERATOR_KEY_PLAINTEXT_PREFIX.length + 32
  );
}
