/**
 * SLICE-153-1: venue instance page routes.
 *
 *   GET /market/v/:slug — business-venue landing (scoped jobs + offers).
 *
 * Mounted inside the ARC_VENUE_ENABLED gate via createVenuePageRoutes.
 * Public venue resolves to /market (redirect); unknown slug → 404.
 */
import type { Hono } from "hono";
import { describeRoute } from "hono-openapi";

import { listJobs, listOffers } from "../lib/venue/store";
import type { VenueNetwork } from "../lib/venue/chain";
import { resolveVenueNetwork } from "../lib/venue/chain";
import {
  getVenue,
  listVenues,
  PUBLIC_VENUE_ID,
} from "../lib/venue/venues";
import { venueInstancePage, venuePrivatePage } from "../../views/venue-instance";
import { venueRole } from "../lib/venue/members";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";

export interface VenueInstancePageDeps {
  network?: () => VenueNetwork;
}

export function registerVenueInstancePageRoutes(
  app: Hono,
  deps: VenueInstancePageDeps = {},
): void {
  const net = deps.network ?? resolveVenueNetwork;

  app.get(
    "/market/v/:slug",
    describeRoute({
      tags: ["Venue"],
      summary: "Venue instance landing (scoped jobs + offers)",
      responses: {
        200: { description: "HTML page" },
        404: { description: "Unknown venue slug" }
      },
    }),
    (c) => {
      const slug = c.req.param("slug");
      if (slug === PUBLIC_VENUE_ID) return c.redirect("/market");
      const venue = getVenue(slug);
      if (!venue) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "venue not found");
      }
      // 153-2: business venues render a "request access" screen unless
      // the viewer's wallet (x-wallet header) is a venue member.
      if (venue.kind === "business") {
        const viewer = c.req.header("x-wallet");
        if (!viewer || !venueRole(venue, viewer)) {
          return c.html(venuePrivatePage(venue, listVenues(), net()));
        }
      }
      const jobs = listJobs({ venueId: venue.id });
      const offers = listOffers({ venueId: venue.id });
      return c.html(
        venueInstancePage(venue, jobs, offers, listVenues(), net()),
      );
    },
  );
}
