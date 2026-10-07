/**
 * venue surface — instance subscription billing (O1: auth is
 * wallet-sig; the payment is an onchain USDC transfer attested by the
 * venue indexer, not a per-request x402 gate).
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

export function venueSkus(src: CatalogSources["venue"]): ServiceSku[] {
  return [
    {
      sku_id: "venue:instance-subscription",
      surface: "venue",
      name: "Venue instance subscription",
      description:
        "30d subscription per paid month; attested by the venue indexer. " +
        "auth: wallet-sig — see EPIC-179 O1.",
      price_usd: src.monthly_usd,
      pricing: "subscription",
      endpoint: {
        method: "POST",
        path: "/api/venue/instances/:id/subscribe",
      },
      auth: "wallet-sig",
      enabled: src.enabled,
    },
  ];
}
