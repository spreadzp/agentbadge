import { createHash } from "node:crypto";

import type { InboxFingerprint } from "./types";

/**
 * EPIC-252 (SLICE-252-1, D-252-Q2): requester fingerprinting.
 *
 * fpHash = sha256(ip + ua + env-salt) — a typed, queryable dedupe/rate
 * key that makes the raw IP irrecoverable. The fingerprint snapshot
 * keeps UA/referer/src and a denylised header copy — any header whose
 * name can carry credentials is dropped outright.
 */

/** Header names that may carry credentials — removed from the snapshot. */
const SENSITIVE_HEADER_RE =
  /authorization|proxy-authorization|cookie|set-cookie|x-api-key|api[-_]?key|x-agent-token|x-access-token|x-auth|x-sig|x-wallet|token|secret|credential/i;

const MAX_SNAPSHOT_HEADERS = 40;
const MAX_HEADER_VALUE_LEN = 512;

/**
 * Headers that change with the source IP or per request — excluded from
 * the softFpHash digest (still kept in the forensic snapshot). If an
 * IP-carrier header fed the digest, rotating the IP would mint a fresh
 * softFpHash and defeat the soft rate lane (SLICE-252-7 landmine).
 */
const ROTATING_HEADER_RE =
  /^(fly-client-ip|x-forwarded-for|x-real-ip|cf-connecting-ip|true-client-ip|forwarded|idempotency-key|traceparent|tracestate|x-request-id|request-id|x-correlation-id|x-b3-[a-z]+)$/i;

export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (SENSITIVE_HEADER_RE.test(lower)) continue;
    out[lower] = value.slice(0, MAX_HEADER_VALUE_LEN);
    if (Object.keys(out).length >= MAX_SNAPSHOT_HEADERS) break;
  }
  return out;
}

/**
 * Canonical digest of the sanitized header snapshot — sorted name:value
 * pairs so header ORDER doesn't matter (agents emit them consistently).
 */
export function headersDigestFor(
  headers: Record<string, string>,
): string {
  const canon = Object.keys(headers)
    .filter((k) => !ROTATING_HEADER_RE.test(k))
    .sort()
    .map((k) => `${k}:${headers[k]}`)
    .join("\n");
  return createHash("sha256").update(canon).digest("hex");
}

export function fpHashFor(
  ip: string,
  ua: string,
  salt: string,
  headersDigest = "",
): string {
  return createHash("sha256")
    .update(`${ip}+${ua}+${headersDigest}+${salt}`)
    .digest("hex");
}

/**
 * IP-less fingerprint (SLICE-252-7 landmine): a rotator that only swaps
 * IPs keeps the SAME softFpHash — the rate-limit soft lane keyed on it
 * still applies. Rotating UA/headers escapes it, but that costs the
 * attacker a fresh client signature per lane instead of a fresh IP.
 */
export function softFpHashFor(
  ua: string,
  headersDigest: string,
  salt: string,
): string {
  return createHash("sha256")
    .update(`soft+${ua}+${headersDigest}+${salt}`)
    .digest("hex");
}

/** sha256 of the normalized question — the Q&A corpus dedupe key (Q7). */
export function questionHashFor(normalizedQuestion: string): string {
  return createHash("sha256").update(normalizedQuestion).digest("hex");
}

/** Case-fold + whitespace-collapse — the shared question normalization. */
export function normalizeQuestion(question: string): string {
  return question.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Build the stored fingerprint pair. `ip` is consumed by the hash only —
 * it never lands in the returned snapshot (D-252-Q2 privacy posture).
 */
export function buildFingerprint(input: {
  ip: string;
  ua?: string | null;
  referer?: string | null;
  src?: string | null;
  headers?: Record<string, string>;
  salt: string;
}): {
  fpHash: string;
  softFpHash: string;
  fingerprint: InboxFingerprint;
} {
  const ua = input.ua ?? null;
  const sanitized = sanitizeHeaders(input.headers ?? {});
  const headersDigest = headersDigestFor(sanitized);
  const softFpHash = softFpHashFor(ua ?? "", headersDigest, input.salt);
  return {
    fpHash: fpHashFor(input.ip, ua ?? "", input.salt, headersDigest),
    softFpHash,
    fingerprint: {
      ua,
      referer: input.referer ?? null,
      src: input.src ?? null,
      headers: sanitized,
      softFpHash,
    },
  };
}
