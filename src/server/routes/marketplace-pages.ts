/**
 * Marketplace UI routes (EPIC-138, SLICE-138-5).
 *
 * GET /market/services        — catalog grid + search/category filter
 * GET /market/services/:id    — service detail
 * GET /market/buy/:serviceId  — standalone checkout (D7 embeddable buyUrl)
 * GET /market/sell            — business onboarding
 * GET /market/passes          — buyer's passes
 *
 * Registered only when marketplace.enabled. GET /market itself stays a
 * 301 → /services/marketplace (SLICE-131-2 SEO fix, untouched).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  marketCatalogPage,
  marketServicePage,
  marketCheckoutPage,
  marketSellPage,
  marketPassesPage,
} from "../../views/marketplace-pages";
import { getService, listServices } from "../lib/marketplace";
import { ErrorCodes } from "../lib/error-codes";
import { errorResponse } from "../lib/error-response";

export const marketplacePageRoutes = new Hono();

marketplacePageRoutes.get(
  "/market/services",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Service catalog page",
    description:
      "SSR catalog grid with ?q= search and ?category= filter. " +
      "Machine-readable equivalent: GET /api/market/services.",
    responses: { 200: { description: "HTML catalog page" } },
  }),
  (c) => {
    const filter = {
      category: c.req.query("category") || undefined,
      q: c.req.query("q") || undefined,
    };
    return c.html(marketCatalogPage(listServices(filter), filter));
  },
);

marketplacePageRoutes.get(
  "/market/services/:id",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Service detail page",
    responses: {
      200: { description: "HTML detail page" },
      404: { description: "Unknown service" },
    },
  }),
  (c) => {
    const svc = getService(c.req.param("id"));
    if (!svc) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "Unknown serviceId",
      );
    }
    return c.html(marketServicePage(svc));
  },
);

marketplacePageRoutes.get(
  "/market/buy/:serviceId",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Standalone checkout page (D7 embeddable buyUrl)",
    description:
      "Browser x402 checkout: connect wallet → EIP-3009 sign → pay → " +
      "pass minted. Businesses embed this URL as their buy link.",
    responses: {
      200: { description: "HTML checkout page" },
      404: { description: "Unknown service" },
    },
  }),
  (c) => {
    const svc = getService(c.req.param("serviceId"));
    if (!svc) {
      return errorResponse(
        c,
        404,
        ErrorCodes.RESOURCE_NOT_FOUND,
        "Unknown serviceId",
      );
    }
    return c.html(marketCheckoutPage(svc));
  },
);

marketplacePageRoutes.get(
  "/market/sell",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Business onboarding page",
    description:
      "Mint a Business Passport (x402) then register services — " +
      "produces an embeddable buyUrl per service.",
    responses: { 200: { description: "HTML onboarding page" } },
  }),
  (c) => c.html(marketSellPage()),
);

marketplacePageRoutes.get(
  "/market/passes",
  describeRoute({
    tags: ["Marketplace"],
    summary: "Buyer passes page",
    description:
      "Connect or paste a wallet to list its service passes with expiry.",
    responses: { 200: { description: "HTML passes page" } },
  }),
  (c) => c.html(marketPassesPage()),
);
