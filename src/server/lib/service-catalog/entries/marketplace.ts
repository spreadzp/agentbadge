/**
 * marketplace surface — AgentBadge's own billing SKUs only (O3):
 * business passport mint + the dynamic service-buy gate. Tenant-listed
 * services live in GET /api/market/services, not here.
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

export function marketplaceSkus(
  src: CatalogSources["marketplace"],
): ServiceSku[] {
  return [
    {
      sku_id: "marketplace:passport-mint",
      surface: "marketplace",
      name: "Business passport mint",
      description:
        "Mints a business passport NFT to the payer wallet via x402 payment.",
      price_usd: src.passport_price_usd,
      pricing: "per_call",
      endpoint: { method: "POST", path: "/api/market/passport" },
      auth: "x402",
      enabled: src.enabled,
    },
    {
      sku_id: "marketplace:service-buy",
      surface: "marketplace",
      name: "Marketplace service purchase",
      description:
        "Buys a tenant-listed service pass. Price resolves per serviceId — " +
        "see GET /api/market/services for the live catalog.",
      price_usd: null,
      pricing: "dynamic",
      endpoint: { method: "POST", path: "/api/market/buy/:serviceId" },
      auth: "x402",
      enabled: src.enabled,
    },
  ];
}
