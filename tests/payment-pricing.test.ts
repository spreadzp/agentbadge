/**
 * SLICE-67-2: Unit tests for fiat pricing tiers and product catalog.
 */

import { describe, it, expect } from "vitest";

import {
  FIAT_PRODUCTS,
  getFiatProduct,
  listFiatProducts,
  type FiatProduct,
} from "../src/server/lib/pricing";

describe("FIAT_PRODUCTS", () => {
  it("contains 5 products (directory listing + 4 passport tiers)", () => {
    expect(Object.keys(FIAT_PRODUCTS).length).toBe(5);
  });

  it("includes directory-listing product", () => {
    expect(FIAT_PRODUCTS["directory-listing"]).toBeDefined();
    expect(FIAT_PRODUCTS["directory-listing"].metadata.product).toBe("directory-listing");
  });

  it("includes all 4 passport tiers", () => {
    expect(FIAT_PRODUCTS["passport-bronze"]).toBeDefined();
    expect(FIAT_PRODUCTS["passport-silver"]).toBeDefined();
    expect(FIAT_PRODUCTS["passport-gold"]).toBeDefined();
    expect(FIAT_PRODUCTS["passport-platinum"]).toBeDefined();
  });

  it("each product has all required fields", () => {
    for (const product of Object.values(FIAT_PRODUCTS)) {
      expect(product.productId).toBeTruthy();
      expect(product.name).toBeTruthy();
      expect(product.description).toBeTruthy();
      expect(product.amountUsd).toBeGreaterThan(0);
      expect(product.amountCents).toBeGreaterThan(0);
      expect(product.metadata).toBeDefined();
      expect(typeof product.metadata.product).toBe("string");
      expect(typeof product.metadata.tier).toBe("string");
    }
  });

  it("amountCents equals Math.round(amountUsd * 100) for every product", () => {
    for (const product of Object.values(FIAT_PRODUCTS)) {
      expect(product.amountCents).toBe(Math.round(product.amountUsd * 100));
    }
  });

  it("passport products have tier in metadata matching productId suffix", () => {
    for (const tier of ["bronze", "silver", "gold", "platinum"]) {
      const product = FIAT_PRODUCTS[`passport-${tier}`];
      expect(product.metadata.tier).toBe(tier);
      expect(product.metadata.product).toBe("passport");
    }
  });
});

describe("getFiatProduct", () => {
  it("returns the correct product for passport-bronze", () => {
    const product = getFiatProduct("passport-bronze");
    expect(product).toBeDefined();
    expect(product!.name).toContain("Bronze");
    expect(product!.amountCents).toBe(999);
  });

  it("returns the correct product for directory-listing", () => {
    const product = getFiatProduct("directory-listing");
    expect(product).toBeDefined();
    expect(product!.name).toContain("Directory");
    expect(product!.amountCents).toBe(2999);
  });

  it("returns undefined for unknown productId", () => {
    expect(getFiatProduct("nonexistent")).toBeUndefined();
  });

  it("returns undefined for empty string", () => {
    expect(getFiatProduct("")).toBeUndefined();
  });
});

describe("listFiatProducts", () => {
  it("returns all 5 products", () => {
    expect(listFiatProducts().length).toBe(5);
  });

  it("returns array of FiatProduct objects", () => {
    const products = listFiatProducts();
    for (const p of products) {
      expect(typeof p.productId).toBe("string");
      expect(typeof p.amountCents).toBe("number");
    }
  });
});
