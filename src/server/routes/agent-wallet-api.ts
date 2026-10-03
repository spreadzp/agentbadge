// SLICE-155-1: agent wallet registry API.
//  POST /api/wallets (wallet-sig proof, EOA+ERC-1271/6492 via shared
//  verifier) | GET /api/wallets/:addr (record + CLI balance mirror) |
//  GET /api/venue/instances/:id/wallets (viewer+) | DELETE (registrant
//  or venue admin). Non-custodial: addresses + metadata only.

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { logger } from "@agentbadge/passport";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { requireVenueAccess } from "../middleware/venue-auth";
import { getVenue } from "../lib/venue/venues";
import { venueRole } from "../lib/venue/members";
import { createRateLimiter } from "../lib/eaas/request";
import {
  validateWalletInput,
  type AgentWalletInput,
  type AgentWalletRecord,
  type AgentWalletStore,
} from "../lib/agent-wallet/registry";
import type { CircleCliClient } from "@agentbadge/circle-payments";
import { CliUnavailableError } from "@agentbadge/circle-payments";

export interface AgentWalletRoutesDeps {
  store: AgentWalletStore;
  /** Circle CLI read mirror — may be absent (balance → "unavailable"). */
  cli?: CircleCliClient;
  chain: string;
  rateRpm: number;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

/** Wallet-sig check shared by POST/DELETE; returns caller wallet or null. */
async function sigWallet(c: Context): Promise<string | null> {
  const wallet = c.req.header("x-wallet");
  const sig = await verifyWalletSigRequest({
    wallet,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  return sig === "valid" && wallet ? wallet.toLowerCase() : null;
}

export function createAgentWalletRoutes(deps: AgentWalletRoutesDeps): Hono {
  const routes = new Hono();
  const limiter = createRateLimiter(deps.rateRpm);

  routes.post(
    "/api/wallets",
    describeRoute({
      description:
        "Register an agent wallet — wallet-sig ownership proof (EOA or ERC-1271 SCA)",
      responses: {
        201: { description: "Registered wallet record" },
        400: { description: "Invalid input" },
        401: { description: "Signature verification failed" },
        409: { description: "Wallet already registered" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      if (!limiter.allow(c.req.header("x-wallet") ?? "anon")) {
        return errorResponse(c, 429, ErrorCodes.RATE_LIMITED, "rate limited");
      }
      const caller = await sigWallet(c);
      if (!caller) {
        return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "valid X-Wallet/X-Sig/X-Timestamp required");
      }

      let body: Partial<AgentWalletInput>;
      try {
        body = (await c.req.json()) as Partial<AgentWalletInput>;
      } catch {
        return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "invalid JSON");
      }

      let validated: Omit<AgentWalletRecord, "createdAt" | "active">;
      try {
        validated = validateWalletInput({
          address: body.address ?? "",
          agentId: body.agentId,
          venueId: body.venueId,
          label: body.label ?? "",
          kind: body.kind,
          envelope: body.envelope,
          registeredBy: caller,
        });
      } catch (err) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          err instanceof Error ? err.message : "invalid input");
      }

      // Signer IS the registered wallet — wallet-sig proves control
      // of the address being registered (spec: no registrant≠address).
      if (caller !== validated.address.toLowerCase()) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "wallet-sig must come from the address being registered");
      }

      // venueId scope requires the registrant to be a member —
      // prevents strangers scoping wallets into someone else's venue.
      if (validated.venueId) {
        const venue = getVenue(validated.venueId);
        if (!venue) {
          return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
            "venue not found");
        }
        if (!venueRole(venue, validated.address)) {
          return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
            "venueId requires venue membership");
        }
      }

      const existing = deps.store.get(validated.address);
      if (existing && existing.active) {
        return errorResponse(c, 409, ErrorCodes.AGENTCARD_DID_CONFLICT,
          "wallet already registered");
      }

      const rec: AgentWalletRecord = {
        ...validated,
        createdAt: Date.now(),
        active: true,
      };
      deps.store.put(rec);
      logger.info("agent-wallet: registered", {
        address: rec.address,
        venueId: rec.venueId,
        kind: rec.kind,
      });
      return c.json(rec, 201);
    },
  );

  routes.get(
    "/api/wallets/:address",
    describeRoute({
      description:
        "Wallet record + live balance mirror from Circle CLI ('unavailable' when CLI off)",
      responses: {
        200: { description: "{record, balance, limits?}" },
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address");
      }
      const rec = deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }

      let balance = "unavailable";
      let limits: unknown;
      if (deps.cli) {
        // Any CLI failure degrades the mirror — record stays served;
        // a flaky/spawning binary must never crash the route.
        try {
          balance = await deps.cli.balance(rec.address, deps.chain);
        } catch (err) {
          logger.debug("agent-wallet: balance mirror failed", {
            address: rec.address,
            err: err instanceof Error ? err.message : String(err),
          });
        }
        try {
          limits = await deps.cli.limits(rec.address, deps.chain);
        } catch (err) {
          if (!(err instanceof CliUnavailableError)) {
            logger.debug("agent-wallet: limits mirror failed", {
              address: rec.address,
              err: err instanceof Error ? err.message : String(err),
            });
          }
        }
      }
      return c.json({ ...rec, balance, ...(limits ? { limits } : {}) });
    },
  );

  routes.get(
    "/api/venue/instances/:id/wallets",
    describeRoute({
      description: "Venue-scoped wallet list — venue members only",
      responses: {
        200: { description: "AgentWalletRecord[]" },
        401: { description: "Signature required" },
        403: { description: "Not a venue member" },
        404: { description: "Venue not found" },
      },
    }),
    async (c) => {
      const access = await requireVenueAccess(c, c.req.param("id"), "viewer");
      if (access instanceof Response) return access;
      const wallets = deps.store
        .list(access.venue.id)
        .filter((w) => w.active);
      return c.json({ venueId: access.venue.id, wallets });
    },
  );

  routes.delete(
    "/api/wallets/:address",
    describeRoute({
      description: "Deactivate a wallet — registrant or venue admin",
      responses: {
        200: { description: "Deactivated" },
        401: { description: "Signature required" },
        403: { description: "Not registrant / venue admin" },
        404: { description: "Not found" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address");
      }
      const rec = deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }

      const caller = await sigWallet(c);
      if (!caller) {
        return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "valid X-Wallet/X-Sig/X-Timestamp required");
      }

      // Allowed: registrant themselves, or venue admin/owner of the
      // wallet's venue scope.
      const isRegistrant = caller === rec.registeredBy;
      let isVenueAdmin = false;
      if (!isRegistrant && rec.venueId) {
        const access = await requireVenueAccess(c, rec.venueId, "admin");
        isVenueAdmin = !(access instanceof Response);
      }
      if (!isRegistrant && !isVenueAdmin) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "only registrant or venue admin can deactivate");
      }

      deps.store.deactivate(rec.address);
      logger.info("agent-wallet: deactivated", {
        address: rec.address,
        by: caller,
      });
      return c.json({ address: rec.address, active: false });
    },
  );

  return routes;
}
