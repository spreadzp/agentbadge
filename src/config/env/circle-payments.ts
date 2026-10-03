/**
 * Circle nanopayments config section (EPIC-129 D19, EPIC-140 SLICE-140-25).
 * Optional — only loaded when CIRCLE_PAYMENTS_ENABLED=true.
 */

import type { CirclePaymentsConfig } from "./types";
import { booleanFlag, requiredAddress, requiredString } from "./validators";
import { getChain, type SupportedChain } from "@agentbadge/circle-payments";

/**
 * SLICE-156-1: `CIRCLE_GATEWAY_CHAINS` — CSV of CAIP-2 ids ("eip155:84532")
 * or numeric chain ids. Unknown values fail boot so a typo never yields a
 * silently-vanilla 402 surface.
 */
function loadGatewayChains(errors: string[]): SupportedChain[] | undefined {
  const raw = process.env.CIRCLE_GATEWAY_CHAINS?.trim();
  if (!raw) return undefined;
  const chains: SupportedChain[] = [];
  for (const item of raw.split(",")) {
    const id = item.trim();
    if (!id) continue;
    const chain = getChain(id.startsWith("eip155:") ? id : Number(id));
    if (!chain) {
      errors.push(`CIRCLE_GATEWAY_CHAINS: unknown chain id "${id}"`);
      continue;
    }
    if (!chain.gatewayWallet || !chain.facilitatorUrl) {
      errors.push(
        `CIRCLE_GATEWAY_CHAINS: "${id}" (${chain.name}) is not Gateway-covered`,
      );
      continue;
    }
    if (chains.some((c) => c.caip2 === chain.caip2)) continue;
    chains.push(chain);
  }
  return chains.length > 0 ? chains : undefined;
}

export function loadCirclePayments(
  errors: string[],
): CirclePaymentsConfig | undefined {
  if (!booleanFlag("CIRCLE_PAYMENTS_ENABLED")) return undefined;

  const sellerAddress = requiredAddress("CIRCLE_SELLER_ADDRESS", errors);
  const arc = booleanFlag("CIRCLE_ARC_ENABLED");
  const arcMainnet = booleanFlag("ARC_MAINNET_ENABLED");
  const escrow = booleanFlag("CIRCLE_ESCROW_ENABLED");
  let arcPrivateKey: string | undefined;
  if (arc || escrow) {
    arcPrivateKey = requiredString("ARC_PRIVATE_KEY", errors);
  }
  const attestation = booleanFlag("ARC_ATTESTATION_ENABLED");
  let arcEvaluatorKey: string | undefined;
  if (arcMainnet || attestation) {
    arcEvaluatorKey = requiredString("ARC_EVALUATOR_KEY", errors);
  }
  const circlePayments: CirclePaymentsConfig = {
    enabled: true,
    gateway: booleanFlag("CIRCLE_GATEWAY_ENABLED"),
    gatewayChains: loadGatewayChains(errors),
    gatewayProbeMs: process.env.CIRCLE_GATEWAY_PROBE_MS
      ? Number(process.env.CIRCLE_GATEWAY_PROBE_MS)
      : undefined,
    gatewayDownMs: process.env.CIRCLE_GATEWAY_DOWN_MS
      ? Number(process.env.CIRCLE_GATEWAY_DOWN_MS)
      : undefined,
    gatewayMinDepositUsd:
      process.env.GATEWAY_MIN_DEPOSIT_USD?.trim() || "0.10",
    arc,
    identity: booleanFlag("CIRCLE_IDENTITY_ENABLED"),
    escrow,
    gatewayApiUrl:
      process.env.CIRCLE_GATEWAY_API_URL ??
      "https://gateway-api-testnet.circle.com",
    arcRpcUrl: process.env.ARC_RPC_URL ?? "https://rpc.testnet.arc.network",
    arcChainId: Number(process.env.ARC_CHAIN_ID ?? 5042002),
    arcMainnet,
    arcMainnetRpcUrl:
      process.env.ARC_MAINNET_RPC_URL ?? "https://rpc.mainnet.arc.io",
    arcEvaluatorKey,
    attestation,
    oracleAgentId: process.env.ARC_ORACLE_AGENT_ID,
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
