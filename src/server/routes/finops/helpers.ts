/**
 * SLICE-226-6 — shared helpers for the finops route modules. Split
 * out of finops.ts so the action/ops subrouters no longer import
 * their parent (circular import) and so finops.ts stays under the
 * size cap.
 *
 * - `respond` maps FinOpsResult error codes to HTTP statuses and
 *   escapes error text in the HTMX fragment (M4).
 * - `dateParam` is strict YYYY-MM-DD — permissive parsing is a bug
 *   source (M5); `null` means "present but invalid".
 * - `parseEvidence` accepts structured JSON objects as well as
 *   JSON-in-string form fields (H1).
 */

import type { Context } from "hono";
import { html } from "hono/html";

import type { Database } from "@agentbadge/database";

import type {
  FinOpsErrorCode,
  FinOpsResult,
  StripeRefundClient,
  VerifyRefundTx,
} from "../../lib/finops/types";
import { isHtmxRequest } from "../ui/helpers";

/** Injected seams — tests pass stubs; prod defaults lazily. */
export interface FinopsRouteDeps {
  getDb?: () => Database;
  verifyRefundTx?: VerifyRefundTx;
  /** Stripe SDK-shaped client; absent → Stripe path 503s. */
  stripeClient?: StripeRefundClient | null;
}

/**
 * Strict `YYYY-MM-DD` → start/end of UTC day in ms.
 * undefined = param absent; null = present but invalid (caller 400s).
 */
export function dateParam(
  v: string | undefined | null,
  endOfDay = false,
): number | null | undefined {
  if (v === undefined || v === null) return undefined;
  const s = v.trim();
  if (s === "") return undefined;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return null;
  const ms = Date.parse(`${s}T00:00:00Z`);
  if (!Number.isFinite(ms)) return null;
  // Round-trip: 2025-02-31 must not silently become 2025-03-03.
  if (new Date(ms).toISOString().slice(0, 10) !== s) return null;
  return endOfDay ? ms + 86_399_999 : ms;
}

/** Domain error → HTTP status (OpenAPI docs promise 404/409/503). */
const STATUS_BY_CODE: Record<FinOpsErrorCode, number> = {
  OPERATOR_REQUIRED: 400,
  EVIDENCE_TOO_LARGE: 400,
  BAD_INPUT: 400,
  TX_UNVERIFIED: 400,
  TX_REUSED: 409,
  NOT_FOUND: 404,
  INVALID_STATE: 409,
  PROVIDER_ERROR: 503,
};

const OK_FRAG =
  '<div class="rounded border border-emerald-800 bg-emerald-900/40 px-3 py-2 text-emerald-300">OK</div>';

/** JSON for API clients, escaped HTML status fragment for HTMX posts. */
export function respond<T>(
  c: Context,
  result: FinOpsResult<T>,
  okStatus = 200,
): Response {
  if (!isHtmxRequest(c)) {
    return result.ok
      ? c.json(result.value, okStatus as 200)
      : c.json(
          { error: result.error },
          STATUS_BY_CODE[result.error.code] as 400,
        );
  }
  const frag = result.ok
    ? OK_FRAG
    : // html`` escapes interpolations — error text can carry ids/txHash
      // from request input and must not inject markup (M4).
      html`<div class="rounded border border-red-800 bg-red-900/40 px-3 py-2 text-red-300">${`${result.error.code}: ${result.error.message}`}</div>`.toString();
  return c.html(
    frag,
    result.ok
      ? (okStatus as 200)
      : (STATUS_BY_CODE[result.error.code] as 400),
  );
}

/** Ops mutations carry small bodies — 64 KB is generous (M7). */
const BODY_MAX_BYTES = 64 * 1024;

/** POST body from JSON or form-urlencoded (HTMX default). */
export async function readBody(
  c: Context,
): Promise<Record<string, unknown>> {
  const len = Number(c.req.header("content-length"));
  if (Number.isFinite(len) && len > BODY_MAX_BYTES) {
    return {}; // oversized → fields read as absent → guard 400s
  }
  const ct = c.req.header("content-type") ?? "";
  if (ct.includes("application/json")) {
    try {
      const b = (await c.req.json()) as Record<string, unknown>;
      return b && typeof b === "object" ? b : {};
    } catch {
      return {};
    }
  }
  try {
    const b = await c.req.parseBody();
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(b)) {
      if (typeof v === "string") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

export const str = (v: unknown): string | undefined =>
  typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;

/** Evidence field: structured objects pass through (H1); strings are
 *  JSON-parsed when possible, else kept raw. */
export function parseEvidence(v: unknown): unknown {
  if (v !== null && typeof v === "object") return v;
  const s = str(v);
  if (!s) return undefined;
  try {
    return JSON.parse(s);
  } catch {
    return s;
  }
}

/** Route-level list limit — clamps to a safe positive range. */
export function listLimit(v: unknown, fallback = 200, max = 500): number {
  const n = Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(Math.floor(n), max);
}
