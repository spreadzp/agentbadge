/**
 * CatalogSources — every input the SKU registry needs, resolved in one
 * place so entries/index stay pure (D-179-1, zero IO in registry code).
 * `defaultSources()` reads live config/source functions; tests inject
 * mocks so a price change in a source function flips the SKU without
 * touching the registry.
 */
import { getConfig } from "../../../config/env";
import {
  BUNDLE_IDS,
  FULL_SCAN_PRICE,
  bundleMetadata,
} from "../../../agent-readiness/rule-bundles";
import { AGENT_READINESS_RULESET } from "../../../agent-readiness/ruleset";
import {
  TIER_PRICES_TINYBARS,
  TINYBAR_PER_HBAR,
} from "@agentbadge/passport";
import { venueMonthlyPriceAtomic } from "../venue/billing";

export interface BundleSource {
  id: string;
  name: string;
  description: string;
  price_usd: string;
  rule_count: number;
}

export interface CatalogSources {
  scan: { enabled: boolean; bundles: BundleSource[]; full_scan_usd: string };
  passport: { tiers: { tier: string; price_hbar: string }[] };
  marketplace: { enabled: boolean; passport_price_usd: string | null };
  keeperhub: { enabled: boolean; premium_price_usd: string | null };
  eaas: {
    enabled: boolean;
    verdict_usd: string;
    scan_usd: string;
    eval_usd: string;
    tier_basic_usd: string;
    tier_pro_usd: string;
  };
  bstock: { enabled: boolean; pass_price_usd: string; pass_days: number };
  venue: { enabled: boolean; monthly_usd: string };
}

/** "$x.xx" or "x.xx" → "x.xx". */
export function usd(price: string): string {
  return price.startsWith("$") ? price.slice(1) : price;
}

/** Atomic USDC (6dp) bigint → "x.xx" decimal string. */
function atomicToUsd(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const frac = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return frac ? `${whole}.${frac}` : `${whole}`;
}

export function defaultSources(): CatalogSources {
  const cfg = getConfig();
  const bundles = bundleMetadata(AGENT_READINESS_RULESET.rules, [
    ...BUNDLE_IDS,
  ]).bundles.map((b) => ({
    id: b.id,
    name: b.id,
    description: `${b.ruleCount} rules`,
    price_usd: b.price.amount,
    rule_count: b.ruleCount,
  }));

  const eaas = cfg.eaas;
  return {
    scan: {
      enabled: cfg.scanPacks.enabled,
      bundles,
      full_scan_usd: FULL_SCAN_PRICE,
    },
    passport: {
      tiers: Object.entries(TIER_PRICES_TINYBARS).map(([tier, tb]) => ({
        tier,
        price_hbar: (tb / TINYBAR_PER_HBAR).toString(),
      })),
    },
    marketplace: {
      enabled: cfg.marketplace?.enabled ?? false,
      passport_price_usd: cfg.marketplace?.passportPriceUsd ?? null,
    },
    keeperhub: {
      enabled: cfg.keeperhub?.x402?.enabled ?? false,
      premium_price_usd: cfg.keeperhub?.x402
        ? usd(cfg.keeperhub.x402.price)
        : null,
    },
    eaas: {
      enabled: eaas?.enabled ?? false,
      // Defaults mirror env/eaas.ts atomicPrice fallbacks (SLICE-154-2/3/5)
      // so the catalog is complete even when the surface is disabled.
      verdict_usd: eaas ? usd(eaas.verdictUsd) : "0.01",
      scan_usd: eaas ? usd(eaas.scanUsd) : "0.05",
      eval_usd: eaas ? usd(eaas.evalUsd) : "0.10",
      tier_basic_usd: eaas ? usd(eaas.tierBasicUsd) : "5",
      tier_pro_usd: eaas ? usd(eaas.tierProUsd) : "25",
    },
    bstock: {
      enabled: cfg.bstock?.enabled ?? false,
      pass_price_usd: cfg.bstock?.priceUsd ?? "5",
      pass_days: Math.round((cfg.bstock?.durationSec ?? 2_592_000) / 86_400),
    },
    venue: {
      enabled: true,
      monthly_usd: atomicToUsd(venueMonthlyPriceAtomic()),
    },
  };
}
