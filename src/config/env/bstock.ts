/**
 * bStock tracker config section (EPIC-141, SLICE-141-6).
 * Optional — only loaded when BSTOCK_ENABLED=true.
 *
 * MCP_AGENT_TOKENS=agent1:token1,agent2:token2 (Q4b) — bearer tokens
 * for /mcp/bstock namespace auth.
 */

import { keccak256, encodePacked, stringToHex } from "viem";
import type { BstockEnvConfig } from "./types";
import { booleanFlag } from "./validators";

const DEFAULT_RATE_LIMIT_PER_MIN = 60;
const DEFAULT_MAX_SSE = 20;

// ─── Freemium constants (141-7) — live here so env stays a leaf ──────
export const BSTOCK_SERVICE_NAME = "bstock-delta-realtime";
export const BSTOCK_PRICE_USD = "5";
export const BSTOCK_DURATION_DAYS = 30;
export const BSTOCK_DURATION_SEC = BSTOCK_DURATION_DAYS * 86_400;

/** Seller passport id — env override for the real on-chain registration. */
export const BSTOCK_PASSPORT_ID = BigInt(
  process.env.BSTOCK_SELLER_PASSPORT_ID ?? "0",
);

/** Deterministic serviceId — keccak256(passportId, bytes32(subId)). */
export const BSTOCK_SERVICE_ID: `0x${string}` = keccak256(
  encodePacked(
    ["uint256", "bytes32"],
    [
      BSTOCK_PASSPORT_ID,
      stringToHex(BSTOCK_SERVICE_NAME, { size: 32 }),
    ],
  ),
);

export function loadBstock(errors: string[]): BstockEnvConfig | undefined {
  if (!booleanFlag("BSTOCK_ENABLED")) return undefined;

  const agentTokens = new Map<string, string>();
  const raw = process.env.MCP_AGENT_TOKENS;
  if (!raw || !raw.trim()) {
    errors.push("MCP_AGENT_TOKENS required when BSTOCK_ENABLED=true");
  } else {
    for (const pair of raw.split(",")) {
      const trimmed = pair.trim();
      if (!trimmed) continue;
      const idx = trimmed.indexOf(":");
      if (idx <= 0 || idx === trimmed.length - 1) {
        errors.push(
          `Invalid MCP_AGENT_TOKENS entry "${trimmed}": expected agent:token`,
        );
        continue;
      }
      const agent = trimmed.slice(0, idx).trim();
      const token = trimmed.slice(idx + 1).trim();
      agentTokens.set(token, agent);
    }
    if (agentTokens.size === 0) {
      errors.push("MCP_AGENT_TOKENS parsed to zero valid agent:token pairs");
    }
  }

  const rateLimitPerMin = Number(
    process.env.BSTOCK_RATE_LIMIT_PER_MIN ?? DEFAULT_RATE_LIMIT_PER_MIN,
  );
  if (!Number.isFinite(rateLimitPerMin) || rateLimitPerMin <= 0) {
    errors.push("BSTOCK_RATE_LIMIT_PER_MIN must be a positive number");
  }

  const maxSseConnections = Number(
    process.env.BSTOCK_MAX_SSE_CONNECTIONS ?? DEFAULT_MAX_SSE,
  );
  if (!Number.isFinite(maxSseConnections) || maxSseConnections <= 0) {
    errors.push("BSTOCK_MAX_SSE_CONNECTIONS must be a positive number");
  }

  return {
    enabled: true,
    agentTokens,
    rateLimitPerMin,
    maxSseConnections,
    serviceId: (process.env.BSTOCK_SERVICE_ID ??
      BSTOCK_SERVICE_ID) as `0x${string}`,

    priceUsd: process.env.BSTOCK_PRICE_USD ?? BSTOCK_PRICE_USD,
    durationSec: Number(
      process.env.BSTOCK_PASS_DURATION_SEC ?? BSTOCK_DURATION_SEC,
    ),
    payTo: process.env.X402_PAY_TO ?? "",
    facilitatorUrl: process.env.X402_FACILITATOR_URL ?? "",
  };
}
