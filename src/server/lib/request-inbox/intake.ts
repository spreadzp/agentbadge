import { z } from "zod";
import type { Context } from "hono";

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
  /** D-256-Q13: opt-in consent to publish the completed Q&A into the
   *  public corpus. Absent/false = unlisted (bearer-id only). */
  publish_to_qa: z.boolean().optional(),
  /** D-233-5: opt-in signed webhook on terminal transition. https-only,
   *  SSRF-checked before persist (validateCallbackUrl). */
  callback_url: z.string().max(2048).optional(),
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

/** EPIC-233 (SLICE-233-3): payload normalization shared by the REST
 *  parse path and the MCP tool handler — a bare string wraps to
 *  `{question}` (pg/json decode 500s on top-level strings), then the
 *  256KB cap and the jsonb-unsafe probe run. Same checks, one code
 *  path — no copied caps in the adapter. */
export function normalizeIntakePayload(
  rawPayload: unknown,
): { ok: true; payload: unknown } | { ok: false; error: "too_large" | "unsafe" } {
  const payload =
    typeof rawPayload === "string" ? { question: rawPayload } : rawPayload;
  if (bytes(payload) > PAYLOAD_MAX) return { ok: false, error: "too_large" };
  if (hasJsonbUnsafe(payload)) return { ok: false, error: "unsafe" };
  return { ok: true, payload };
}

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
  const { payload: rawPayload, meta } = parsed.data;
  // pg/json codec: the driver returns json columns already parsed and
  // decode re-parses strings, so a top-level string payload would 500
  // every later read of the row (ops queue, poll). A bare string is
  // semantically the question — wrap it.
  const norm = normalizeIntakePayload(rawPayload);
  if (!norm.ok) {
    return norm.error === "too_large"
      ? { ok: false, error: "field_too_large", field: "payload" }
      : { ok: false, error: "invalid" };
  }
  const payload = norm.payload;
  if (meta) {
    for (const [k, v] of Object.entries(meta)) {
      if (v !== undefined && bytes(v) > META_MAX) {
        return { ok: false, error: "field_too_large", field: `meta.${k}` };
      }
    }
  }
  return { ok: true, body: { ...parsed.data, payload } };
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

// Submit-limiter lanes live in submit-lanes.ts (file-size guard,
// SLICE-233-3) — re-exported: existing import sites stay valid.
export { createSubmitLimiter, createSubmitLanes } from "./submit-lanes";
export type { SubmitLanes } from "./submit-lanes";
