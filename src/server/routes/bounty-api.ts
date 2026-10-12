/**
 * SLICE-197-05/06: bounty API.
 * POST /api/bounties          — create w/ structured brief (passport, Q33–36)
 * GET  /api/bounties          — public feed, no brief/budget (Q20)
 * GET  /api/bounties/:id      — brief, passport + owner-sig gate (Q35)
 * POST /api/bounties/:id/claim — lease + EIP-191 payout bind (197-06)
 */
import { Hono } from "hono";
import { isAddress } from "viem";

import { dr, str } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { claimBounty, type ClaimDeps } from "../lib/bounties/claim";
import {
  checkBriefAccess,
  createBounty,
  publicFeed,
  type BriefAccessDeps,
  type CreateBountyInput,
} from "../lib/bounties/brief";
import type { BountyStatus } from "../lib/bounties/lifecycle";
import { getBounty } from "../lib/bounties/store";

interface AgentCtx {
  agentId: string;
  tier: string;
  name?: string;
}

export interface BountyRouteDeps extends ClaimDeps, BriefAccessDeps {
  newBountyId?: () => string;
}

export function createBountyRoutes(deps: BountyRouteDeps = {}) {
  // agent is set by the global agentKeyAuth middleware (Bearer agb_).
  const app = new Hono<{ Variables: { agent?: AgentCtx } }>();

  app.post("/bounties", dr("Create bounty (operator passport)"), async (c) => {
    const agent = c.get("agent");
    if (!agent?.agentId) {
      return errorResponse(
        c,
        403,
        ErrorCodes.PASSPORT_NOT_FOUND,
        "passport required — create is limited to registered agents (Q35)",
        { hint: "Register a passport via POST /api/v1/agents/register" },
      );
    }
    const body = (await c.req
      .json()
      .catch(() => null)) as CreateBountyInput | null;
    const result = createBounty(
      body ?? {},
      { passportId: String(agent.agentId) },
      { newId: deps.newBountyId },
    );
    if (!result.ok) {
      return errorResponse(c, result.status, result.code, result.message);
    }
    return c.json({ bounty: result.bounty }, 201);
  });

  app.get("/bounties", dr("Public bounty feed (status only, Q20)"), (c) => {
    const status = str(c.req.query("status"), 20) as BountyStatus | "";
    const limit = Math.min(Number(str(c.req.query("limit"), 6)) || 50, 200);
    return c.json({
      bounties: publicFeed(status ? { status, limit } : { limit }),
    });
  });

  app.get("/bounties/:id", dr("Bounty brief (passport owner only)"), async (c) => {
    const agent = c.get("agent");
    const deny = await checkBriefAccess(
      {
        passportId: agent?.agentId ? String(agent.agentId) : undefined,
        wallet: c.req.header("x-wallet"),
        signature: c.req.header("x-sig"),
        timestamp: c.req.header("x-timestamp"),
        method: c.req.method,
        path: c.req.path,
      },
      deps,
    );
    if (deny) {
      return errorResponse(c, deny.status, deny.code, deny.message);
    }
    const bounty = getBounty(c.req.param("id"));
    if (!bounty) {
      return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
        "unknown bountyId");
    }
    return c.json({ bounty });
  });

  app.post("/bounties/:id/claim", dr("Claim bounty (passport + payout bind)"), async (c) => {
    const agent = c.get("agent");
    if (!agent?.agentId) {
      return errorResponse(
        c,
        403,
        ErrorCodes.PASSPORT_NOT_FOUND,
        "passport required — authenticate with Bearer agb_ key (Q35)",
        { hint: "Register a passport via POST /api/v1/agents/register" },
      );
    }
    const bountyId = c.req.param("id") ?? "";
    const body = (await c.req
      .json()
      .catch(() => null)) as Record<string, unknown> | null;
    const payoutWallet = str(body?.payoutWallet, 64);
    const claimSig = str(body?.claimSig, 1024);
    if (!payoutWallet || !isAddress(payoutWallet) || !claimSig) {
      return errorResponse(
        c,
        400,
        ErrorCodes.MISSING_FIELDS,
        "body must contain payoutWallet (0x…) and claimSig (EIP-191 over bounty-claim:{id}:{wallet})",
      );
    }
    const result = await claimBounty(
      {
        bountyId,
        passportId: String(agent.agentId),
        payoutWallet: payoutWallet as `0x${string}`,
        claimSig,
      },
      deps,
    );
    if (!result.ok) {
      return errorResponse(
        c,
        result.status as 400 | 403 | 404 | 409,
        result.code,
        result.message,
      );
    }
    return c.json({
      claim: result.claim,
      bounty: result.bounty,
      providerBind: result.providerBind,
      ...(result.providerTx ? { providerTx: result.providerTx } : {}),
      ...(result.txHash ? { txHash: result.txHash } : {}),
    });
  });

  return app;
}

/** Mount under /api — registerApiRoutes calls app.route("/", …). */
export const bountyApiRoutes = createBountyRoutes();
