/**
 * bstock surface — ServicePass for the delta feed. Freemium gate:
 * free tier is 1 req/min per identity; the pass removes the bucket.
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

export function bstockSkus(src: CatalogSources["bstock"]): ServiceSku[] {
  return [
    {
      sku_id: "bstock:service-pass",
      surface: "bstock",
      name: `bStock delta feed — ${src.pass_days}d ServicePass`,
      description:
        "ServicePass unlocking realtime deltas on the bstock feed; minted " +
        "via marketplace buy of the bstock service id.",
      price_usd: src.pass_price_usd,
      pricing: "subscription",
      endpoint: { method: "POST", path: "/api/market/buy/:serviceId" },
      input_schema: {
        type: "object",
        properties: {
          serviceId: {
            type: "string",
            pattern: "^0x[0-9a-fA-F]{64}$",
            description: "bytes32 service id — path parameter",
          },
        },
        required: ["serviceId"],
      },
      auth: "x402+pass",
      free_tier: {
        limit: "1 req/min per identity",
        note: "X-Wallet → agentId → client IP bucket; pass bypasses it",
      },
      enabled: src.enabled,
    },
  ];
}
