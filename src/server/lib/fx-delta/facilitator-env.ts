/**
 * Env-driven lazy facilitator singleton (SLICE-191-6).
 *
 * Env: FXDELTA_PAY_TO (or X402_PAY_TO), SELLER_PRIVATE_KEY (mode=self),
 * ATTRIBUTION_CODE, CELO_RPC_URL, CELO_CHAIN_ID,
 * X402_MODE=self|facilitator, X402_FACILITATOR_URL, X402_API_KEY.
 * Returns null when premium is not configured.
 */

import { logger } from "@agentbadge/passport";
import type { BstockFacilitator } from "../../middleware/bstock-freemium";
import { createCeloX402Facilitator } from "./celo-settle";

let cached: BstockFacilitator | null | undefined;

export function getFxDeltaFacilitator(): BstockFacilitator | null {
  if (cached !== undefined) return cached;
  const payTo = process.env.FXDELTA_PAY_TO ?? process.env.X402_PAY_TO;
  if (!payTo) {
    cached = null;
    return null;
  }
  const mode =
    (process.env.X402_MODE ?? "self") === "facilitator"
      ? "facilitator"
      : "self";
  const pk = process.env.SELLER_PRIVATE_KEY?.trim();
  if (mode === "self" && !pk) {
    logger.warn(
      "fxdelta premium: X402_MODE=self without SELLER_PRIVATE_KEY — premium disabled",
    );
    cached = null;
    return null;
  }
  cached = createCeloX402Facilitator({
    sellerAddress: payTo as `0x${string}`,
    privateKey: pk as `0x${string}` | undefined,
    attributionCode: process.env.ATTRIBUTION_CODE ?? "celo_fxdelta",
    rpcUrl: process.env.CELO_RPC_URL,
    chainId: process.env.CELO_CHAIN_ID
      ? Number(process.env.CELO_CHAIN_ID)
      : undefined,
    mode,
    facilitatorUrl: process.env.X402_FACILITATOR_URL,
    facilitatorApiKey: process.env.X402_API_KEY,
  });
  return cached;
}

/** Test hook. */
export function resetFxDeltaFacilitator(): void {
  cached = undefined;
}
