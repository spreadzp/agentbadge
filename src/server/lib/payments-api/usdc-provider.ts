/**
 * DirectUsdcStubProvider — DIRECT_USDC rail stub (SLICE-221-2).
 *
 * Emits self-serve `paymentInstructions` for the buyer to push USDC to
 * a server-configured treasury. On-chain verification/monitoring is
 * out of scope (engine epic) — verifyPayment stays PENDING honestly.
 *
 * SPEC INVARIANT: `recipient`/`tokenContract` in instructions come ONLY
 * from the server-side `networks` map injected here — never from the
 * rail input, so a compromised or buggy caller cannot redirect funds.
 */

import type {
  CreatePaymentInput,
  CreatePaymentResult,
  PaymentProvider,
  PaymentVerificationResult,
} from "@agentbadge/payments";

import type { UsdcNetworkConfig } from "../../../config/env/payments-types";

export type UsdcNetworks = Record<string, UsdcNetworkConfig>;

export class DirectUsdcStubProvider implements PaymentProvider {
  readonly provider = "DIRECT_USDC" as const;
  /** Instructions rail binds network+recipient+token; evidence is USD-free. */
  readonly supports = {
    network: true,
    recipient: true,
    token: true,
    currencies: ["USDC"],
  } as const;

  private readonly networks: UsdcNetworks;

  constructor(options: { networks: UsdcNetworks }) {
    this.networks = options.networks;
  }

  async createPayment(
    input: CreatePaymentInput,
  ): Promise<CreatePaymentResult> {
    const cfg = this.networks[input.network ?? ""];
    if (!cfg) {
      throw new Error(`unsupported USDC network: ${input.network ?? "<none>"}`);
    }
    const paymentId =
      typeof input.metadata?.paymentId === "string"
        ? input.metadata.paymentId
        : input.reference;
    return {
      providerReference: `usdc_${input.network}_${input.reference}`,
      status: "PENDING",
      expiresAt: input.expiresAt,
      metadata: {
        paymentInstructions: {
          network: input.network,
          asset: "USDC",
          amount: input.amount,
          recipient: cfg.recipient,
          tokenContract: cfg.tokenContract,
          reference: paymentId,
          expiresAt: input.expiresAt?.toISOString() ?? null,
        },
      },
    };
  }

  /** Out of scope for 221-2: no on-chain verification yet — honest PENDING. */
  async verifyPayment(): Promise<PaymentVerificationResult> {
    return { status: "PENDING" };
  }
}
