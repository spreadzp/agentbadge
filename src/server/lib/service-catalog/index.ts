/**
 * SKU registry — single source of truth for every paid surface
 * (EPIC-179, SLICE-179-1). Pure functions only: sources are injected,
 * registry code does zero IO. `defaultSources()` (./sources) resolves
 * live config + source functions; tests inject mocks.
 */
import type { ServiceSku, Surface } from "./types";
import {
  type CatalogSources,
  defaultSources,
} from "./sources";
import { scanSkus } from "./entries/scan";
import { passportSkus } from "./entries/passport";
import { marketplaceSkus } from "./entries/marketplace";
import { keeperhubSkus } from "./entries/keeperhub";
import { eaasSkus } from "./entries/eaas";
import { bstockSkus } from "./entries/bstock";
import { venueSkus } from "./entries/venue";
import { freeEntries } from "./entries/free";

export type { ServiceSku, Surface, Pricing, SkuAuth, FreeEndpoint } from "./types";
export type { CatalogSources } from "./sources";
export { defaultSources } from "./sources";
export { freeEntries };

/** Every paid surface, in stable order (golden-test safe). */
export function allSkus(src: CatalogSources = defaultSources()): ServiceSku[] {
  return [
    ...scanSkus(src.scan),
    ...passportSkus(src.passport),
    ...marketplaceSkus(src.marketplace),
    ...keeperhubSkus(src.keeperhub),
    ...eaasSkus(src.eaas),
    ...bstockSkus(src.bstock),
    ...venueSkus(src.venue),
  ];
}

export function skusBySurface(
  surface: Surface,
  src: CatalogSources = defaultSources(),
): ServiceSku[] {
  return allSkus(src).filter((s) => s.surface === surface);
}

export function skuById(
  skuId: string,
  src: CatalogSources = defaultSources(),
): ServiceSku | undefined {
  return allSkus(src).find((s) => s.sku_id === skuId);
}

/** The JSON Schema a bazaar extension must carry for this SKU's
 *  endpoint — the same object the catalog advertises (no drift). */
export function inputSchemaOf(
  sku: ServiceSku,
): Record<string, unknown> | undefined {
  return sku.input_schema;
}
