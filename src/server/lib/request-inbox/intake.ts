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

export const postSchema = z.object({
  kind: z.string().max(64).optional(),
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
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined && bytes(v) > META_MAX) {
        return { ok: false, error: "field_too_large", field: `meta.${k}` };
      }
    }
  }
  return { ok: true, body: parsed.data };
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

/** Sliding-window submit limiter — key is `agentId ?? fpHash`. */
export function createSubmitLimiter(opts: {
  windowMs: number;
  max: number;
  now?: () => number;
}): { check(key: string): { retryAfterSec: number } | null } {
  const store = new MemoryStore();
  const now = opts.now ?? (() => Date.now());
  return {
    check(key) {
      const t = now();
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
  };
}
