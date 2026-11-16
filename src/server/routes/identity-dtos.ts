/**
 * Public DTO + body/limit helpers for the identity read/write routes
 * (split from identity-api.ts to keep it under the file-size lint).
 *
 * Audit H-6: public reads return whitelisted fields only — `payload`
 * (internal annotations), `idempotencyKey` (internal dedupe rail) and
 * `sourcePaymentId` (payment-record provenance → reveals purchase
 * history) never leave the process via these routes. `sourceRef`
 * stays — it IS the reputation verifiability anchor (D-225-5).
 */
import type { Context } from "hono";

import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

export const publicActor = <T extends { payload: unknown }>(
  a: T,
): Omit<T, "payload"> => {
  const { payload: _p, ...rest } = a;
  return rest;
};

export const publicEntitlement = <
  T extends {
    payload: unknown;
    idempotencyKey: unknown;
    sourcePaymentId?: unknown;
  },
>(
  e: T,
): Omit<T, "payload" | "idempotencyKey" | "sourcePaymentId"> => {
  const {
    payload: _p,
    idempotencyKey: _i,
    sourcePaymentId: _s,
    ...rest
  } = e;
  return rest;
};

export const publicFact = <T extends { payload: unknown }>(
  f: T,
): Omit<T, "payload"> => {
  const { payload: _p, ...rest } = f;
  return rest;
};

/** `?limit=` — integer clamp to [1, 500], default 100 (audit M-6). */
export function parseLimit(raw: string | undefined): number {
  const n = Number(raw ?? 100);
  if (!Number.isFinite(n)) return 100;
  return Math.min(Math.max(Math.floor(n), 1), 500);
}

/** zod parse → 400 (audit M-6 — a thrown ZodError was a 500). */
export function parseBody<T>(
  c: Context,
  schema: {
    safeParse(v: unknown): { success: boolean; data?: T; error?: unknown };
  },
  raw: unknown,
): T | Response {
  const parsed = schema.safeParse(raw);
  if (!parsed.success || parsed.data === undefined) {
    return errorResponse(
      c,
      400,
      ErrorCodes.INVALID_INPUT,
      "request body failed schema validation",
    );
  }
  return parsed.data;
}
