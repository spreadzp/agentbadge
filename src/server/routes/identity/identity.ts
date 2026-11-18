/**
 * SLICE-129-11: Verification endpoint — GET /api/identity/:address
 *
 * Public paid endpoint (~$0.001 via requirePayment, dogfooding D22)
 * returning passport data for an address — the verifyUrl referenced in
 * the 402 identity extension. Deps are injected; wiring happens in
 * SLICE-129-14 behind the `identity` flag.
 */

import { Hono } from "hono";
import type { Context, Next } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

/**
 * Passport data resolved by the injected lookup (Hedera NFT + score).
 * Canonical definition lives in @agentbadge/circle-payments (EPIC-150,
 * D3) — re-exported here for back-compat with existing imports.
 */
export type { IdentityLookupResult } from "@agentbadge/circle-payments";
import type { IdentityLookupResult } from "@agentbadge/circle-payments";

/**
 * Structural middleware signature — avoids nominal mismatch between the
 * server's hono and the package's hono types (file: dep, dual installs).
 */
export type PaymentMiddleware = (
  c: Context,
  next: Next,
) => Response | Promise<Response> | void | Promise<void>;

export interface IdentityRoutesDeps {
  /** requirePayment("$0.001", …) middleware from @agentbadge/circle-payments */
  payment: PaymentMiddleware;
  /** Resolve passport data for an EVM address; undefined = no passport */
  lookup: (address: string) => Promise<IdentityLookupResult | undefined>;
}

const EVM_ADDRESS = /^0x[0-9a-fA-F]{40}$/;

const identityResponseSchema = z.object({
  address: z.string(),
  passportTokenId: z.string(),
  readinessScore: z.number().optional(),
  mintTx: z.string().optional(),
  issuedAt: z.string().optional(),
  chain: z.string().optional(),
  verifiedAt: z.string(),
});

const errorSchema = z.object({ error: z.string() });

export function createIdentityRoutes(deps: IdentityRoutesDeps): Hono {
  const routes = new Hono();

  routes.get(
    "/api/identity/:address",
    describeRoute({
      description:
        "Passport identity for an EVM address (paid x402 endpoint, $0.001)",
      responses: {
        200: {
          description: "Passport data for the address",
          content: {
            "application/json": {
              schema: resolver(identityResponseSchema),
            },
          },
        },
        400: {
          description: "Malformed address",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
        402: { description: "Payment required (x402)" },
        404: {
          description: "No passport for address",
          content: { "application/json": { schema: resolver(errorSchema) } },
        },
      },
    }),
    deps.payment,
    async (c) => {
      const address = c.req.param("address");
      if (!EVM_ADDRESS.test(address)) {
        return c.json({ error: "invalid_address" }, 400);
      }
      const passport = await deps.lookup(address);
      if (!passport) {
        return c.json({ error: "not_found" }, 404);
      }
      return c.json({
        address,
        ...passport,
        verifiedAt: new Date().toISOString(),
      });
    },
  );

  return routes;
}
