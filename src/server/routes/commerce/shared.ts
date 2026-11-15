/**
 * SLICE-224-3 (EPIC-224): shared helpers + zod schemas for the
 * commerce route files (tasks/offers/flows).
 */

import { isAddress } from "viem";
import type { Context } from "hono";
import z from "zod";
import {
  resolver,
  type DescribeRouteOptions,
  type ResponsesWithResolver,
} from "hono-openapi";
import { verifyWalletSigRequest } from "../../middleware/agent-auth";
import { errorResponse } from "../../lib/error-response";
import { ErrorCodes } from "../../lib/error-codes";
import { errorSchema } from "../../openapi";
import { CommerceError } from "../../lib/commerce";

/** EIP-191 sig gate for writes — returns lowercase wallet or 401. */
export async function requireWallet(
  c: Context,
): Promise<{ wallet: string } | Response> {
  const walletHdr = c.req.header("x-wallet");
  const check = await verifyWalletSigRequest({
    wallet: walletHdr,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  if (check !== "valid" || !walletHdr || !isAddress(walletHdr)) {
    return errorResponse(
      c,
      401,
      ErrorCodes.WRONG_SIGNER,
      "valid X-Wallet/X-Sig/X-Timestamp required",
    );
  }
  return { wallet: walletHdr.toLowerCase() };
}

export const IDEM_HEADER = "idempotency_key";

export function idemKey(c: Context): string | undefined {
  return c.req.header(IDEM_HEADER) ?? undefined;
}

export async function readJson(
  c: Context,
): Promise<Record<string, unknown> | Response> {
  try {
    const body = (await c.req.json()) as unknown;
    if (!body || typeof body !== "object" || Array.isArray(body)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "JSON object body required");
    }
    return body as Record<string, unknown>;
  } catch {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON body");
  }
}

/** Map CommerceError → canonical error shape; rethrows unknown errors. */
export function commerceError(c: Context, err: unknown): Response {
  if (err instanceof CommerceError) {
    switch (err.code) {
      case "NOT_FOUND":
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, err.message);
      case "FORBIDDEN":
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER, err.message);
      case "INVALID_TRANSITION":
        return errorResponse(c, 409, ErrorCodes.INVALID_TRANSITION, err.message);
      case "GUARD_REJECTED":
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, err.message);
      case "CONFLICT":
        return errorResponse(c, 409, ErrorCodes.CONFLICT, err.message);
    }
  }
  throw err;
}

// ─── zod schemas (openapi request/response) ───────────────────────

export const taskCreateSchema = z.object({
  title: z.string(),
  description: z.string().max(4000),
  requirements: z.unknown().optional(),
  budget: z.string().nullable().optional(),
  currency: z.string().optional(),
  expiresAtMs: z.number().nullable().optional(),
  status: z.enum(["DRAFT", "OPEN"]).optional(),
  buyerAgentId: z.string().nullable().optional(),
  payload: z.unknown().optional(),
});

export const offerSubmitSchema = z.object({
  price: z.string(),
  currency: z.string().optional(),
  eta: z.string().nullable().optional(),
  proposal: z.string(),
  providerAgentId: z.string().nullable().optional(),
  payload: z.unknown().optional(),
});

export const submissionCreateSchema = z.object({
  summary: z.string().max(4000),
  resultUrl: z.string().nullable().optional(),
  evidenceRefs: z.array(z.string()).max(50).optional(),
  payload: z.unknown().optional(),
});

export const reviewSchema = z.object({
  verdict: z.enum(["ACCEPTED", "REJECTED", "REVISION_REQUIRED"]),
  reviewNote: z.string().optional(),
});

export const evidenceSchema = z.object({
  type: z.enum(["FILE", "HASH", "TRANSACTION", "URL", "API_RESPONSE", "ATTESTATION"]),
  url: z.string().nullable().optional(),
  hash: z.string().nullable().optional(),
  content: z.string().nullable().optional(),
  metadata: z.unknown().nullable().optional(),
  payload: z.unknown().optional(),
});

export const paymentRecordSchema = z.object({
  amount: z.string().nullable().optional(),
  paymentId: z.string().nullable().optional(),
  note: z.string().nullable().optional(),
});

export const patchTaskSchema = z.object({
  status: z.literal("OPEN"),
});

// ─── response helpers ─────────────────────────────────────────────

export const row = z.record(z.string(), z.unknown());

export const ok = (
  schema: z.ZodType,
  description = "OK",
): ResponsesWithResolver => ({
  200: {
    description,
    content: { "application/json": { schema: resolver(schema) } },
  },
});

export const created = (
  schema: z.ZodType,
  description = "Created",
): ResponsesWithResolver => ({
  201: {
    description,
    content: { "application/json": { schema: resolver(schema) } },
  },
});

export const errs = (...codes: number[]): ResponsesWithResolver =>
  Object.fromEntries(
    codes.map((code) => [
      code,
      {
        description: "Error",
        content: { "application/json": { schema: resolver(errorSchema) } },
      },
    ]),
  );

/** describeRoute requestBody wrapper for JSON bodies. */
export const jsonBody = (
  schema: z.ZodType,
  required = true,
): NonNullable<DescribeRouteOptions["requestBody"]> => ({
  required,
  content: { "application/json": { schema: resolver(schema) } },
});
