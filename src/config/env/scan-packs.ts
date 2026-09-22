/**
 * Scan pack (rule bundle) config section (EPIC-133 D4, EPIC-140 SLICE-140-25).
 * Always built — `enabled`/`pricingEnabled` flags gate features inside.
 */

import type { ScanPacksConfig } from "./types";
import { booleanFlag } from "./validators";

export function loadScanPacks(): ScanPacksConfig {
  const priceOverrides: ScanPacksConfig["priceOverrides"] = {};
  for (const [envKey, cls] of [
    ["SCAN_PRICE_LIGHT", "light"],
    ["SCAN_PRICE_MEDIUM", "medium"],
    ["SCAN_PRICE_HEAVY", "heavy"],
  ] as const) {
    const raw = process.env[envKey];
    if (raw != null && /^\d+(\.\d+)?$/.test(raw.trim())) {
      priceOverrides[cls] = raw.trim();
    }
  }
  return {
    enabled: booleanFlag("SCAN_PACKS_ENABLED"),
    pricingEnabled: booleanFlag("SCAN_PACK_PRICING_ENABLED"),
    priceOverrides,
  };
}
