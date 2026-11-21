import { createHash, createHmac } from "node:crypto";
import { isIP } from "node:net";

import type { InboxFingerprint } from "./types";

/**
 * EPIC-252 (SLICE-252-1, D-252-Q2; hardened SLICE-252-8 audit):
 * requester fingerprinting.
 *
 * fpHash = HMAC-SHA256_salt(len-prefixed ip|ua|headersDigest) — a
 * typed, queryable dedupe/rate key that makes the raw IP
 * irrecoverable. The fingerprint snapshot keeps capped UA/referer/src
 * and a sanitized header copy — credential-style and IP-carrier
 * headers are dropped outright. The resolved IP IS persisted
 * (ops-only, abuse investigation — C49 article amendment 2026-11-14);
 * public endpoints never return it; rate lanes key off HMAC(ip).
 */

/**
 * Header snapshot ALLOWLIST — the only header names that may persist
 * (arc-audit C-1 round-3). A denylist kept whack-a-moling new
 * IP-credential carriers (cf-pseudo-ipv4, x-azure-clientip,
 * x-envoy-external-address…); an allowlist guarantees nothing
 * unvetted — credentials, raw URLs, IP carriers — ever persists.
 */
const SNAPSHOT_HEADER_RE =
  /^(accept|accept-language|accept-encoding|accept-charset|sec-ch-ua|sec-ch-ua-mobile|sec-ch-ua-platform|sec-ch-ua-full-version|dnt|upgrade-insecure-requests|content-type|user-agent|x-requested-with)$/i;

/**
 * Stable client-identity headers — the ONLY inputs to the soft-fp
 * digest (arc-audit C-2). Denylist keying let `X-Pad: <n>` mint a
 * fresh lane per request and let per-request headers (fly-request-id,
 * content-length) break honest dedupe; allowlisting keeps the digest
 * stable for real clients and useless to rotators.
 */
const IDENTITY_HEADER_RE =
  /^(accept|accept-language|accept-encoding|accept-charset|sec-ch-ua|sec-ch-ua-mobile|sec-ch-ua-platform|sec-ch-ua-full-version|dnt|upgrade-insecure-requests)$/i;

const MAX_SNAPSHOT_HEADERS = 40;
const MAX_HEADER_VALUE_LEN = 512;
const MAX_FIELD_LEN = 512;

export function sanitizeHeaders(
  headers: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [name, value] of Object.entries(headers)) {
    const lower = name.toLowerCase();
    if (!SNAPSHOT_HEADER_RE.test(lower)) continue;
    out[lower] = value.slice(0, MAX_HEADER_VALUE_LEN);
    if (Object.keys(out).length >= MAX_SNAPSHOT_HEADERS) break;
  }
  return out;
}

/**
 * Canonical digest of the stable-identity headers only — sorted
 * name:value pairs (order never matters). Arbitrary extra headers
 * (`x-pad`, `fly-request-id`, `content-length`…) cannot shift it.
 */
export function headersDigestFor(
  headers: Record<string, string>,
): string {
  // Re-audit C-2: digest the FULL uncapped header set, not the
  // sanitized snapshot — alphabetically-earlier pad headers would
  // otherwise push identity headers past MAX_SNAPSHOT_HEADERS and
  // mint a fresh lane. Keys are lowercased before matching.
  const canon = Object.entries(headers)
    .filter(([k]) => IDENTITY_HEADER_RE.test(k.toLowerCase()))
    .map(([k, v]) => `${k.toLowerCase()}:${v}`)
    .sort()
    .join("\n");
  return createHash("sha256").update(canon).digest("hex");
}

/** Length-prefixed encoding — unambiguous field packing (audit M-12). */
const enc = (fields: string[]): string =>
  fields.map((f) => `${f.length}:${f}`).join("|");

export function fpHashFor(
  ip: string,
  ua: string,
  salt: string,
  headersDigest = "",
): string {
  return createHmac("sha256", salt)
    .update(`fp:${enc([ip, ua, headersDigest])}`)
    .digest("hex");
}

/**
 * IP-less fingerprint (SLICE-252-7 landmine, hardened 252-8): keyed
 * on UA + stable-identity headers only — rotating IPs keeps the SAME
 * softFpHash so the soft rate lane still applies. With the allowlist
 * digest, `x-pad` churn no longer mints fresh lanes.
 */
export function softFpHashFor(
  ua: string,
  headersDigest: string,
  salt: string,
): string {
  return createHmac("sha256", salt)
    .update(`soft:${enc([ua, headersDigest])}`)
    .digest("hex");
}

/** sha256 of the normalized question — the Q&A corpus dedupe key (Q7). */
export function questionHashFor(normalizedQuestion: string): string {
  return createHash("sha256").update(normalizedQuestion).digest("hex");
}

/**
 * Question normalization (audit M-5): NFKC, control chars → space,
 * zero-width/bidi-invisible chars removed, lowercase, collapse.
 */
export function normalizeQuestion(question: string): string {
  return question
    .normalize("NFKC")
    .replace(/[\u0000-\u001F\u007F-\u009F]+/g, " ")
    .replace(
      /[\u200B-\u200F\u202A-\u202E\u2060-\u206F\uFEFF\u00AD\u061C\u180E\uFE00-\uFE0F]/g,
      "",
    )
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** Cap + strip query/fragment + control chars (M-3, M-8):
 *  referers can carry tokens; a NUL in `src` would fail jsonb
 *  after the lane was consumed. */
const cleanField = (v: string): string =>
  v
    .split("?")[0]
    .split("#")[0]
    .replace(/[\u0000-\u001F\u007F-\u009F]/g, "")
    .slice(0, MAX_FIELD_LEN);

/**
 * Build the stored fingerprint pair. `ip` is consumed by the HMAC only —
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
  /** HMAC(ip) — key for the anonymous IP-only lane (N-3).
   *  null when the IP is "unknown" so the lane is skipped rather
   *  than sharing one bucket across every anonymous caller. */
  ipFpHash: string | null;
  fingerprint: InboxFingerprint;
} {
  const ua = input.ua ? input.ua.slice(0, MAX_FIELD_LEN) : null;
  const sanitized = sanitizeHeaders(input.headers ?? {});
  const headersDigest = headersDigestFor(input.headers ?? {});
  const softFpHash = softFpHashFor(ua ?? "", headersDigest, input.salt);
  return {
    fpHash: fpHashFor(input.ip, ua ?? "", input.salt, headersDigest),
    softFpHash,
    // Re-audit N-3: IP-only lane key — header-rotating anons still
    // share one bucket per resolved IP. Round-3: only a parseable
    // IP gets a key — "unknown"/garbage would force every anonymous
    // caller into a single shared bucket.
    ipFpHash: isIP(input.ip)
      ? createHmac("sha256", input.salt)
        .update(`ip:${input.ip}`)
        .digest("hex")
      : null,
    fingerprint: {
      // Ops-visible raw IP — stored for abuse investigation
      // (deliberate, documented in the C49 article); never surfaced
      // to public request/survey endpoints.
      ip: input.ip,
      ua,
      referer: input.referer ? cleanField(input.referer) : null,
      src: input.src ? cleanField(input.src) : null,
      headers: sanitized,
      softFpHash,
    },
  };
}
