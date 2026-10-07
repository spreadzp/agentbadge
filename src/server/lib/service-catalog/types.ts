/**
 * ServiceSku — canonical SKU record for the paid-surface registry
 * (EPIC-179, SLICE-179-1, D-179-1). Registry entries are declarative:
 * each surface exports `ServiceSku[]` built from live source functions
 * (rule-bundles, env config, package exports) — prices are never
 * hardcoded a second time.
 */

export type Surface =
  | "scan"
  | "passport"
  | "marketplace"
  | "keeperhub"
  | "eaas"
  | "bstock"
  | "venue";

export type Pricing =
  | "per_call"
  | "per_bundle"
  | "subscription"
  | "dynamic"
  | "free";

export type SkuAuth = "x402" | "x402+pass" | "wallet-sig" | "none";

export interface ServiceSku {
  /** "scan-pack:discovery-crawling" | "passport:gold" | … stable, kebab. */
  sku_id: string;
  surface: Surface;
  name: string;
  description: string;
  /** Canonical USD price ("4.50"); null for dynamic pricing. */
  price_usd: string | null;
  pricing: Pricing;
  /** Non-USD-denominated price when the surface bills in another unit
   *  (e.g. Hedera passport tiers in tinybars). */
  price_native?: { amount: string; currency: string };
  endpoint: { method: "GET" | "POST"; path: string };
  /** JSON Schema of the request body — mirrors the bazaar inputSchema
   *  of the same route (no drift, SLICE-179-2 asserts parity). */
  input_schema?: Record<string, unknown>;
  output_example?: Record<string, unknown>;
  auth: SkuAuth;
  free_tier?: { limit: string; note: string };
  /** False when the backing surface is disabled in this deployment. */
  enabled?: boolean;
}
