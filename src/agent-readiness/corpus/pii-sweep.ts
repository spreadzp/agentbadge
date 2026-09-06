/**
 * SLICE-103-1: PII detection utility (spec v0.11 §14.2).
 *
 * Conservative PII sweep — false positives are acceptable;
 * false negatives are not.
 *
 * Detects: URLs, email addresses, IP addresses (v4/v6), domain-like strings.
 */

// ── Regex patterns ───────────────────────────────────────────

const URL_PATTERN = /https?:\/\/[^\s"'<>]+/i;
const EMAIL_PATTERN = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const IPV4_PATTERN = /\b(?:(?:25[0-5]|2[0-4]\d|1?\d?\d)\.){3}(?:25[0-5]|2[0-4]\d|1?\d?\d)\b/;
const IPV6_PATTERN = /\b(?:[A-F0-9]{1,4}:){7}[A-F0-9]{1,4}\b/i;
// Domain-like: "example.com", "sub.example.co.uk" — but not common words
const DOMAIN_PATTERN = /\b[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.[a-z]{2,}(?:\.[a-z]{2,})?\b/i;

const PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "URL", regex: URL_PATTERN },
  { name: "email", regex: EMAIL_PATTERN },
  { name: "IPv4", regex: IPV4_PATTERN },
  { name: "IPv6", regex: IPV6_PATTERN },
  { name: "domain", regex: DOMAIN_PATTERN },
];

// ── Types ────────────────────────────────────────────────────

export interface PiiSweepResult {
  clean: boolean;
  findings: string[];
}

// ── Sweep function ───────────────────────────────────────────

/**
 * Recursively sweep an object for PII in any string field.
 * Returns clean=true if no PII patterns found.
 */
export function sweepForPii(record: unknown): PiiSweepResult {
  const findings: string[] = [];
  sweepValue(record, findings);
  return { clean: findings.length === 0, findings };
}

function sweepValue(value: unknown, findings: string[]): void {
  if (typeof value === "string") {
    sweepString(value, findings);
  } else if (Array.isArray(value)) {
    for (const item of value) {
      sweepValue(item, findings);
    }
  } else if (value !== null && typeof value === "object") {
    for (const val of Object.values(value)) {
      sweepValue(val, findings);
    }
  }
}

function sweepString(str: string, findings: string[]): void {
  for (const { name, regex } of PATTERNS) {
    const match = str.match(regex);
    if (match) {
      findings.push(`${name}: "${match[0]}" in "${truncate(str, 80)}"`);
    }
  }
}

function truncate(str: string, max: number): string {
  if (str.length <= max) return str;
  return str.slice(0, max - 3) + "...";
}
