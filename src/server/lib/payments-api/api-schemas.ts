/**
 * Request/response zod schemas for the payments API (SLICE-221-2).
 */

import { z } from "zod";

export const createPaymentSchema = z.object({
  productCode: z.string().min(1),
  quantity: z.number().int().min(1).max(1000).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  customerId: z.string().optional(),
  agentId: z.string().optional(),
});

export const createAttemptSchema = z
  .object({
    provider: z.enum(["STRIPE", "DIRECT_USDC"]),
    network: z.string().optional(),
    // Spec invariant — these must NEVER come from a client. Presence is
    // rejected in the route with forbidden_field, not silently ignored.
    recipient: z.never().optional(),
    tokenContract: z.never().optional(),
    token: z.never().optional(),
  })
  .strict();

export const paymentJson = z.object({
  id: z.string(),
  reference: z.string(),
  status: z.string(),
  amount: z.string(),
  currency: z.string(),
  productCode: z.string().optional(),
});

export const attemptJson = z.object({
  id: z.string(),
  paymentId: z.string(),
  provider: z.string(),
  status: z.string(),
  network: z.string().optional(),
  expiresAt: z.string().optional(),
});
