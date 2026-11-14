import { z } from "zod";
import type { Context } from "hono";

import { MemoryStore } from "../../middleware/rate-limit";

/**
 * EPIC-252 (SLICE-252-2): POST /api/requests intake plumbing —
 * size caps (D-252 2026-11-14), zod schema, header snapshot and the
 * in-handler submit limiter (agentId|fpHash key — runs AFTER the QA
 * fast-path + idempotent replay so retries never consume quota).
 */

/** payload ≤256KB, body ≤512KB, each meta field ≤4KB. */
export const PAYLOAD_MAX = 256 * 1024;
export const BODY_MAX = 512 * 1024;
export const META_MAX = 4 * 1024;

/** Documented request kinds (HOWTO). "bogus" classifiers used to
 *  create submitted rows that only ops could triage - now rejected
 *  at the schema edge. Null/absent stays legal (legacy clients). */
export const REQUEST_KINDS = [
  "question",
  "feature",
  "feedback",
  "bug",
  "proposal",
] as const;

export const postSchema = z.object({
  kind: z.enum(REQUEST_KINDS).optional(),
  payload: z.unknown(),
  meta: z
    .object({
      name: z.string().optional(),
      agent_card_url: z.string().optional(),
      did: z.string().optional(),
    })
    .partial()
    .catchall(z.unknown())
    .optional(),
});

export type IntakeBody = z.infer<typeof postSchema>;

const bytes = (v: unknown): number => {
  try {
    return Buffer.byteLength(JSON.stringify(v) ?? "", "utf8");
  } catch {
    return Number.POSITIVE_INFINITY;
  }
};

/** Validate raw request body → parsed intake or a string error field. */
export function parseIntake(raw: string):
  | { ok: true; body: IntakeBody }
  | { ok: false; error: "too_large" | "bad_json" | "invalid" | "field_too_large"; field?: string } {
  if (Buffer.byteLength(raw, "utf8") > BODY_MAX) {
    return { ok: false, error: "too_large" };
  }
  let json: unknown;
  try {
    json = JSON.parse(raw);
  } catch {
    return { ok: false, error: "bad_json" };
  }
  const parsed = postSchema.safeParse(json);
  if (!parsed.success || parsed.data.payload === undefined) {
    return { ok: false, error: "invalid" };
  }
  const { payload, meta } = parsed.data;
  if (bytes(payload) > PAYLOAD_MAX) {
    return { ok: false, error: "field_too_large", field: "payload" };
  }
  // Audit M-8: NUL / unpaired surrogates survive JSON.parse+zod but
  // Postgres jsonb 500s on them — reject before the lane is consumed.
  if (hasJsonbUnsafe(payload)) {
    return { ok: false, error: "invalid" };
  }
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined && bytes(v) > META_MAX) {
        return { ok: false, error: "field_too_large", field: `meta.${k}` };
      }
    }
  }
  return { ok: true, body: parsed.data };
}

/** True if any string under `v` has NUL or an unpaired surrogate. */
export function hasJsonbUnsafe(v: unknown, depth = 0): boolean {
  if (depth > 32) return true;
  if (typeof v === "string") {
    return (
      v.includes("\u0000") ||
      /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/u.test(
        v,
      )
    );
  }
  if (Array.isArray(v)) {
    return v.some((x) => hasJsonbUnsafe(x, depth + 1));
  }
  if (v !== null && typeof v === "object") {
    // Re-audit M-8: object KEYS can also carry NUL/surrogates —
    // values alone weren't enough.
    return Object.entries(v as Record<string, unknown>).some(
      ([k, x]) => hasJsonbUnsafe(k, depth + 1) || hasJsonbUnsafe(x, depth + 1),
    );
  }
  return false;
}

/**
 * Stream the request body with a hard byte cap (audit H-3): chunked
 * requests carry no Content-Length, so `c.req.text()` buffers them
 * unbounded. Returns null when the body exceeds `cap`.
 */
export async function readBodyCap(
  c: Context,
  cap: number,
): Promise<string | null> {
  const body = c.req.raw.body;
  if (!body) return "";
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (; ;) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > cap) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }
  return Buffer.concat(chunks.map((x) => Buffer.from(x))).toString("utf8");
}

/** Lower-cased header snapshot (values truncated at 512 chars) —
 *  secrets are stripped downstream by buildFingerprint. */
export function headerSnapshot(c: Context): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of c.req.raw.headers.entries()) {
    out[k.toLowerCase()] = v.length > 512 ? v.slice(0, 512) : v;
  }
  return out;
}

const LANE_MAX_ENTRIES = 10_000;

/** Fixed-window submit limiter — key is `agentId ?? fpHash`. Entries
 *  are swept periodically and evicted past LANE_MAX_ENTRIES so a
 *  rotation flood can't grow the map forever (audit H-2). */
