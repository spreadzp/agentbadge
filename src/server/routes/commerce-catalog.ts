/**
 * Commerce catalog routes — GET /api/v1/catalog/products +
 * GET /api/v1/catalog/products/:code/prices
 * (EPIC-221, SLICE-221-1).
 *
 * Public, unauthenticated, cacheable — the canonical machine-readable
 * product/price source for the checkout 2.0 flow (spec §1.3). Prices
 * are decimal-string USD (+ native HBAR for passport tiers); they are
 * never hardcoded in the frontend or at payment providers.
 */
import { Hono } from "hono";
import { describeRoute, resolver } from "hono-openapi";
import { z } from "zod";

import {
  getCommerceProduct,
  listCommerceProducts,
} from "../lib/commerce-catalog";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";

export const commerceCatalogRoutes = new Hono();

const priceSchema = z.object({
  amount: z.string(),
  currency: z.enum(["USD", "HBAR"]),
  active: z.boolean(),
});

const metadataSchemaSchema = z.object({
  required: z.array(z.string()),
  optional: z.array(z.string()),
});

const productSchema = z.object({
  productCode: z.string(),
  name: z.string(),
  description: z.string(),
  active: z.boolean(),
  prices: z.array(priceSchema),
  metadataSchema: metadataSchemaSchema,
  fulfillmentKind: z.enum(["passport-mint", "directory-listing"]),
});

commerceCatalogRoutes.get(
  "/api/v1/catalog/products",
  describeRoute({
    tags: ["Catalog"],
    summary: "List checkout products (commerce catalog)",
    description:
      "Canonical product catalog for checkout 2.0 (EPIC-221): passport USD " +
      "tiers + directory listing. Prices are decimal-string USD with native " +
      "HBAR dual pricing for passport tiers; each product declares its " +
      "metadataSchema validated by POST /api/v1/payments before payment " +
      "creation, and the fulfillmentKind that activates the entitlement.",
    responses: {
      200: {
        description: "Product list",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                total: z.number().int(),
                products: z.array(productSchema),
              }),
            ),
          },
        },
      },
    },
  }),
  (c) => {
    const products = listCommerceProducts();
    return c.json(
      { total: products.length, products },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  },
);

commerceCatalogRoutes.get(
  "/api/v1/catalog/products/:code/prices",
  describeRoute({
    tags: ["Catalog"],
    summary: "Get active prices for a product",
    description:
      "Active price entries for one productCode: USD decimal-string plus " +
      "native HBAR for passport tiers. 404 for unknown codes.",
    responses: {
      200: {
        description: "Active prices",
        content: {
          "application/json": {
            schema: resolver(
              z.object({
                productCode: z.string(),
                prices: z.array(priceSchema),
              }),
            ),
          },
        },
      },
      404: {
        description: "Unknown productCode",
      },
    },
  }),
  (c) => {
    const product = getCommerceProduct(c.req.param("code"));
    if (!product) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        `Unknown productCode: ${c.req.param("code")}`,
      );
    }
    return c.json(
      { productCode: product.productCode, prices: product.prices },
      200,
      { "Cache-Control": "public, max-age=300" },
    );
  },
);
