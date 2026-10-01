/**
 * SLICE-152-1: offers catalog routes — extracted from venue-api.ts
 * to keep files under max-lines. Same app + deps seam.
 */
import { randomBytes } from "node:crypto";
import type { Hono } from "hono";
import { logger } from "@agentbadge/passport";
import {
  deactivateOffer,
  listOffers,
  upsertOffer,
  type VenueOffer,
} from "../lib/venue/store";
import type { VenueNetwork } from "../lib/venue/chain";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { dr, signedJson, str } from "./venue-api-helpers";
import { recordVenueEvent } from "../services/venue-events";

export interface OfferRouteDeps {
  network: () => VenueNetwork;
  agentOwner: (id: number, net: VenueNetwork) => Promise<`0x${string}` | null>;
}

export function registerOfferRoutes(app: Hono, deps: OfferRouteDeps): void {
  const net = deps.network;
  const agentOwner = deps.agentOwner;

  app.get("/api/venue/offers", dr("List provider offers"), (c) => {
    const provider = c.req.query("provider") || undefined;
    const activeQ = c.req.query("active");
    const active =
      activeQ === undefined ? undefined : ["1", "true", "yes"].includes(activeQ);
    return c.json({
      offers: listOffers({ provider, active, limit: 50 }),
      network: net().name,
    });
  });

  // POST /api/venue/offers — D5 provider gate: agentId + ownerOf match
  // required when ARC_VENUE_PROVIDER_GATE=1; without the gate agentId is
  // optional but still verified onchain when supplied.
  app.post("/api/venue/offers", dr("Register provider offer (ownerOf gate)"), async (c) => {
    const s = await signedJson(c);
    if (s instanceof Response) return s;
    const { body } = s;
    const gateOn = ["1", "true"].includes(
      (process.env.ARC_VENUE_PROVIDER_GATE ?? "").toLowerCase(),
    );
    const hasAgentId = body.agentId !== undefined && body.agentId !== null;
    const agentId = hasAgentId ? Number(body.agentId) : undefined;
    const name = str(body.name ?? body.title, 100);
    const description = str(body.description, 500);
    const endpoint = body.endpoint == null ? undefined : str(body.endpoint, 500);
    if (agentId !== undefined && (!Number.isInteger(agentId) || agentId < 0)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        "agentId must be a non-negative integer");
    }
    if (gateOn && agentId === undefined) {
      return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
        "agentId required — provider gate enabled (ARC_VENUE_PROVIDER_GATE=1)");
    }
    if (!name || !description) {
      return errorResponse(c, 400, ErrorCodes.MISSING_FIELDS,
        "name (≤100) + description (≤500) required");
    }
    if (endpoint !== undefined && (endpoint === null || !/^https:\/\//.test(endpoint))) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "endpoint must be https://");
    }
    const priceUsdc =
      body.priceUsdc === undefined || body.priceUsdc === null
        ? undefined
        : Number(body.priceUsdc);
    if (priceUsdc !== undefined && (!Number.isFinite(priceUsdc) || priceUsdc <= 0 || priceUsdc > 1_000_000)) {
      return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
        "priceUsdc must be a number in (0, 1000000]");
    }
    const n = net();
    if (agentId !== undefined) {
      const owner = await agentOwner(agentId, n);
      if (!owner) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          `agentId ${agentId} not found on ${n.name} identity registry`);
      }
      if (owner.toLowerCase() !== s.wallet.toLowerCase()) {
        return errorResponse(c, 403, ErrorCodes.PASSPORT_OWNERSHIP_MISMATCH,
          `agentId ${agentId} is owned by ${owner}, not the signer`);
      }
    } else {
      logger.warn("venue: offer registered without agentId (provider gate off)", {
        provider: s.wallet,
      });
    }
    const offer: VenueOffer = {
      id: `vo_${randomBytes(8).toString("hex")}`,
      providerAddress: s.wallet,
      agentId,
      name, description, endpoint, priceUsdc,
      claimable: body.claimable === undefined ? true : Boolean(body.claimable),
      active: true,
      categories: Array.isArray(body.categories)
        ? (body.categories as unknown[])
          .map((x) => str(x, 50))
          .filter((x): x is string => !!x)
          .slice(0, 10)
        : [],
      createdAt: new Date().toISOString(),
    };
    upsertOffer(offer);
    logger.info("venue: provider offer registered", {
      provider: s.wallet, agentId, id: offer.id,
    });
    recordVenueEvent({
      action: "offer.registered",
      text: `provider offer — “${name}”${agentId !== undefined ? ` · agentId ${agentId}` : ""}`,
      dedupeKey: `offer:${offer.id}`,
    });
    return c.json({ offer });
  });

  // DELETE /api/venue/offers/:id — MVP: admin bearer key soft-deletes
  // (active=false). TODO(EPIC-153): SIWE-lite signed challenge so
  // providers deactivate their own offers without the admin key.
  app.delete("/api/venue/offers/:id", dr("Deactivate offer (admin key)"), (c) => {
    const adminKey = process.env.ARC_VENUE_ADMIN_KEY;
    const auth = c.req.header("authorization") ?? "";
    if (!adminKey || auth !== `Bearer ${adminKey}`) {
      return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
        "admin bearer key required (ARC_VENUE_ADMIN_KEY)");
    }
    const id = c.req.param("id");
    if (!deactivateOffer(id)) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown offer id");
    }
    recordVenueEvent({
      action: "offer.deactivated",
      text: `offer ${id} deactivated`,
      dedupeKey: `offer.deactivated:${id}`,
    });
    return c.json({ id, active: false });
  });
}
