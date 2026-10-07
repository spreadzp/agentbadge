/**
 * Canonical paid-services catalog — GET /api/v1/services.
 *
 * The endpoint is referenced from the agent-card (.well-known),
 * the refusal contract (price_truth), llms.txt, and blog/agent-guide
 * articles as "Service catalog (canonical prices)". Every price below
 * is sourced from the same config/constants the x402 middleware
 * resolves at request time — never hardcoded a second time.
 */

import { getConfig } from "../../config/env";
import { BSTOCK_PRICE_USD } from "../../config/env/bstock";
import {
  BUNDLE_IDS,
  FULL_SCAN_PRICE,
  USDC,
  bundleMetadata,
} from "../../agent-readiness/rule-bundles";
import { AGENT_READINESS_RULESET } from "../../agent-readiness/ruleset";
import { REFUSAL_MATRIX } from "./refusal-contract";

export interface ServiceCatalogEntry {
  /** Stable service id (e.g. "scan-packs", "eaas-verdict"). */
  id: string;
  name: string;
  /** Endpoint path + HTTP method. */
  path: string;
  method: "GET" | "POST";
  /** Canonical price, decimal USDC string ("4.50"), or null when dynamic. */
  price_usd: string | null;
  /** Pricing unit (per-call, per-scan, monthly, per-pass, …). */
  unit: string;
  /** Settlement rail. */
  settlement: "x402";
  /** Whether the backing surface is enabled in this deployment. */
  enabled: boolean;
  /** Free alternative exists (free tier / free endpoint). */
  free_tier: boolean;
  /** Refusal codes this surface can return, per REFUSAL_MATRIX. */
  refusal_codes: string[];
  notes?: string;
}

export interface ServicesCatalog {
  version: string;
  currency: string;
  /** 402 accept.amount is canonical — verify against these prices. */
  price_truth: string;
  refusal_contract: string;
  generated_at: string;
  services: ServiceCatalogEntry[];
  /** Scan-pack bundle pricing detail (nested under the scan service). */
  scan_packs?: {
    endpoint: string;
    full_scan_usd: string;
    bundles: { id: string; price_usd: string; rule_count: number }[];
  };
}

const ALL_REFUSAL_CODES = REFUSAL_MATRIX.map((m) => m.code);

/** Strips a leading "$" from "$x.xx" config prices → "x.xx". */
function usd(price: string): string {
  return price.startsWith("$") ? price.slice(1) : price;
}

export function getServicesCatalog(): ServicesCatalog {
  const cfg = getConfig();
  const eaas = cfg.eaas;
  const bstock = cfg.bstock;
  const marketplace = cfg.marketplace;
  const keeperhubX402 = cfg.keeperhub?.x402;

  const scanBundles = bundleMetadata(AGENT_READINESS_RULESET.rules, [
    ...BUNDLE_IDS,
  ]);

  const services: ServiceCatalogEntry[] = [
    {
      id: "scan-packs",
      name: "Agent readiness scan (rule bundles)",
      path: "/api/total-scan",
      method: "POST",
      price_usd: FULL_SCAN_PRICE,
      unit: "per-scan (sum of selected packs; full scan flat)",
      settlement: "x402",
      enabled: cfg.scanPacks.enabled,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
      notes:
        "Price = sum of selected pack prices; no packs → full-scan price. See scan_packs detail.",
    },
    {
      id: "eaas-verdict",
      name: "Evaluation-as-a-Service — signed verdict",
      path: "/api/eaas/verdicts",
      method: "POST",
      price_usd: eaas ? usd(eaas.verdictUsd) : null,
      unit: "per-verdict",
      settlement: "x402",
      enabled: eaas?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
      notes:
        "policy=readiness-scan is priced separately (see eaas-readiness-scan).",
    },
    {
      id: "eaas-readiness-scan",
      name: "EaaS verdict — readiness-scan policy",
      path: "/api/eaas/verdicts",
      method: "POST",
      price_usd: eaas ? usd(eaas.scanUsd) : null,
      unit: "per-verdict (policy=readiness-scan)",
      settlement: "x402",
      enabled: eaas?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
    },
    {
      id: "eaas-jobs-evaluate",
      name: "EaaS external job evaluation",
      path: "/api/eaas/jobs/evaluate",
      method: "POST",
      price_usd: eaas ? usd(eaas.evalUsd) : null,
      unit: "per-evaluation",
      settlement: "x402",
      enabled: eaas?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
    },
    {
      id: "eaas-subscribe-basic",
      name: "EaaS subscription — basic tier",
      path: "/api/eaas/subscribe",
      method: "POST",
      price_usd: eaas ? usd(eaas.tierBasicUsd) : null,
      unit: "monthly",
      settlement: "x402",
      enabled: eaas?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
    },
    {
      id: "eaas-subscribe-pro",
      name: "EaaS subscription — pro tier",
      path: "/api/eaas/subscribe",
      method: "POST",
      price_usd: eaas ? usd(eaas.tierProUsd) : null,
      unit: "monthly",
      settlement: "x402",
      enabled: eaas?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
    },
    {
      id: "bstock-service-pass",
      name: "bStock delta feed — ServicePass",
      path: "/api/market/buy/:serviceId",
      method: "POST",
      price_usd: bstock?.priceUsd ?? BSTOCK_PRICE_USD,
      unit: `per-pass (${Math.round((bstock?.durationSec ?? 2_592_000) / 86_400)} days)`,
      settlement: "x402",
      enabled: bstock?.enabled ?? false,
      free_tier: true,
      refusal_codes: ALL_REFUSAL_CODES,
      notes:
        "Free tier available without pass; pass unlocks realtime deltas.",
    },
    {
      id: "marketplace-passport",
      name: "Business passport mint (marketplace)",
      path: "/api/market/passport",
      method: "POST",
      price_usd: marketplace?.passportPriceUsd ?? null,
      unit: "per-passport",
      settlement: "x402",
      enabled: marketplace?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
    },
    {
      id: "marketplace-service-buy",
      name: "Marketplace service purchase",
      path: "/api/market/buy/:serviceId",
      method: "POST",
      price_usd: null,
      unit: "per-service (dynamic)",
      settlement: "x402",
      enabled: marketplace?.enabled ?? false,
      free_tier: false,
      refusal_codes: ALL_REFUSAL_CODES,
      notes:
        "Price resolves per serviceId — fetch GET /api/market/services for the live catalog.",
    },
    {
      id: "keeperhub-scan-premium",
      name: "KeeperHub premium scan recording",
      path: "/api/keeperhub/scan/premium",
      method: "POST",
      price_usd: keeperhubX402 ? usd(keeperhubX402.price) : null,
      unit: "per-scan",
      settlement: "x402",
      enabled: keeperhubX402?.enabled ?? false,
      free_tier: true,
      refusal_codes: ALL_REFUSAL_CODES,
      notes:
        "Free alternative: POST /api/keeperhub/scan {url, confirm:true}.",
    },
  ];

  return {
    version: "1.0",
    currency: USDC,
    price_truth:
      "402 accept.amount is canonical — clients verify against the prices in this catalog.",
    refusal_contract: "/api/meta/refusal-contract",
    generated_at: new Date().toISOString(),
    services,
    scan_packs: {
      endpoint: "/api/total-scan",
      full_scan_usd: FULL_SCAN_PRICE,
      bundles: scanBundles.bundles.map((b) => ({
        id: b.id,
        price_usd: b.price.amount,
        rule_count: b.ruleCount,
      })),
    },
  };
}
