/**
 * x402 Payment Middleware for Base Sepolia (EVM).
 *
 * SLICE-90-9: x402 payment middleware for CHAIN_MODE=base.
 *
 * Returns HTTP 402 with payment requirements when no X-PAYMENT header.
 * Verifies payment via facilitator when header is present.
 * Only active when CHAIN_MODE=base.
 */

import type { Context, MiddlewareHandler } from "hono";

export interface BaseX402Config {
  /** Facilitator URL (e.g. https://x402.org/facilitator) */
  facilitatorUrl: string;
  /** Treasury address to receive payments */
  payTo: string;
  /** USDC contract address on Base Sepolia */
  usdcAddress: string;
  /** Chain ID as CAIP-2 namespace (eip155:84532) */
  networkId: string;
  /** Price in USDC base units (6 decimals) */
  price: string;
  /** Resource description */
  description: string;
  /** MIME type of the resource */
  mimeType: string;
  /** Optional facilitator client override (for testing) */
  facilitatorClient?: X402FacilitatorClient;
}

export interface X402FacilitatorClient {
  verify(paymentHeader: string, requirements: PaymentRequirements): Promise<VerifyResult>;
  settle(paymentHeader: string, requirements: PaymentRequirements): Promise<SettleResult>;
}

export interface PaymentRequirements {
  scheme: string;
  network: string;
  asset: string;
  amount: string;
  payTo: string;
  description: string;
  mimeType: string;
  maxAmountRequired: string;
  resource: string;
}

export interface VerifyResult {
  valid: boolean;
  error?: string;
}

export interface SettleResult {
  success: boolean;
  transaction?: string;
  error?: string;
}

export interface X402PaymentRequirementsResponse {
  x402Version: number;
  error: string;
  accepts: PaymentRequirements;
}

function buildRequirements(cfg: BaseX402Config, resource: string): PaymentRequirements {
  return {
    scheme: "exact",
    network: cfg.networkId,
    asset: cfg.usdcAddress,
    amount: cfg.price,
    payTo: cfg.payTo,
    description: cfg.description,
    mimeType: cfg.mimeType,
    maxAmountRequired: cfg.price,
    resource,
  };
}

function return402(c: Context, requirements: PaymentRequirements): Response {
  const body: X402PaymentRequirementsResponse = {
    x402Version: 1,
    error: "Payment required",
    accepts: requirements,
  };
  return c.json(body, 402);
}

export function baseX402PaymentMiddleware(cfg: BaseX402Config): MiddlewareHandler {
  const facilitator: X402FacilitatorClient =
    cfg.facilitatorClient ??
    new HTTPFacilitator(cfg.facilitatorUrl);

  return async (c, next) => {
    const paymentHeader = c.req.header("X-PAYMENT");

    // No payment header → return 402 with requirements
    if (!paymentHeader) {
      const resource = `${c.req.method} ${c.req.path}`;
      const requirements = buildRequirements(cfg, resource);
      return return402(c, requirements);
    }

    // Verify payment
    const resource = `${c.req.method} ${c.req.path}`;
    const requirements = buildRequirements(cfg, resource);

    const verifyResult = await facilitator.verify(paymentHeader, requirements);
    if (!verifyResult.valid) {
      return c.json(
        {
          x402Version: 1,
          error: verifyResult.error ?? "Payment verification failed",
          accepts: requirements,
        },
        402,
      );
    }

    // Settle payment
    const settleResult = await facilitator.settle(paymentHeader, requirements);
    if (!settleResult.success) {
      return c.json(
        {
          x402Version: 1,
          error: settleResult.error ?? "Payment settlement failed",
          accepts: requirements,
        },
        402,
      );
    }

    // Payment settled — add receipt header and continue
    if (settleResult.transaction) {
      c.header("X-PAYMENT-RESPONSE", settleResult.transaction);
    }
    await next();
  };
}

/** Simple HTTP facilitator client */
export class HTTPFacilitator implements X402FacilitatorClient {
  constructor(private url: string) {}

  async verify(paymentHeader: string, requirements: PaymentRequirements): Promise<VerifyResult> {
    try {
      const resp = await fetch(`${this.url}/verify`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentHeader, requirements }),
      });
      const data = await resp.json() as { valid: boolean; error?: string };
      return { valid: data.valid, error: data.error };
    } catch (e) {
      return { valid: false, error: String(e) };
    }
  }

  async settle(paymentHeader: string, requirements: PaymentRequirements): Promise<SettleResult> {
    try {
      const resp = await fetch(`${this.url}/settle`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ paymentHeader, requirements }),
      });
      const data = await resp.json() as { success: boolean; transaction?: string; error?: string };
      return { success: data.success, transaction: data.transaction, error: data.error };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }
}
