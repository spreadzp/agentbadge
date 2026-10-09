/**
 * Bazaar extension builder (SLICE-179-3, D-179-4): the x402 discovery
 * declaration for a gated route is derived from its ServiceSku — the
 * inputSchema emitted to bazaar indexers is byte-identical to what
 * GET /api/v1/services advertises (`inputSchemaOf`), single source.
 *
 * No SKU / no input_schema → no extension (AC3: drift test in 179-5
 * catches unregistered gates rather than emitting dead schemas).
 */
import {
  declareDiscoveryExtension,
  type DiscoveryExtension,
} from "@x402/extensions";
import type { ServiceSku } from "./types";
import { inputSchemaOf, skuById, type CatalogSources } from "./index";

const BODY_METHODS = new Set(["POST", "PUT", "PATCH"]);

/** Extensions map (`{bazaar: {...}}`) for a SKU's endpoint, or undefined
 *  when the SKU carries no input_schema. */
export function bazaarExtensionOf(
  sku: ServiceSku,
): Record<string, DiscoveryExtension> | undefined {
  const schema = inputSchemaOf(sku);
  if (!schema) return undefined;
  const base = { inputSchema: schema };
  if (BODY_METHODS.has(sku.endpoint.method)) {
    return declareDiscoveryExtension({
      bodyType: "json",
      ...(sku.input_example ? { input: sku.input_example } : {}),
      ...base,
      ...(sku.output_example
        ? { output: { example: sku.output_example } }
        : {}),
    });
  }
  // Query-param methods: the query config is discriminated by the
  // absence of bodyType — no method field on the input type.
  return declareDiscoveryExtension({
    ...base,
    ...(sku.output_example
      ? { output: { example: sku.output_example } }
      : {}),
  });
}

/** Same by sku_id — for wiring call sites that know the SKU they gate.
 *  `sources` injectable for tests (default: live config). */
export function bazaarExtensionFor(
  skuId: string,
  sources?: CatalogSources,
): Record<string, DiscoveryExtension> | undefined {
  const sku = skuById(skuId, sources);
  return sku ? bazaarExtensionOf(sku) : undefined;
}
