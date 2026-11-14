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

export function fpHashFor(ip: string, ua: string, salt: string): string {
  return createHash("sha256").update(`${ip}+${ua}+${salt}`).digest("hex");
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
}): { fpHash: string; fingerprint: InboxFingerprint } {
  const ua = input.ua ?? null;
  return {
    fpHash: fpHashFor(input.ip, ua ?? "", input.salt),
    fingerprint: {
      ua,
      referer: input.referer ?? null,
      src: input.src ?? null,
      headers: sanitizeHeaders(input.headers ?? {}),
    },
  };
}
