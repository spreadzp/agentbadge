/**
 * SLICE-152-6: provider profile page routes.
 *
 * - GET /market/providers           — profile cards (index stats, no chain)
 * - GET /market/providers/:address  — full profile page (identity + jobs)
 * - GET /market/providers/new       — register-offer form (151-9, moved here)
 *
 * Extracted from venue-pages.ts (max-lines). Mounted inside
 * createVenuePageRoutes with the shared VenuePageDeps.
 */
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import type { VenuePageDeps } from "./venue-pages";
import type { VenueNetwork } from "../lib/venue/chain";
import {
  getProviderProfile,
  listProviderSummaries,
} from "../lib/venue/profiles";
import {
  venueNewProviderPage,
  venueProvidersPage,
} from "../../views/venue-forms";
import { venueProviderDetailPage } from "../../views/venue-profiles";

export function registerVenueProfilePageRoutes(
  app: Hono,
  deps: VenuePageDeps,
  net: () => VenueNetwork,
): void {
  // /market/providers — SLICE-152-6 profile cards (index stats).
  app.get(
    "/market/providers",
    describeRoute({
      tags: ["Venue"],
      summary: "Providers page — profile cards",
      responses: { 200: { description: "HTML list" } },
    }),
    (c) => c.html(venueProvidersPage(listProviderSummaries(), net())),
  );

  // ── /market/providers/new — static route BEFORE :address param ──
  app.get(
    "/market/providers/new",
    describeRoute({
      tags: ["Venue"],
      summary: "Register-offer form (ERC-8004 ownerOf gate)",
      responses: { 200: { description: "HTML form" } },
    }),
    (c) => c.html(venueNewProviderPage(net())),
  );

  // /market/providers/:address — profile detail (152-6).
  app.get(
    "/market/providers/:address",
    describeRoute({
      tags: ["Venue"],
      summary: "Provider profile page",
      responses: { 200: { description: "HTML page" } },
    }),
    async (c) => {
      const address = c.req.param("address");
      // Garbage params (e.g. "0x....md.md.md") must 404 — an empty
      // profile 200 gives crawlers an infinite URL space to index.
      if (!/^0x[0-9a-fA-F]{40}$/.test(address)) return c.notFound();
      const profile = await getProviderProfile(address, deps.profiles);
      return c.html(venueProviderDetailPage(profile, net()));
    },
  );
}
