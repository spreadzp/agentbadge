/**
 * SLICE-98-2: Credential redaction
 *
 * Denylist approach: Authorization, Cookie, Set-Cookie, api-key variants,
 * and any header matching /token|secret|password|key/i are always redacted.
 * Allowlist of safe fields is used for trace notes.
 */

const REDACTED = "[REDACTED]";

const DENYLIST_HEADERS = new Set([
  "authorization",
  "cookie",
  "set-cookie",
  "api-key",
  "x-api-key",
  "x-auth-token",
]);

const DENYLIST_PATTERN = /token|secret|password|key/i;

const ALLOWLIST_HEADERS = new Set([
  "content-type",
  "accept",
  "user-agent",
  "x-ratelimit-limit",
  "x-ratelimit-remaining",
  "x-ratelimit-reset",
  "retry-after",
  "sunset",
  "deprecation",
  "www-authenticate",
  "content-length",
  "date",
  "server",
]);

export function redactHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const result: Record<string, string> = {};
  for (const [key, value] of Object.entries(headers)) {
    const lowerKey = key.toLowerCase();
    if (DENYLIST_HEADERS.has(lowerKey) || DENYLIST_PATTERN.test(key)) {
      result[key] = REDACTED;
    } else {
      result[key] = value;
    }
  }
  return result;
}

export function redactString(text: string): string {
  // Redact common credential patterns in arbitrary text
  return text
    .replace(/Authorization:\s+\S+(?:\s+\S+)*?(?=\s+and\s|\s+Cookie|\s+api[_-]?key|\s+token=|\s+secret=|\s+password=|$)/gi, "Authorization: [REDACTED]")
    .replace(/Cookie:\s+\S+(?:\s+\S+)*?(?=\s+and\s|\s+Authorization|\s+api[_-]?key|\s+token=|\s+secret=|\s+password=|$)/gi, "Cookie: [REDACTED]")
    .replace(/api[_-]?key[=:]\s*[^\s,;]+/gi, "api_key=[REDACTED]")
    .replace(/token[=:]\s*[^\s,;]+/gi, "token=[REDACTED]")
    .replace(/secret[=:]\s*[^\s,;]+/gi, "secret=[REDACTED]")
    .replace(/password[=:]\s*[^\s,;]+/gi, "password=[REDACTED]");
}

export function isRedacted(value: string): boolean {
  return value === REDACTED;
}

export function isAllowlistedHeader(headerName: string): boolean {
  return ALLOWLIST_HEADERS.has(headerName.toLowerCase());
}

export { REDACTED, ALLOWLIST_HEADERS, DENYLIST_HEADERS, DENYLIST_PATTERN };
