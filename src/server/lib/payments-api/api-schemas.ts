/**
 * Request/response zod schemas for the payments API (SLICE-221-2;
 * hardened in SLICE-221-7 — field caps, strict objects, network regex).
 */

import { z } from "zod";

import { CONTRACT_LIMITS } from "../machine-entry";

/** CAIP-2-ish network tag — starts alphanumeric (uppercase allowed for
 *  base58 refs like solana:5eyk…), never `__proto__`/`constructor` etc. */
const NETWORK_RE = /^[a-zA-Z0-9][a-zA-Z0-9:_-]{0,63}$/;

/** H-3: Idempotency-Key header — shared contract limits (8–128 chars). */
export const idempotencyKeySchema = z
  .string()
  .min(CONTRACT_LIMITS.idempotencyKey.min)
  .max(CONTRACT_LIMITS.idempotencyKey.max);

export const createPaymentSchema = z
  .object({
    productCode: z.string().min(1).max(64),
    // M-5: single-entitlement products — the service rejects >1 too.
    quantity: z.number().int().min(1).max(1).optional(),
    metadata: z
      .record(z.string().max(64), z.unknown())
      .refine(
        (m) => Object.keys(m).length <= 50,
        "metadata exceeds 50 keys",
      )
      .optional(),
    customerId: z.string().max(128).optional(),
    agentId: z.string().max(128).optional(),
  })
  .strict();

export const createAttemptSchema = z
  .object({
    provider: z.enum(["STRIPE", "DIRECT_USDC"]),
    network: z.string().regex(NETWORK_RE).optional(),
  })
  // Spec invariant — recipient/tokenContract/token must NEVER come from
  // a client; the route rejects them with forbidden_field before parse.
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
