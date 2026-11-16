/**
 * SLICE-225-2 (EPIC-225): contract guards for identity writes —
 * same wallet/shape rules as lib/commerce/guards.ts but surfacing
 * `IdentityError("INVALID")` so the module's error contract stays
 * self-contained (D-225-1).
 */
import { CONTRACT_LIMITS } from "../machine-entry";
import { invalid } from "./types";

const WALLET_RE = /^0x[0-9a-f]{40}$/;

/** Canonical actor id: lowercase EVM wallet. Returns normalized value. */
export function assertWallet(wallet: unknown, field = "wallet"): string {
  if (typeof wallet !== "string") {
    throw invalid(`${field} must be an EVM wallet string`, { field });
  }
  const w = wallet.toLowerCase();
  if (!WALLET_RE.test(w)) {
    throw invalid(`${field} must be a 0x-prefixed EVM address`, { field });
  }
  return w;
}

export function assertNonEmpty(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw invalid(`${field} must be a non-empty string`, { field });
  }
  return value;
}

/** idempotency_key 8-128 (CONTRACT_LIMITS single source). */
export function assertIdempotencyKey(
  key: unknown,
  field = "idempotencyKey",
): string {
  const { min, max } = CONTRACT_LIMITS.idempotencyKey;
  if (
    typeof key !== "string" ||
    key.length < min ||
    key.length > max
  ) {
    throw invalid(`${field} must be ${min}-${max} chars`, {
      field,
      min,
      max,
    });
  }
  return key;
}
