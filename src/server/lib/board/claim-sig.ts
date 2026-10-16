/**
 * SLICE-199-07 (EPIC-199): signature + config surface for the off-chain
 * board claim — the board-specific EIP-191 namespace, freshness window,
 * and the default publicClient verifier (kept apart from claim.ts for
 * the 300-line cap).
 */
import type { CacheProvider } from "@agentbadge/cache";

import {
  publicClient,
  type VenueNetwork,
} from "../venue/chain";

// ─── Config ────────────────────────────────────────────────────

/** Lease TTL — reuses the 197 claim lease (default 2h, AC "cooldown 2ч"). */
export const BOARD_CLAIM_TTL_MS = () =>
  Number(process.env.BOUNTY_CLAIM_TTL_MS ?? 2 * 60 * 60 * 1000);

/** Board attempt cap — BOARD_MAX_ATTEMPTS=4 (D-199-11). */
export const BOARD_MAX_ATTEMPTS = () =>
  Number(process.env.BOARD_MAX_ATTEMPTS ?? 4);

/** Freshness window for the payout-bind signature. */
export const BOARD_CLAIM_SIG_TTL_MS = () =>
  Number(process.env.BOARD_CLAIM_SIG_TTL_MS ?? 600_000); // 10 min

/** Claimlock mutex TTL (seconds). */
export const CLAIMLOCK_TTL_SEC = 30;

/**
 * Canonical EIP-191 message — bound to chainId + cardId + jobAttempt +
 * wallet + expiry: a captured signature cannot be replayed across
 * chains, cards, attempts, wallets, or time. The `board-claim:`
 * namespace keeps it disjoint from 197's `bounty-claim:` messages.
 */
export function boardClaimMessage(
  chainId: number | bigint,
  cardId: string,
  jobAttempt: number,
  wallet: string,
  expiresAtMs: number,
): string {
  return (
    `board-claim:${chainId}:${cardId}:${jobAttempt}:` +
    `${wallet.toLowerCase()}:${expiresAtMs}`
  );
}

// ─── Deps (injectable for tests) ───────────────────────────────

export interface BoardClaimDeps {
  /** null → skip cache paths (degraded mode); undefined → tryGetCache(). */
  cache?: CacheProvider | null;
  network?: () => VenueNetwork;
  verifyPayoutSig?: (
    wallet: string,
    message: string,
    signature: string,
  ) => Promise<boolean>;
  now?: () => number;
}

export async function defaultVerifyPayoutSig(
  net: VenueNetwork,
  wallet: string,
  message: string,
  signature: string,
): Promise<boolean> {
  try {
    return await publicClient(net).verifyMessage({
      address: wallet as `0x${string}`,
      message,
      signature: signature as `0x${string}`,
    });
  } catch {
    return false;
  }
}
