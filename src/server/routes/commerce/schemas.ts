/**
 * SLICE-224-3 (EPIC-224): zod schemas + openapi response helpers for the
 * commerce route files (tasks/offers/flows). Split out of shared.ts
 * (SLICE-224-6: 300-line file cap).
 */

import z from "zod";
import {
  resolver,
  type DescribeRouteOptions,
  type ResponsesWithResolver,
} from "hono-openapi";
import { errorSchema } from "../../openapi";

// ─── zod schemas (openapi request/response) ───────────────────────

export const taskCreateSchema = z.object({
  title: z.string(),
  description: z.string().max(4000),
  // SLICE-234-23: object/array/null only — the pg/json@1 codec rejects
  // bare scalars (string/number/bool) with a 500. Honest 400 instead.
  requirements: z
    .union([z.record(z.string(), z.unknown()), z.array(z.unknown()), z.null()])
    .optional(),
  budget: z.string().nullable().optional(),
  currency: z.string().optional(),
  expiresAtMs: z.number().nullable().optional(),
  status: z.enum(["DRAFT", "OPEN"]).optional(),
  buyerAgentId: z.string().nullable().optional(),
  // D-227: parallel provider slots — accept allowed while
  // non-terminal agreements < maxProviders.
  maxProviders: z.number().int().min(1).max(32).optional(),
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
  // D-227: milestoneId inside the agreement's settlement plan.
  milestoneRef: z.string().min(1).max(128).nullable().optional(),
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
