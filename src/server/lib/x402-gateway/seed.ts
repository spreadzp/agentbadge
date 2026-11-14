/**
 * SLICE-223-5: pilot wiring seed for x402GatewayMiddleware.
 *
 * Registry comes from the package-level pilot seed (D-223-2 fallback);
 * the network is env-driven so testnet/prod flip without code changes.
 * `acceptsFor` is the router bridge the middleware uses to fill the
 * 402 accepts[] — the same `router.acceptsFor(amount)` the seam stamps
 * on refusal, keeping advertised and verified rails identical.
 */

import type { PaymentRouter } from "@agentbadge/circle-payments";
import {
  ARC_TESTNET_CAIP2,
  createPilotRegistry,
  type ResourceRegistry,
} from "@agentbadge/payments";

import type { X402PaymentRequirements } from "./types.js";

/** Arc CAIP-2 tag the pilots gate on — testnet default, prod flips via env. */
export function pilotNetwork(): string {
  return process.env.X402_GATEWAY_NETWORK ?? ARC_TESTNET_CAIP2;
}

/** Pilot registry (passport-request + fx-delta-premium) for the network. */
export function createGatewayRegistry(): ResourceRegistry {
  return createPilotRegistry(pilotNetwork());
}

/** Router accepts for an atomic amount — the 402 advertised rails. */
export function acceptsFor(
  router: PaymentRouter,
  amountAtomic: string,
): X402PaymentRequirements[] {
  return router.acceptsFor(
    amountAtomic,
  ) as unknown as X402PaymentRequirements[];
}
