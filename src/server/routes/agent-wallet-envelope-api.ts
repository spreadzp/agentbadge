// SLICE-155-2: spend envelope routes.
//  PATCH /api/wallets/:address/envelope — set caps (registrant or venue
//   admin wallet-sig; monotonic perTx≤daily≤weekly≤monthly)
//  GET   /api/wallets/:address/envelope — caps + rolling usage per window

import { Hono, type Context } from "hono";
import { describeRoute } from "hono-openapi";
import { logger } from "@agentbadge/passport";

import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { requireVenueAccess } from "../middleware/venue-auth";
import type { AgentWalletStore } from "../lib/agent-wallet/registry";
import { validateCaps } from "../lib/agent-wallet/envelope";
import { windowUsage, WINDOW_SEC, type SpendLedger } from "../lib/agent-wallet/ledger";

export interface AgentWalletEnvelopeDeps {
  store: AgentWalletStore;
  ledger: SpendLedger;
}

const ADDRESS_RE = /^0x[a-fA-F0-9]{40}$/;

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

export function createAgentWalletEnvelopeRoutes(
  deps: AgentWalletEnvelopeDeps,
): Hono {
  const routes = new Hono();

  routes.patch(
    "/api/wallets/:address/envelope",
    describeRoute({
      description:
        "Set spend caps — registrant or venue admin. Monotonic perTx≤daily≤weekly≤monthly.",
      responses: {
        200: { description: "{address, envelope}" },
        400: { description: "Invalid caps" },
        401: { description: "Signature required" },
        403: { description: "Not registrant / venue admin" },
        404: { description: "Wallet not found" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address");
      }
      const rec = await deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }
      const caller = await sigWallet(c);
      if (!caller) {
        return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
          "valid X-Wallet/X-Sig/X-Timestamp required");
      }
      const isRegistrant = caller === rec.registeredBy;
      let isVenueAdmin = false;
      if (!isRegistrant && rec.venueId) {
        const access = await requireVenueAccess(c, rec.venueId, "admin");
        isVenueAdmin = !(access instanceof Response);
      }
      if (!isRegistrant && !isVenueAdmin) {
        return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
          "only registrant or venue admin can set envelope");
      }
      let caps;
      try {
        caps = validateCaps(await c.req.json());
      } catch (err) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT,
          err instanceof Error ? err.message : "invalid caps");
      }
      if (!(await deps.store.setEnvelope(rec.address, caps))) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }
      logger.info("agent-wallet: envelope set", {
        address: rec.address,
        by: caller,
        caps,
      });
      return c.json({ address: rec.address, envelope: caps });
    },
  );

  routes.get(
    "/api/wallets/:address/envelope",
    describeRoute({
      description:
        "Spend caps + rolling-window usage {daily:{used,cap?,resetAt?}, ...}",
      responses: {
        200: { description: "{address, caps, usage}" },
        404: { description: "Wallet not found" },
      },
    }),
    async (c) => {
      const addr = c.req.param("address");
      if (!ADDRESS_RE.test(addr)) {
        return errorResponse(c, 400, ErrorCodes.INVALID_INPUT, "invalid address");
      }
      const rec = await deps.store.get(addr);
      if (!rec || !rec.active) {
        return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
          "wallet not registered");
      }
      const caps = rec.envelope;
      const usage: Record<
        string,
        { used: number; cap?: number; resetAt?: number }
      > = {};
      const windows: Array<[string, number | undefined, number]> = [
        ["daily", caps.dailyUsd, WINDOW_SEC.daily],
        ["weekly", caps.weeklyUsd, WINDOW_SEC.weekly],
        ["monthly", caps.monthlyUsd, WINDOW_SEC.monthly],
      ];
      for (const [name, cap, windowSec] of windows) {
        const { used, oldestAt } = await windowUsage(
          deps.ledger,
          rec.address,
          windowSec,
        );
        usage[name] = {
          used,
          ...(cap !== undefined ? { cap } : {}),
          ...(oldestAt !== undefined
            ? { resetAt: Math.floor((oldestAt + windowSec * 1000) / 1000) }
            : {}),
        };
      }
      if (caps.perTxUsd !== undefined) {
        usage.perTx = { used: 0, cap: caps.perTxUsd };
      }
      return c.json({ address: rec.address, caps, usage });
    },
  );

  return routes;
}
