/**
 * SLICE-221-1 (EPIC-221, D-221-2/D-221-8): commerce catalog —
 * canonical product/price source for checkout 2.0.
 *
 * AC1: catalog module — productCode / prices decimal-string /
 *      metadataSchema / fulfillmentKind.
 * AC2: FIAT_PRODUCTS migrated — legacy listFiatProducts/getFiatProduct
 *      stay a working compatibility projection.
 * AC3: GET /api/v1/catalog/products + /products/:code/prices.
 * AC4: metadata validation pass/fail per productCode schema.
 */
import { describe, it, expect } from "vitest";
import { Hono } from "hono";

import {
  listCommerceProducts,
  getCommerceProduct,
  validateProductMetadata,
  legacyProductIdFor,
  productCodeForLegacyId,
  type CommerceProduct,
} from "../src/server/lib/commerce-catalog";
import { commerceCatalogRoutes } from "../src/server/routes/commerce-catalog";
import {
  FIAT_PRODUCTS,
  getFiatProduct,
  listFiatProducts,
} from "../src/server/lib/pricing";

const USD_DECIMAL = /^(0|[1-9]\d*)\.\d{2}$/;
const PRODUCT_CODES = [
  "PASSPORT_BRONZE",
  "PASSPORT_SILVER",
  "PASSPORT_GOLD",
  "PASSPORT_PLATINUM",
  "DIRECTORY_LISTING",
];

/* --------------------------- catalog (unit) ---------------------------- */

describe("commerce catalog", () => {
  it("lists all 5 canonical products in stable order", () => {
    const products = listCommerceProducts();
    expect(products.map((p) => p.productCode)).toEqual(PRODUCT_CODES);
  });

  it("every product has name/description/fulfillmentKind/active prices", () => {
    for (const p of listCommerceProducts()) {
      expect(p.name.length).toBeGreaterThan(0);
      expect(p.description.length).toBeGreaterThan(0);
      expect(["passport-mint", "directory-listing"]).toContain(
        p.fulfillmentKind,
      );
      expect(p.active).toBe(true);
      expect(p.prices.length).toBeGreaterThan(0);
    }
  });

  it("USD prices are decimal strings, never floats (D-220 money rule)", () => {
    for (const p of listCommerceProducts()) {
      const usd = p.prices.find((pr) => pr.currency === "USD");
      expect(usd, `${p.productCode} USD price`).toBeDefined();
      expect(typeof usd!.amount).toBe("string");
      expect(usd!.amount).toMatch(USD_DECIMAL);
      expect(usd!.active).toBe(true);
    }
  });

  it("spec prices are preserved (bronze 9.99 … platinum 499.99, listing 29.99)", () => {
    const usdOf = (code: string) =>
      getCommerceProduct(code)!.prices.find((p) => p.currency === "USD")!
        .amount;
    expect(usdOf("PASSPORT_BRONZE")).toBe("9.99");
    expect(usdOf("PASSPORT_SILVER")).toBe("49.99");
    expect(usdOf("PASSPORT_GOLD")).toBe("199.99");
    expect(usdOf("PASSPORT_PLATINUM")).toBe("499.99");
    expect(usdOf("DIRECTORY_LISTING")).toBe("29.99");
  });

  it("passport tiers carry dual pricing: USD + native HBAR (projection of service-catalog)", () => {
    const expectedHbar: Record<string, string> = {
      PASSPORT_BRONZE: "10",
      PASSPORT_SILVER: "50",
      PASSPORT_GOLD: "200",
      PASSPORT_PLATINUM: "500",
    };
    for (const [code, hbar] of Object.entries(expectedHbar)) {
      const p = getCommerceProduct(code)!;
      const native = p.prices.find((pr) => pr.currency === "HBAR");
      expect(native, `${code} HBAR price`).toBeDefined();
      expect(native!.amount).toBe(hbar);
    }
    // directory listing is fiat-only — no native rail
    expect(
      getCommerceProduct("DIRECTORY_LISTING")!.prices.find(
        (p) => p.currency === "HBAR",
      ),
    ).toBeUndefined();
  });

  it("HBAR price is injected via sources, not hardcoded (drift-safe)", () => {
    const products = listCommerceProducts({
      passport: { tiers: [{ tier: "bronze", price_hbar: "42" }] },
    });
    const bronze = products.find((p) => p.productCode === "PASSPORT_BRONZE")!;
    expect(bronze.prices.find((p) => p.currency === "HBAR")!.amount).toBe(
      "42",
    );
  });

  it("getCommerceProduct returns undefined for unknown code", () => {
    expect(getCommerceProduct("NOPE")).toBeUndefined();
    expect(getCommerceProduct("passport-bronze")).toBeUndefined();
  });

  it("every product declares a metadataSchema (D-221-8)", () => {
    for (const p of listCommerceProducts()) {
      expect(Array.isArray(p.metadataSchema.required)).toBe(true);
      expect(Array.isArray(p.metadataSchema.optional)).toBe(true);
      expect(
        p.metadataSchema.required.length +
          p.metadataSchema.optional.length,
      ).toBeGreaterThan(0);
    }
  });
});

/* ------------------------ metadata validation -------------------------- */

const VALID_PASSPORT_METADATA = {
  accountId: "0.0.12345",
  name: "my-agent",
  capabilities: ["api_call", "payment"],
  endpoint: "https://agent.example.com",
  skills: ["trading"],
  imageUrl: "https://example.com/img.png",
};

