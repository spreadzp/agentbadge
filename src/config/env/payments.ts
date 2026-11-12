/**
 * Payments API config section (EPIC-221, SLICE-221-2).
 *
 * Server-side checkout rail configuration — the ONLY source of
 * recipient/tokenContract for DIRECT_USDC paymentInstructions (spec
 * invariant: clients can never supply them).
 *
 *   ARC_USDC_TREASURY    — USDC recipient on Arc (fallback: CIRCLE_TREASURY_ADDRESS)
 *   BASE_USDC_TREASURY   — USDC recipient on Base (fallback: CIRCLE_TREASURY_ADDRESS)
 *   SOLANA_TREASURY_ADDRESS — NEW: USDC recipient on Solana
 *   EVM_USDC_ADDRESS     — Arc USDC token contract (existing)
 *   BASE_USDC_ADDRESS    — Base USDC token contract (existing)
 *   SOLANA_USDC_MINT     — Solana USDC mint (default: mainnet mint)
 *   SOLANA_USDC_NETWORK  — CAIP-2 tag (default: solana mainnet)
 *   EVM_CHAIN_ID / BASE_CHAIN_ID — Arc/Base network tags (existing)
 *   PAYMENTS_USDC_TTL_SEC — instructions expiry TTL (default 3600)
 *
 * A network is exposed only when BOTH recipient and token are
 * configured — partial config is a config error, never a half-bound
 * instruction.
 */

import type { PaymentsConfig } from "./payments-types";
import { ADDR_RE } from "./validators";

const SOLANA_MAINNET_CAIP2 = "solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp";
const SOLANA_USDC_MAINNET_MINT =
  "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v";

function evmTreasury(envName: string, errors: string[]): string | undefined {
  const v =
    process.env[envName] ?? process.env.CIRCLE_TREASURY_ADDRESS ?? "";
  if (v && !ADDR_RE.test(v)) {
    errors.push(`Invalid ${envName}: expected 0x…40-hex address`);
    return undefined;
  }
  return v || undefined;
}

export function loadPayments(errors: string[]): PaymentsConfig {
  const networks: PaymentsConfig["usdcNetworks"] = {};

  const arcChainId = process.env.EVM_CHAIN_ID ?? "1874";
  const arcTreasury = evmTreasury("ARC_USDC_TREASURY", errors);
  const arcToken = process.env.EVM_USDC_ADDRESS ?? "";
  if (arcToken && !ADDR_RE.test(arcToken)) {
    errors.push("Invalid EVM_USDC_ADDRESS: expected 0x…40-hex address");
  }
  if (arcTreasury && arcToken && ADDR_RE.test(arcToken)) {
    networks[`eip155:${arcChainId}`] = {
      recipient: arcTreasury,
      tokenContract: arcToken,
      label: "arc",
    };
  }

  const baseChainId = process.env.BASE_CHAIN_ID ?? "84532";
  const baseTreasury = evmTreasury("BASE_USDC_TREASURY", errors);
  const baseToken = process.env.BASE_USDC_ADDRESS ?? "";
  if (baseToken && !ADDR_RE.test(baseToken)) {
    errors.push("Invalid BASE_USDC_ADDRESS: expected 0x…40-hex address");
  }
  if (baseTreasury && baseToken && ADDR_RE.test(baseToken)) {
    networks[`eip155:${baseChainId}`] = {
      recipient: baseTreasury,
      tokenContract: baseToken,
      label: "base",
    };
  }

  const solanaTreasury = process.env.SOLANA_TREASURY_ADDRESS ?? "";
  const solanaMint = process.env.SOLANA_USDC_MINT ?? SOLANA_USDC_MAINNET_MINT;
  const solanaNetwork =
    process.env.SOLANA_USDC_NETWORK ?? SOLANA_MAINNET_CAIP2;
  if (solanaTreasury) {
    networks[solanaNetwork] = {
      recipient: solanaTreasury,
      tokenContract: solanaMint,
      label: "solana",
    };
  }

  const ttlSec = Number(process.env.PAYMENTS_USDC_TTL_SEC ?? 3600);
  if (!Number.isInteger(ttlSec) || ttlSec < 60 || ttlSec > 86400) {
    errors.push("Invalid PAYMENTS_USDC_TTL_SEC: integer 60-86400");
  }

  // EPIC-222-3: the on-chain monitor confirms real money — explicit
  // opt-in only; never auto-on from the mere presence of ARC_RPC_URL.
  const monitorFlag = process.env.USDC_MONITOR_ENABLED === "true";
  const arcRpcUrl = process.env.ARC_RPC_URL?.trim() || undefined;
  const monitorIntervalMs = Number(
    process.env.USDC_MONITOR_INTERVAL_MS ?? 30_000,
  );
  const monitorLookback = Number(
    process.env.USDC_MONITOR_LOOKBACK_BLOCKS ?? 4096,
  );
  if (
    monitorFlag &&
    (!Number.isInteger(monitorIntervalMs) || monitorIntervalMs < 1000)
  ) {
    errors.push("Invalid USDC_MONITOR_INTERVAL_MS: integer >= 1000");
  }
  if (
    monitorFlag &&
    (!Number.isInteger(monitorLookback) || monitorLookback < 1)
  ) {
    errors.push("Invalid USDC_MONITOR_LOOKBACK_BLOCKS: integer >= 1");
  }
  const hasArcNetwork = Object.values(networks).some(
    (n) => n.label === "arc",
  );

  return {
    usdcNetworks: networks,
    usdcInstructionsTtlSec: ttlSec,
    // H-8: instructions-only stub is opt-in, never on by default.
    usdcSelfServeEnabled:
      process.env.PAYMENTS_USDC_SELF_SERVE === "true",
    usdcMonitor: {
      enabled: Boolean(monitorFlag && arcRpcUrl && hasArcNetwork),
      arcRpcUrl,
      intervalMs: monitorIntervalMs,
      lookbackBlocks: monitorLookback,
    },
  };
}
