/**
 * Checkout error surface (SLICE-221-2). Codes map 1:1 onto
 * ErrorCodes payments entries — the route layer casts CheckoutError.code
 * straight into the error envelope.
 */

export type CheckoutErrorCode =
  | "invalid_metadata"
  | "unknown_product"
  | "no_usd_price"
  | "invalid_quantity"
  | "payment_not_found"
  | "payment_not_payable"
  | "invalid_provider"
  | "provider_unavailable"
  | "network_not_supported"
  | "forbidden_field"
  | "rail_error"
  | "idempotency_conflict";

export class CheckoutError extends Error {
  constructor(
    public readonly code: CheckoutErrorCode,
    public readonly status: 400 | 404 | 409 | 502 | 503,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "CheckoutError";
  }
}