describe("validateProductMetadata", () => {
  it("accepts full valid passport metadata", () => {
    const r = validateProductMetadata(
      "PASSPORT_BRONZE",
      VALID_PASSPORT_METADATA,
    );
    expect(r).toEqual({ ok: true });
  });

  it("accepts passport metadata with only required fields", () => {
    const r = validateProductMetadata("PASSPORT_BRONZE", {
      accountId: "0.0.1",
      name: "a",
      capabilities: [],
    });
    expect(r.ok).toBe(true);
  });

  it("rejects passport metadata missing required fields", () => {
    for (const missing of ["accountId", "name", "capabilities"]) {
      const md = { ...VALID_PASSPORT_METADATA } as Record<string, unknown>;
      delete md[missing];
      const r = validateProductMetadata("PASSPORT_GOLD", md);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.errors.join(" ")).toContain(missing);
    }
  });

  it("rejects wrong-typed fields (capabilities must be string[])", () => {
    const r = validateProductMetadata("PASSPORT_SILVER", {
      ...VALID_PASSPORT_METADATA,
      capabilities: "api_call",
    });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("capabilities");
  });

  it("rejects non-object metadata", () => {
    for (const bad of [null, "x", 42, []]) {
      const r = validateProductMetadata("PASSPORT_BRONZE", bad);
      expect(r.ok).toBe(false);
    }
  });

  it("rejects unknown productCode", () => {
    const r = validateProductMetadata("NOPE", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("NOPE");
  });

  it("directory listing requires listingId", () => {
    expect(
      validateProductMetadata("DIRECTORY_LISTING", { listingId: "lst_1" }).ok,
    ).toBe(true);
    const r = validateProductMetadata("DIRECTORY_LISTING", {});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.errors.join(" ")).toContain("listingId");
  });
});

/* --------------------- legacy FIAT_PRODUCTS projection ------------------ */

describe("FIAT_PRODUCTS compatibility projection (D-221-5)", () => {
  it("still lists all 5 legacy products", () => {
    expect(listFiatProducts().length).toBe(5);
    expect(Object.keys(FIAT_PRODUCTS).sort()).toEqual(
      [
        "directory-listing",
        "passport-bronze",
        "passport-silver",
        "passport-gold",
        "passport-platinum",
      ].sort(),
    );
  });

  it("legacy amounts are derived from the catalog (no drift)", () => {
    for (const legacy of listFiatProducts()) {
      const code = productCodeForLegacyId(legacy.productId)!;
      const usd = getCommerceProduct(code)!.prices.find(
        (p) => p.currency === "USD",
      )!;
      expect(legacy.amountCents).toBe(Math.round(Number(usd.amount) * 100));
      expect(legacy.amountUsd).toBe(Number(usd.amount));
    }
  });

  it("legacy id ↔ productCode mapping is bijective", () => {
    for (const legacyId of Object.keys(FIAT_PRODUCTS)) {
      const code = productCodeForLegacyId(legacyId)!;
      expect(legacyProductIdFor(code)).toBe(legacyId);
    }
  });

  it("getFiatProduct keeps metadata contract (product + tier)", () => {
    const p = getFiatProduct("passport-bronze")!;
    expect(p.metadata.product).toBe("passport");
    expect(p.metadata.tier).toBe("bronze");
    expect(getFiatProduct("directory-listing")!.metadata.product).toBe(
      "directory-listing",
    );
    expect(getFiatProduct("unknown")).toBeUndefined();
  });
});

/* ------------------------------- e2e ----------------------------------- */

function makeApp() {
  const app = new Hono();
  app.route("/", commerceCatalogRoutes);
  return app;
}

describe("GET /api/v1/catalog/products", () => {
  it("returns all products with decimal-string prices", async () => {
    const res = await makeApp().request("/api/v1/catalog/products");
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.total).toBe(5);
    const codes = body.products.map(
      (p: CommerceProduct) => p.productCode,
    );
    expect(codes).toEqual(PRODUCT_CODES);

    for (const p of body.products as CommerceProduct[]) {
      const usd = p.prices.find((pr) => pr.currency === "USD")!;
      expect(usd.amount).toMatch(USD_DECIMAL);
      expect(p.metadataSchema).toBeDefined();
      expect(p.fulfillmentKind).toBeTruthy();
    }
  });
});

describe("GET /api/v1/catalog/products/:code/prices", () => {
  it("returns active prices for a passport product (USD + HBAR)", async () => {
    const res = await makeApp().request(
      "/api/v1/catalog/products/PASSPORT_BRONZE/prices",
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.productCode).toBe("PASSPORT_BRONZE");
    const usd = body.prices.find(
      (p: { currency: string }) => p.currency === "USD",
    );
    const hbar = body.prices.find(
      (p: { currency: string }) => p.currency === "HBAR",
    );
    expect(usd.amount).toBe("9.99");
    expect(hbar.amount).toBe("10");
  });

  it("returns fiat-only prices for directory listing", async () => {
    const res = await makeApp().request(
      "/api/v1/catalog/products/DIRECTORY_LISTING/prices",
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.prices).toHaveLength(1);
    expect(body.prices[0]).toMatchObject({
      amount: "29.99",
      currency: "USD",
    });
  });

  it("404s on unknown product code", async () => {
    const res = await makeApp().request(
      "/api/v1/catalog/products/UNKNOWN/prices",
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body.code).toBe("RESOURCE_NOT_FOUND");
  });
});