export function createSubmitLimiter(opts: {
  windowMs: number;
  max: number;
  now?: () => number;
}): {
  check(key: string): { retryAfterSec: number } | null;
  /** Decrement a consumed slot — used when a post-lane step fails
   *  so an honest retry isn't punished for our 5xx (re-audit N-1). */
  refund(key: string): void;
} {
  const store = new MemoryStore();
  const now = opts.now ?? (() => Date.now());
  let lastSweep = now();
  return {
    check(key) {
      const t = now();
      if (t - lastSweep >= opts.windowMs) {
        store.sweep(t);
        lastSweep = t;
      }
      if (store.size() > LANE_MAX_ENTRIES) {
        store.sweep(t);
        const over = store.size() - LANE_MAX_ENTRIES;
        if (over > 0) store.evictOldest?.(over);
      }
      let e = store.get(key);
      if (!e || e.resetAt <= t) {
        e = { count: 0, resetAt: t + opts.windowMs };
      }
      e.count += 1;
      store.set(key, e);
      if (e.count > opts.max) {
        return {
          retryAfterSec: Math.max(1, Math.ceil((e.resetAt - t) / 1000)),
        };
      }
      return null;
    },
    refund(key) {
      const e = store.get(key);
      if (!e) return;
      e.count = Math.max(0, e.count - 1);
      if (e.count === 0) store.delete(key);
      else store.set(key, e);
    },
  };
}

/**
 * Dual-lane submit limiter (SLICE-252-7 landmine): the hard lane keys on
 * `agentId ?? fpHash`; anonymous callers ALSO face an IP-less soft lane
 * keyed on `softFpHash` — rotating IPs keeps the same soft hash, so
 * IP-hops can't mint fresh lanes. Verified agents skip the soft lane
 * (their identity is already bounded by agentId).
 */
export function createSubmitLanes(opts: {
  windowMs: number;
  max: number;
  /** Anonymous soft-lane cap — default max(max*8, 8). */
  softMax?: number;
  /** Anonymous IP-only lane cap — default max(max*16, 16). */
  ipMax?: number;
  now?: () => number;
}): {
  check(
    agentId: string | null,
    fpHash: string,
    softFpHash: string,
    ipFpHash?: string | null,
  ): { retryAfterSec: number } | null;
  /** Give back the slots consumed by check() — call when a post-lane
   *  step fails so honest retries aren't double-charged (N-1). */
  refund(
    agentId: string | null,
    fpHash: string,
    softFpHash: string,
    ipFpHash?: string | null,
  ): void;
} {
  const hard = createSubmitLimiter({
    windowMs: opts.windowMs,
    max: opts.max,
    now: opts.now,
  });
  const soft = createSubmitLimiter({
    windowMs: opts.windowMs,
    max: opts.softMax ?? Math.max(opts.max * 8, 8),
    now: opts.now,
  });
  const ipLane = createSubmitLimiter({
    windowMs: opts.windowMs,
    max: opts.ipMax ?? Math.max(opts.max * 16, 16),
    now: opts.now,
  });
  return {
    check(agentId, fpHash, softFpHash, ipFpHash) {
      // Audit H-1: hard lane first — a hard-limited request must not
      // burn soft quota (a hard reject shouldn't starve the shared
      // signature bucket for everyone else on it).
      const hardKey = `hard:${agentId ?? fpHash}`;
      const limited = hard.check(hardKey);
      if (limited) return limited;
      if (agentId === null) {
        // Re-audit N-3: anonymous callers are ALSO bound to their
        // resolved IP alone — rotating identity headers mints fresh
        // fpHash/softFpHash lanes but can't escape this bucket.
        const ipKey = ipFpHash ? `ip:${ipFpHash}` : null;
        const ipLimited = ipKey ? ipLane.check(ipKey) : null;
        if (ipLimited) {
          // M-1 round-3: the rejecting lane keeps its slot, but the
          // already-taken hard slot must be returned — otherwise the
          // rejected request holds it for the full window.
          hard.refund(hardKey);
          return ipLimited;
        }
        const softLimited = soft.check(`soft:${softFpHash}`);
        if (softLimited) {
          hard.refund(hardKey);
          if (ipKey) ipLane.refund(ipKey);
          return softLimited;
        }
      }
      return null;
    },
    refund(agentId, fpHash, softFpHash, ipFpHash) {
      hard.refund(`hard:${agentId ?? fpHash}`);
      if (agentId === null) {
        if (ipFpHash) ipLane.refund(`ip:${ipFpHash}`);
        soft.refund(`soft:${softFpHash}`);
      }
    },
  };
}
