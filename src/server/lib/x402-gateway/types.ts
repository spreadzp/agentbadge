/**
 * SLICE-223-3: x402 gateway type boundary (D-223-11).
 *
 * Transport shapes come from `@x402/core` (official protocol types).
 * Domain shapes come from `@agentbadge/payments` (transport-free).
 * Nothing here is hand-rolled — the file only names the seam.
 */

export type {
  Network,
  PaymentPayload,
  PaymentRequired,
  PaymentRequirements as X402PaymentRequirements,
  ResourceInfo,
  SettleResponse,
} from "@x402/core/types";

export type {
  PaidResource,
  PaymentRequirements as GatewayPaymentRequirements,
  PriceResolution,
  PriceResolver,
} from "@agentbadge/payments";
