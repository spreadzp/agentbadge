/**
 * SLICE-197-06: bounty claim route.
 * POST /api/bounties/:id/claim — Bearer agb_ passport gate (Q35/Q36)
 * + EIP-191 payout bind + TTL lease + variant-aware provider bind.
 */
import { Hono } from "hono";
import { isAddress } from "viem";

import { dr, str } from "./venue-api-helpers";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { claimBounty, type ClaimDeps } from "../lib/bounties/claim";

interface AgentCtx {
  agentId: string;
  tier: string;
  name?: string;
}

export function createBountyRoutes(deps: ClaimDeps = {}) {
  // agent is set by the global agentKeyAuth middleware (Bearer agb_).
  const app = new Hono<{ Variables: { agent?: AgentCtx } }>();

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
