/**
 * scan surface — one SKU per rule bundle + a full-scan SKU.
 * Prices come from bundleMetadata (env overrides included upstream);
 * input_schema mirrors the bazaar inputSchema of POST /api/total-scan.
 */
import type { ServiceSku } from "../types";
import type { CatalogSources } from "../sources";

const SCAN_INPUT_SCHEMA: Record<string, unknown> = {
  type: "object",
  properties: {
    url: { type: "string", description: "Target site URL to scan" },
    packs: {
      type: "array",
      items: { type: "string" },
      description:
        "Optional rule bundle ids (see GET /api/scan-packs); omit for full scan",
    },
  },
  required: ["url"],
};

export function scanSkus(src: CatalogSources["scan"]): ServiceSku[] {
  const skus: ServiceSku[] = src.bundles.map((b) => ({
    sku_id: `scan:${b.id}`,
    surface: "scan",
    name: `Agent readiness scan — ${b.name} bundle`,
    description: b.description,
    price_usd: b.price_usd,
    pricing: "per_bundle",
    endpoint: { method: "POST", path: "/api/total-scan" },
    input_schema: SCAN_INPUT_SCHEMA,
    auth: "x402",
    enabled: src.enabled,
  }));

  skus.push({
    sku_id: "scan:full",
    surface: "scan",
    name: "Agent readiness scan — full ruleset",
    description:
      "All bundles at the flat full-scan price (cheaper than summing packs).",
    price_usd: src.full_scan_usd,
    pricing: "per_call",
    endpoint: { method: "POST", path: "/api/total-scan" },
    input_schema: SCAN_INPUT_SCHEMA,
    output_example: {
      event: "result",
      data: { score: 72, bundles: { "discovery-crawling": { passed: 15, failed: 4 } } },
    },
    auth: "x402",
    enabled: src.enabled,
  });

  return skus;
}
