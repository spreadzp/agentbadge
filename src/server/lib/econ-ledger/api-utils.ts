/**
 * Shared helpers for the /api/ledger read-API route files
 * (SLICE-207-5/-6): address validation, error envelope, paging args.
 */

import type { Context } from "hono";

export const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;
const CURSOR_RE = /^\d+$/;
export const DEFAULT_LIMIT = 50;
export const MAX_LIMIT = 200;

export type LedgerErrorCode =
  | "no_data"
  | "invalid_address"
  | "not_found"
  | "unavailable";

export function errJson(
  c: Context,
  status: number,
  code: LedgerErrorCode,
  message: string,
) {
  return c.json({ error: { code, message } }, status as never);
}

/** Page shape that ALSO conforms when carrying the error flag (non-strict schema). */
export function emptyPage(c: Context, code: LedgerErrorCode, message: string) {
  return c.json({
    events: [],
    nextCursor: null,
    error: { code, message },
  });
}

export function emptyEdges(c: Context, code: LedgerErrorCode, message: string) {
  return c.json({ edges: [], error: { code, message } });
}

/** Parse ?cursor&limit — cursor is the last row's ledgerSeq (decimal). */
export function pageArgs(
  c: Context,
): { cursor?: bigint; limit: number } | { err: Response } {
  const raw = c.req.query("cursor");
  if (raw !== undefined && !CURSOR_RE.test(raw)) {
    return {
      err: errJson(
        c,
        400,
        "invalid_address",
        "invalid cursor — expected decimal ledgerSeq",
      ),
    };
  }
  const lim = Number(c.req.query("limit") ?? DEFAULT_LIMIT);
  const limit = Number.isFinite(lim)
    ? Math.min(Math.max(1, lim), MAX_LIMIT)
    : DEFAULT_LIMIT;
  return {
    cursor: raw !== undefined ? BigInt(raw) : undefined,
    limit: Math.floor(limit),
  };
}
