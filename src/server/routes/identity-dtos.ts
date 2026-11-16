/**
 * Public DTO + body/limit helpers for the identity read/write routes
 * (split from identity-api.ts to keep it under the file-size lint).
 *
 * Audit H-6 / v2 N-14: public reads return WHITELISTED fields — the
 * DTOs enumerate what they emit rather than stripping a denylist, so
 * a newly added store field can never leak by default. `payload`
 * (internal annotations), `idempotencyKey`/`dedupeKey` (internal
 * dedupe rails), `sourcePaymentId` (payment provenance → purchase
 * history) and `activeSlot` never leave the process via these
 * routes. `sourceRef` stays — it IS the reputation verifiability
 * anchor (D-225-5).
 */
import type {
  ActorRow,
  EntitlementRow,
  ReputationFactRow,
} from "@agentbadge/database";
import type { Context } from "hono";
import z from "zod";

import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";
import { IdentityError } from "../lib/identity";

export interface PublicActor {
  wallet: string;
  type: string;
  agentId: string | null | undefined;
  passportTokenId: string | null | undefined;
  did: string | null | undefined;
  orgId: string | null | undefined;
  tier: string | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export function publicActor(a: ActorRow): PublicActor {
  return {
    wallet: a.wallet,
    type: a.type,
    agentId: a.agentId,
    passportTokenId: a.passportTokenId,
    did: a.did,
    orgId: a.orgId,
    tier: a.tier,
    createdAt: a.createdAt,
    updatedAt: a.updatedAt,
  };
}

export interface PublicEntitlement {
  id: string;
  ownerId: string;
  productCode: string;
  status: string;
  validFromMs: number;
  validUntilMs: number | null | undefined;
  createdAt: string;
  updatedAt: string;
}

export function publicEntitlement(e: EntitlementRow): PublicEntitlement {
  return {
    id: e.id,
    ownerId: e.ownerId,
    productCode: e.productCode,
    status: e.status,
    validFromMs: e.validFromMs,
    validUntilMs: e.validUntilMs,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  };
}

export interface PublicFact {
  id: string;
  actorWallet: string;
  factType: string;
  subjectId: string | null | undefined;
  sourceRef: string;
  atMs: number;
  createdAt: string;
}

export function publicFact(f: ReputationFactRow): PublicFact {
  return {
    id: f.id,
    actorWallet: f.actorWallet,
    factType: f.factType,
    subjectId: f.subjectId,
    sourceRef: f.sourceRef,
    atMs: f.atMs,
    createdAt: f.createdAt,
  };
}

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

// ---------- request schemas + error mapping (identity-api.ts) ----------

export const actorSchema = z.record(z.string(), z.unknown());
export const entitlementListSchema = z.object({
  wallet: z.string(),
  entitlements: z.array(z.record(z.string(), z.unknown())),
});
export const reputationSchema = z.object({
  wallet: z.string(),
  counts: z.record(z.string(), z.number()),
  facts: z.array(z.record(z.string(), z.unknown())),
});
export const enrichSchema = z
  .object({
    // Audit v2 N-13: bounded strings — the service re-checks, the
    // route rejects junk early.
    agentId: z.string().min(1).max(256).nullable().optional(),
    passportTokenId: z.string().min(1).max(256).nullable().optional(),
    did: z
      .string()
      .min(4)
      .max(256)
      .regex(/^did:[a-zA-Z0-9]+:[A-Za-z0-9._:%-]+$/, "did:<method>:<id>")
      .nullable()
      .optional(),
    orgId: z.string().min(1).max(128).nullable().optional(),
    // Audit H-1: `tier` is an internal association (passport/grant
    // flows write it) — never self-asserted via this surface.
    type: z
      .enum(["EXTERNAL_AGENT", "EXTERNAL_HUMAN", "ORGANIZATION"])
      .optional(),
  })
  .strict();
export const revokeSchema = z.object({
  productCode: z.string().min(1).max(64),
});

type HttpStatus = 400 | 401 | 403 | 404 | 409 | 503;

export function mapIdentityError(c: Context, e: unknown): Response {
  if (e instanceof IdentityError) {
    const status = (e.httpStatus as HttpStatus) ?? 400;
    const code =
      e.code === "NOT_FOUND"
        ? ErrorCodes.RESOURCE_NOT_FOUND
        : e.code === "CONFLICT"
          ? ErrorCodes.CONFLICT
          : ErrorCodes.INVALID_INPUT;
    return errorResponse(c, status, code, e.message);
  }
  throw e;
}
