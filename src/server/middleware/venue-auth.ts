/**
 * SLICE-153-2: venue access gate.
 *
 * requireVenueAccess(c, idOrSlug, minRole) — sig → membership → pass:
 *   1. wallet-sig via verifyWalletSigRequest (EIP-191/1271/6492, re-used);
 *   2. membership: venueRole ≥ minRole, not revoked (instant — meta lane
 *      is read per request, no cache → revoke takes effect immediately);
 *   3. venue.requiredClass > 0 → checkAccess(wallet, cls) — the canonical
 *      cached hasAccess from agent-auth (fail-closed on RPC errors).
 *
 * Public venue: viewer-tier reads pass open (AC: public unchanged);
 * member-tier+ requests on the public venue are meaningless → 403.
 *
 * Returns VenueAccess on success or a ready Response the caller returns.
 * Success sets c.set("agentWallet") + c.set("venueRole").
 */
import type { Context } from "hono";
import { getAddress, isAddress } from "viem";

import { verifyWalletSigRequest, checkAccess } from "./agent-auth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";
import { getVenue, type VenueRecord } from "../lib/venue/venues";
import {
  venueRole,
  type VenueAccessRole,
} from "../lib/venue/members";

export interface VenueAccess {
  wallet: `0x${string}`;
  venue: VenueRecord;
  role: VenueAccessRole;
}

const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;

export async function requireVenueAccess(
  c: Context,
  idOrSlug: string | undefined,
  minRole: VenueAccessRole,
): Promise<VenueAccess | Response> {
  const venue = idOrSlug ? getVenue(idOrSlug) : undefined;
  if (!venue) {
    return errorResponse(c, 404, ErrorCodes.RESOURCE_NOT_FOUND,
      "venue not found");
  }
  if (venue.kind === "public") {
    if (minRole === "viewer") {
      return { wallet: ZERO, venue, role: "viewer" };
    }
    return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
      "public venue has no membership");
  }

  const walletHdr = c.req.header("x-wallet");
  const sig = await verifyWalletSigRequest({
    wallet: walletHdr,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  if (sig !== "valid" || !walletHdr || !isAddress(walletHdr)) {
    return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
      "valid X-Wallet/X-Sig/X-Timestamp required");
  }
  const wallet = getAddress(walletHdr);

  const role = venueRole(venue, wallet);
  if (!role) {
    return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
      "not a venue member");
  }
  const rank: Record<VenueAccessRole, number> = {
    viewer: 0, provider: 1, admin: 2, owner: 3,
  };
  if (rank[role] < rank[minRole]) {
    return errorResponse(c, 403, ErrorCodes.WRONG_SIGNER,
      `requires venue role ≥ ${minRole}`);
  }

  const requiredClass = venue.requiredClass ?? 0;
  if (requiredClass > 0 && !(await checkAccess(wallet, requiredClass))) {
    return errorResponse(c, 402, ErrorCodes.PAYMENT_REQUIRED,
      `venue requires access pass class ${requiredClass}`);
  }

  c.set("agentWallet", wallet);
  c.set("venueRole", role);
  return { wallet, venue, role };
}
