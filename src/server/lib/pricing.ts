/**
 * Fiat pricing tiers and product catalog.
 *
 * SLICE-67-2: Maps AgentBadge products to USD amounts and Stripe product names.
 * Used by the checkout endpoint to create Stripe Checkout Sessions without
 * hardcoding prices.
 */

export interface FiatProduct {
  productId: string;
  name: string;
  description: string;
  amountUsd: number;
  amountCents: number;
  metadata: Record<string, string>;
}

export const FIAT_PRODUCTS: Record<string, FiatProduct> = {
  "directory-listing": {
    productId: "directory-listing",
    name: "AgentBadge Directory Listing",
    description: "Lifetime curated listing in the AgentBadge agent directory",
    amountUsd: 29.99,
    amountCents: 2999,
    metadata: { product: "directory-listing", tier: "standard" },
  },
  "passport-bronze": {
    productId: "passport-bronze",
    name: "Agent Passport — Bronze Tier",
    description: "Bronze tier on-chain agent passport NFT mint",
    amountUsd: 9.99,
    amountCents: 999,
    metadata: { product: "passport", tier: "bronze" },
  },
  "passport-silver": {
    productId: "passport-silver",
    name: "Agent Passport — Silver Tier",
    description: "Silver tier on-chain agent passport NFT mint",
    amountUsd: 49.99,
    amountCents: 4999,
    metadata: { product: "passport", tier: "silver" },
  },
  "passport-gold": {
    productId: "passport-gold",
    name: "Agent Passport — Gold Tier",
    description: "Gold tier on-chain agent passport NFT mint",
    amountUsd: 199.99,
    amountCents: 19999,
    metadata: { product: "passport", tier: "gold" },
  },
  "passport-platinum": {
    productId: "passport-platinum",
    name: "Agent Passport — Platinum Tier",
    description: "Platinum tier on-chain agent passport NFT mint",
    amountUsd: 499.99,
    amountCents: 49999,
    metadata: { product: "passport", tier: "platinum" },
  },
};

export function getFiatProduct(productId: string): FiatProduct | undefined {
  return FIAT_PRODUCTS[productId];
}

export function listFiatProducts(): FiatProduct[] {
  return Object.values(FIAT_PRODUCTS);
}
