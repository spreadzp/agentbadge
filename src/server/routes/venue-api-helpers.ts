/**
 * Shared venue-api helpers (extracted to keep route files under max-lines).
 * Request signing, input coercion, evaluator EOA, status maps.
 */

import type { Context } from "hono";
import { describeRoute } from "hono-openapi";
import { getAddress, isAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { verifyWalletSigRequest } from "../middleware/agent-auth";
import { errorResponse } from "../lib/error-response";
import { ErrorCodes } from "../lib/error-codes";

export const ERC8183_STATUS: Record<number, string> = {
  0: "open", 1: "funded", 2: "submitted",
  3: "completed", 4: "rejected", 5: "expired",
};

export const TX_PHASES = [
  "created", "claimed", "funded", "submitted", "completed", "rejected",
  "refunded", "rated",
] as const;

/** Evaluator EOA for new jobs — derived from ARC_EVALUATOR_KEY. */
export function venueEvaluator(): `0x${string}` {
  const key = process.env.ARC_EVALUATOR_KEY;
  if (key && /^0x[0-9a-fA-F]{64}$/.test(key)) {
    return privateKeyToAccount(key as `0x${string}`).address;
  }
  return (process.env.CIRCLE_TREASURY_ADDRESS ??
    "0x0000000000000000000000000000000000000000") as `0x${string}`;
}

/**
 * 153-4: evaluator policy resolution (D6-153). Business venues pin the
 * createJob evaluator to policies.evaluator — "server" (default → server
 * EOA), "owner" → ownerWallet, "custom:<addr>" → that address. The stored
 * job.evaluator is then enforced by actorAllowed on evaluate/reject, so a
 * non-policy signer gets 403 (or calldata to broadcast from the policy addr).
 */
export function resolveVenueEvaluator(
  venue: { policies?: { evaluator?: string }; ownerWallet: `0x${string}` } |
    undefined,
): `0x${string}` {
  const p = venue?.policies?.evaluator ?? "server";
  if (p === "owner" && venue) return venue.ownerWallet;
  if (p.startsWith("custom:")) {
    const addr = p.slice(7);
    if (isAddress(addr)) return getAddress(addr);
  }
  return venueEvaluator();
}

export function str(v: unknown, max: number): string | null {
  return typeof v === "string" && v.trim().length > 0 && v.length <= max
    ? v.trim()
    : null;
}

export async function walletSig(
  c: Context,
): Promise<{ valid: true; wallet: `0x${string}` } | { valid: false }> {
  const wallet = c.req.header("x-wallet");
  const sig = await verifyWalletSigRequest({
    wallet,
    signature: c.req.header("x-sig"),
    timestamp: c.req.header("x-timestamp"),
    method: c.req.method,
    path: c.req.path,
  });
  if (sig !== "valid" || !wallet || !isAddress(wallet)) return { valid: false };
  return { valid: true, wallet: getAddress(wallet) };
}

export async function signedJson(
  c: Context,
): Promise<{ wallet: `0x${string}`; body: Record<string, unknown> } | Response> {
  const sig = await walletSig(c);
  if (!sig.valid) {
    return errorResponse(c, 401, ErrorCodes.WRONG_SIGNER,
      "valid X-Wallet/X-Sig/X-Timestamp required");
  }
  const body = (await c.req.json().catch(() => null)) as Record<string, unknown> | null;
  if (!body) {
    return errorResponse(c, 400, ErrorCodes.INVALID_JSON, "JSON body required");
  }
  return { wallet: sig.wallet, body };
}

export const dr = (summary: string) =>
  describeRoute({ tags: ["Venue"], summary, responses: { 200: { description: summary } } });
