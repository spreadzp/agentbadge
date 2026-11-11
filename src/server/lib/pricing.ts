/**
 * Fiat pricing tiers and product catalog — COMPATIBILITY PROJECTION.
 *
 * SLICE-67-2: Maps AgentBadge products to USD amounts and Stripe product names.
 * SLICE-221-1 (D-221-2/D-221-5): `FIAT_PRODUCTS` is no longer the source of
 * truth — it is derived from the canonical commerce catalog
 * (lib/commerce-catalog). Legacy `listFiatProducts`/`getFiatProduct` keep
 * working for `/api/payment/*` until SLICE-221-5 deprecates them.
 *
 * New code must use `listCommerceProducts`/`getCommerceProduct` —
 * decimal-string prices, never float `amountUsd`.
 */

import {
  listCommerceProducts,
  legacyProductIdFor,
  type CommerceProduct,
} from "./commerce-catalog";

export interface FiatProduct {
  productId: string;
  name: string;
  description: string;
  amountUsd: number;
  amountCents: number;
  metadata: Record<string, string>;
}

function toLegacyMetadata(product: CommerceProduct): Record<string, string> {
  if (product.fulfillmentKind === "passport-mint") {
    return {
      product: "passport",
      tier: product.productCode.slice("PASSPORT_".length).toLowerCase(),
    };
  }
  return { product: "directory-listing", tier: "standard" };
}

function projectToFiat(product: CommerceProduct): FiatProduct {
  const usd = product.prices.find((p) => p.currency === "USD");
  const amountUsd = usd ? Number(usd.amount) : 0;
  return {
    productId: legacyProductIdFor(product.productCode)!,
    name: product.name,
    description: product.description,
    amountUsd,
    amountCents: Math.round(amountUsd * 100),
    metadata: toLegacyMetadata(product),
  };
}

/** Legacy fiat products — projection of the commerce catalog. */
export const FIAT_PRODUCTS: Record<string, FiatProduct> = Object.fromEntries(
  listCommerceProducts().map((p) => {
    const fiat = projectToFiat(p);
    return [fiat.productId, fiat];
  }),
);

export function getFiatProduct(productId: string): FiatProduct | undefined {
  return FIAT_PRODUCTS[productId];
}

export function listFiatProducts(): FiatProduct[] {
  return Object.values(FIAT_PRODUCTS);
}
