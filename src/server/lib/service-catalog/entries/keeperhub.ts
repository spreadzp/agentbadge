/**
 * keeperhub surface — x402-gated premium scan recording. Free
 * alternative exists: POST /api/keeperhub/scan {url, confirm:true}.
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

const KH_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    url: { type: "string", description: "Target site URL" },
    confirm: {
      type: "boolean",
      description: "Trigger onchain KeeperHub record-scan workflow",
    },
    quick: { type: "boolean" },
    packs: { type: "array", items: { type: "string" } },
  },
  required: ["url"],
};

export function keeperhubSkus(src: CatalogSources["keeperhub"]): ServiceSku[] {
  return [
    {
      sku_id: "keeperhub:scan-premium",
      surface: "keeperhub",
      name: "KeeperHub premium scan recording",
      description:
        "POST /api/keeperhub/scan with confirm:true, gated behind x402 " +
        "(EIP-3009 USDC). Identical scan result as the free confirm mode.",
      price_usd: src.premium_price_usd,
      pricing: "per_call",
      endpoint: { method: "POST", path: "/api/keeperhub/scan/premium" },
      input_schema: KH_INPUT_SCHEMA,
      auth: "x402",
      free_tier: {
        limit: "unlimited (wallet-sig not required)",
        note: "POST /api/keeperhub/scan {url, confirm:true} is free",
      },
      enabled: src.enabled,
    },
  ];
}
