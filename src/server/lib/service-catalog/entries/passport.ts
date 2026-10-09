/**
 * passport surface — one SKU per trust tier. Price is denominated in
 * HBAR (tinybars upstream) → carried in price_native; the catalog is
 * USD-canonical for x402 surfaces so price_usd stays null here.
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

const PASSPORT_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    accountId: { type: "string", description: "Hedera account id" },
    signature: { type: "string", description: "Wallet signature" },
    tier: {
      type: "string",
      enum: ["bronze", "silver", "gold", "platinum"],
    },
    name: { type: "string" },
    capabilities: { type: "array", items: { type: "string" } },
    endpoint: { type: "string" },
  },
  required: ["accountId", "signature", "tier", "name", "capabilities"],
};

const PASSPORT_INPUT_EXAMPLE: Record<string, unknown> = {
  accountId: "0.0.12345",
  signature: "0x…(EIP-191 signature)",
  tier: "bronze",
  name: "my-agent",
  capabilities: ["api_call", "payment"],
};

export function passportSkus(src: CatalogSources["passport"]): ServiceSku[] {
  return src.tiers.map((t) => ({
    sku_id: `passport:${t.tier}`,
    surface: "passport",
    name: `Agent passport — ${t.tier} tier`,
    description: `${t.tier} passport mint (${t.price_hbar} HBAR).`,
    price_usd: null,
    price_native: { amount: t.price_hbar, currency: "HBAR" },
    pricing: "per_call",
    endpoint: { method: "POST", path: "/passport/request" },
    input_schema: PASSPORT_INPUT_SCHEMA,
    input_example: PASSPORT_INPUT_EXAMPLE,
    auth: "x402",
  }));
}
