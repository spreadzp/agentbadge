/**
 * NFT access marketplace config section (EPIC-138 SLICE-138-3, EPIC-140 SLICE-140-25).
 * Optional — only loaded when MARKETPLACE_ENABLED=true.
 */

import type { MarketplaceConfig } from "./types";
import { ADDR_RE, booleanFlag, requiredAddress } from "./validators";

export function loadMarketplace(
  errors: string[],
): MarketplaceConfig | undefined {
  if (!booleanFlag("MARKETPLACE_ENABLED")) return undefined;

  const mkNft = requiredAddress("MARKETPLACE_NFT", errors);
  const mkSplitter = requiredAddress("MARKETPLACE_SPLITTER", errors);
  const mkTreasury =
    process.env.MARKETPLACE_TREASURY ?? process.env.X402_PAY_TO ?? "";
  if (mkTreasury && !ADDR_RE.test(mkTreasury)) {
    errors.push("Invalid MARKETPLACE_TREASURY: expected 0x…40-hex address");
  }
  const mkDurationDays = Number(
    process.env.MARKETPLACE_PASSPORT_DURATION_DAYS ?? 365,
  );
  if (
    !Number.isInteger(mkDurationDays) ||
    mkDurationDays < 1 ||
    mkDurationDays > 365
  ) {
    errors.push("Invalid MARKETPLACE_PASSPORT_DURATION_DAYS: 1-365");
  }
  return {
    enabled: true,
    nftAddress: mkNft ?? "",
    splitterAddress: mkSplitter ?? "",
    usdcAddress:
      process.env.MARKETPLACE_USDC ??
      "0x036CbD53842c5426634e7929541eC2318f3dCF7e", // Base Sepolia USDC
    treasury: mkTreasury,
    passportPriceUsd: process.env.MARKETPLACE_PASSPORT_PRICE_USD ?? "10",
    passportDurationDays: mkDurationDays,
  };
}
