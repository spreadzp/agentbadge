/**
 * Circle nanopayments config section (EPIC-129 D19, EPIC-140 SLICE-140-25).
 * Optional — only loaded when CIRCLE_PAYMENTS_ENABLED=true.
 */

import type { CirclePaymentsConfig } from "./types";
import { booleanFlag, requiredAddress, requiredString } from "./validators";

export function loadCirclePayments(
  errors: string[],
): CirclePaymentsConfig | undefined {
  if (!booleanFlag("CIRCLE_PAYMENTS_ENABLED")) return undefined;

  const sellerAddress = requiredAddress("CIRCLE_SELLER_ADDRESS", errors);
  const arc = booleanFlag("CIRCLE_ARC_ENABLED");
  const escrow = booleanFlag("CIRCLE_ESCROW_ENABLED");
  let arcPrivateKey: string | undefined;
  if (arc || escrow) {
    arcPrivateKey = requiredString("ARC_PRIVATE_KEY", errors);
  }
  const circlePayments: CirclePaymentsConfig = {
    enabled: true,
    gateway: booleanFlag("CIRCLE_GATEWAY_ENABLED"),
    arc,
    identity: booleanFlag("CIRCLE_IDENTITY_ENABLED"),
    escrow,
    gatewayApiUrl:
      process.env.CIRCLE_GATEWAY_API_URL ??
      "https://gateway-api-testnet.circle.com",
    arcRpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    arcChainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    sellerAddress: sellerAddress ?? "",
    arcPrivateKey,
    platformFeeBps: Number(process.env.CIRCLE_PLATFORM_FEE_BPS ?? 0),
    treasuryAddress: process.env.CIRCLE_TREASURY_ADDRESS,
  };
  if (circlePayments.platformFeeBps > 0 && !circlePayments.treasuryAddress) {
    errors.push(
      "CIRCLE_TREASURY_ADDRESS required when CIRCLE_PLATFORM_FEE_BPS > 0",
    );
  }
  return circlePayments;
}
