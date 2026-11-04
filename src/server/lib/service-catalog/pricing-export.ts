/**
 * SLICE-206-9 (EPIC-206): machine-readable pricing export.
 *
 * `/pricing.json` + `/pricing.md` — flat, agent-friendly price list
 * rendered from the SAME ServiceSku registry that feeds
 * `/api/v1/services` (single source of truth — prices are never
 * retyped here; a price change in a surface config flips both).
 *
 * Pure builders: sources injected, zero IO.
 */

import { allSkus, freeEntries } from "./index";
import type { CatalogSources } from "./sources";
import type { ServiceSku } from "./types";

export interface PricingService {
  sku_id: string;
  name: string;
  /** "METHOD /path" — directly callable. */
  endpoint: string;
  /** USD/USDC decimal string; null for dynamic pricing. */
  price_usdc: string | null;
  /** Billing unit: call | bundle | month | dynamic. */
  unit: string;
  /** How the endpoint is paid. */
  payment: "x402" | "wallet-sig" | "free";
  description?: string;
  surface: string;
}

export interface PricingFree {
  endpoint: string;
  payment: "free";
  limit: string;
  description: string;
}

export interface PricingExport {
  schema: "agentbadge.pricing.v1";
  currency: "USDC";
  /** Payment settlement chain — Arc mainnet. */
  chain: "eip155:5042";
  /** Canonical catalog this list is generated from. */
  canonical: string;
  services: PricingService[];
  free: PricingFree[];
}

const UNIT_BY_PRICING: Record<ServiceSku["pricing"], string> = {
  per_call: "call",
  per_bundle: "bundle",
  subscription: "month",
  dynamic: "dynamic",
  free: "free",
};

function paymentOf(sku: ServiceSku): PricingService["payment"] {
  if (sku.auth === "none") return "free";
  if (sku.auth === "wallet-sig") return "wallet-sig";
  return "x402"; // "x402" | "x402+pass"
}

export function buildPricingJson(src: CatalogSources): PricingExport {
  const services: PricingService[] = allSkus(src)
    .filter((s) => s.enabled !== false)
    .map((s) => ({
      sku_id: s.sku_id,
      name: s.name,
      endpoint: `${s.endpoint.method} ${s.endpoint.path}`,
      price_usdc: s.price_usd,
      unit: UNIT_BY_PRICING[s.pricing],
      payment: paymentOf(s),
      ...(s.description ? { description: s.description } : {}),
      surface: s.surface,
    }));

  const free: PricingFree[] = freeEntries(src).map((f) => ({
    endpoint: `${f.method} ${f.endpoint}`,
    payment: "free",
    limit: f.limit,
    description: f.note,
  }));

  return {
    schema: "agentbadge.pricing.v1",
    currency: "USDC",
    chain: "eip155:5042",
    canonical: "/api/v1/services",
    services,
    free,
  };
}

/** Markdown mirror — same data, same sources (drift impossible). */
export function buildPricingMd(
  src: CatalogSources,
  baseUrl: string,
): string {
  const p = buildPricingJson(src);
  const rows = p.services
    .map(
      (s) =>
        `| ${s.name} | \`${s.endpoint}\` | ${s.price_usdc ?? "dynamic"} | ${s.unit} | ${s.payment} |`,
    )
    .join("\n");
  const freeRows = p.free
    .map((f) => `| \`${f.endpoint}\` | ${f.limit} | ${f.description} |`)
    .join("\n");

  return `# AgentBadge Pricing (machine-readable)

> All paid surfaces settle in ${p.currency} on Arc (${p.chain}) via x402.
> Canonical catalog: ${baseUrl}${p.canonical} · JSON mirror: ${baseUrl}/pricing.json

## Paid services

| Service | Endpoint | Price (USDC) | Unit | Payment |
|---------|----------|--------------|------|---------|
${rows}

## Free endpoints

| Endpoint | Limit | Notes |
|----------|-------|-------|
${freeRows}
`;
}
