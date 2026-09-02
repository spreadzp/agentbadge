/**
 * Secret redaction utility (EPIC-83 SLICE-83-2).
 *
 * Centralized pattern list consumed by both request logger and Sentry beforeSend.
 * Strips private keys, bearer tokens, Stripe tokens, and *PrivateKey* field values.
 */

// ─── Regex patterns for string-based redaction ─────────────────────

// Hedera ED25519 private key in DER format (starts with 302e020100300506032b6570)
const ED25519_DER_KEY = /302e020100300506032b6570[0-9a-fA-F]{48,}/g;

// Hedera ECDSA private key in hex (0x + 64 hex chars)
const ECDSA_HEX_KEY = /0x[0-9a-fA-F]{64}/g;

// Bearer token values
const BEARER_TOKEN = /Bearer\s+[A-Za-z0-9\-._~+\/]+=*/g;

// Stripe secret keys (sk_live_ or sk_test_)
const STRIPE_KEY = /sk_(live|test)_[0-9a-zA-Z]{16,}/g;

// JSON field values for *PrivateKey* keys: "fieldName":"value"
const PRIVATE_KEY_JSON_FIELD = /"(?:[a-zA-Z]*[Pp]rivate[Kk]ey)"\s*:\s*"[^"]*"/g;

const ALL_PATTERNS = [ED25519_DER_KEY, ECDSA_HEX_KEY, BEARER_TOKEN, STRIPE_KEY, PRIVATE_KEY_JSON_FIELD];

// ─── String redaction ──────────────────────────────────────────────

export function redactString(input: string): string {
  let result = input;
  for (const pattern of ALL_PATTERNS) {
    result = result.replace(pattern, "[REDACTED]");
  }
  return result;
}

// ─── Object redaction ──────────────────────────────────────────────

// Field names that should be redacted (case-insensitive match on "privatekey")
function isSensitiveKey(key: string): boolean {
  return /privatekey/i.test(key);
}

export function redactSecrets<T extends Record<string, unknown>>(payload: T): T {
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(payload)) {
    if (isSensitiveKey(key)) {
      result[key] = "[REDACTED]";
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      result[key] = redactSecrets(value as Record<string, unknown>);
    } else {
      result[key] = value;
    }
  }

  return result as T;
}
