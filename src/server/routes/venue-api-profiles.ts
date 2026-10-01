/**
 * SLICE-152-6: provider/client profile routes.
 *
 * - GET /api/venue/providers           — distinct providers + index stats
 * - GET /api/venue/providers/:address  — full profile (identity+stats+offers)
 * - GET /api/venue/clients/:address    — thin client profile (posted/funded)
 *
 * Extracted from venue-api.ts (max-lines). Deps flow through VenueDeps;
 * tests inject `profiles.agentLookup`/`reputationRead` to avoid RPC.
 */
import type { Hono } from "hono";
import type { ProviderProfileDeps } from "../lib/venue/profiles";
import {
  getClientProfile,
  getProviderProfile,
  listProviderSummaries,
} from "../lib/venue/profiles";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { dr } from "./venue-api-helpers";

export interface VenueProfileRoutesDeps {
  profiles?: ProviderProfileDeps;
}

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/;

export function registerVenueProfileRoutes(
  app: Hono,
  deps: VenueProfileRoutesDeps = {},
): void {
  // GET /api/venue/providers — list (index data only, no chain reads).
  app.get("/api/venue/providers", dr("List venue providers"), (c) => {
    const providers = listProviderSummaries();
    return c.json({ providers, count: providers.length });
  });

  // GET /api/venue/providers/:address — merged profile (152-6).
  app.get(
    "/api/venue/providers/:address",
    dr("Provider profile — ERC-8004 identity + venue index stats + offers"),
    async (c) => {
      const address = c.req.param("address");
      if (!ADDR_RE.test(address)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address");
      }
      const profile = await getProviderProfile(address, deps.profiles ?? {});
      return c.json(profile);
    },
  );

  // GET /api/venue/clients/:address — symmetric thin client profile.
  app.get(
    "/api/venue/clients/:address",
    dr("Client profile — jobs posted/funded/completed"),
    (c) => {
      const address = c.req.param("address");
      if (!ADDR_RE.test(address)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address");
      }
      return c.json(getClientProfile(address));
    },
  );
}
