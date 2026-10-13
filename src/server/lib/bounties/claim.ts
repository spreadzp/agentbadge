/**
 * SLICE-197-06: bounty claim — passport-gated lease + payout bind.
 *
 * Flow (Q4/Q35/Q38-A/D-197-6): agent authenticates via Bearer agb_
 * (agentKeyAuth → passportId), binds payout wallet with an EIP-191
 * signature over `bounty-claim:{bountyId}:{payoutWallet}`, gets a
 * TTL lease (BOUNTY_CLAIM_TTL_MS, default 2h) recorded in
 * bountyClaim. Onchain provider bind is variant-aware:
 *   - acp (mainnet): ops-signer (job client) calls setProvider(jobId,
 *     payoutWallet, 0x) — server-send when a role key exists, else the
 *     calldata returns for manual relay.
 *   - circle (testnet): no setProvider — payout wallet self-assigns by
 *     signing setBudget(jobId, budget, 0x); calldata goes back to the
 *     agent and the txHash is reverified by the sweeper (197-07).
 * In both variants provider == payoutWallet (Q38-A).
 *
 * Cooldown (Q28): a passport cannot re-claim the same bounty while it
 * still holds a live lease on it. Re-claim cap (Q38-A): max
 * BOUNTY_MAX_JOB_ATTEMPTS (2) jobs per bounty.
 */
import { logger } from "@agentbadge/passport";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import { publicClient, resolveVenueNetwork } from "../venue/chain";
import type { VenueNetwork } from "../venue/chain";
import {
  buildActionTxs,
  sendAsRole,
  type PreparedTx,
} from "../venue/lifecycle";
import { assertBountyTransition } from "./lifecycle";
import {
  appendTransition,
  bountyStoreReady,
  claimKey,
  getBounty,
  getClaim,
  listClaimsByPassport,
  upsertBounty,
  upsertClaim,
  type BountyClaimRecord,
  type BountyRecord,
} from "./store";

// ─── Config ────────────────────────────────────────────────────

export const CLAIM_TTL_MS = () =>
  Number(process.env.BOUNTY_CLAIM_TTL_MS ?? 2 * 60 * 60 * 1000); // 2h (Q6)
export const MAX_JOB_ATTEMPTS = () =>
  Number(process.env.BOUNTY_MAX_JOB_ATTEMPTS ?? 2); // Q38-A

/** Signature freshness window for the payout bind (197-16 C-1). */
export const CLAIM_SIG_TTL_MS = () =>
  Number(process.env.BOUNTY_CLAIM_SIG_TTL_MS ?? 600_000); // 10 min

/**
 * Canonical EIP-191 message for payout bind.
 * 197-16 C-1: bound to chainId + jobAttempt + expiry so a captured
 * signature cannot be replayed across chains, attempts, or time.
 */
export function claimMessage(
  bountyId: string,
  wallet: string,
  chainId: number | bigint,
  jobAttempt: number,
  expiresAtMs: number,
): string {
  return `bounty-claim:${chainId}:${bountyId}:${jobAttempt}:` +
    `${wallet.toLowerCase()}:${expiresAtMs}`;
}

// ─── Deps (injectable for tests) ───────────────────────────────

export interface ClaimDeps {
  network?: () => VenueNetwork;
  /** EIP-191 verify for payoutWallet over claimMessage. */
  verifyPayoutSig?: (
    wallet: string,
    message: string,
    signature: string,
  ) => Promise<boolean>;
  /** Server-side send for the ops signer (acp setProvider path). */
  sendProviderTx?: (
    txs: PreparedTx[],
    net: VenueNetwork,
  ) => Promise<`0x${string}`[] | null>;
  now?: () => number;
}

async function defaultVerifyPayoutSig(
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

/** Provider-bind tx per variant (D-197-6) — built in lifecycle.ts. */
function providerBindTx(
  net: VenueNetwork,
  bounty: BountyRecord,
  payoutWallet: `0x${string}`,
): PreparedTx | null {
  if (!bounty.onchainJobId) return null;
  const jobId = BigInt(bounty.onchainJobId);
  const txs = buildActionTxs(net, "claim", {
    onchainJobId: jobId,
    provider: payoutWallet,
    amountUsdc: Number(bounty.budgetUsdc),
  });
  return txs[0] ?? null;
}

// ─── Claim ─────────────────────────────────────────────────────

export interface ClaimRequest {
  bountyId: string;
  passportId: string;
  payoutWallet: `0x${string}`;
  /** EIP-191 signature over claimMessage(bountyId, wallet, chainId, attempt, sigExpiresAt). */
  claimSig: string;
  /** Client-declared signature expiry (ms); bounded by CLAIM_SIG_TTL_MS. */
  sigExpiresAt?: number;
}

export type ClaimResult =
  | {
      ok: true;
      claim: BountyClaimRecord;
      bounty: BountyRecord;
      providerTx?: PreparedTx;
      providerBind: "ops_sent" | "ops_calldata" | "agent_selfsign" | "none";
      txHash?: `0x${string}`;
    }
  | { ok: false; status: number; code: ErrorCode; message: string };

export async function claimBounty(
  req: ClaimRequest,
  deps: ClaimDeps = {},
): Promise<ClaimResult> {
  await bountyStoreReady();
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = (deps.now ?? Date.now)();

  const bounty = getBounty(req.bountyId);
  if (!bounty) {
    return { ok: false, status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: "unknown bountyId" };
  }

  const check = assertBountyTransition(bounty.status, "claim");
  if (!check.ok) {
    return { ok: false, status: 409, code: ErrorCodes.INVALID_STATE,
      message: check.reason ?? "cannot claim" };
  }
  if (bounty.jobAttempt > MAX_JOB_ATTEMPTS()) {
    return { ok: false, status: 409, code: ErrorCodes.BOUNTY_CAP_REACHED,
      message: `re-claim cap exhausted (${MAX_JOB_ATTEMPTS()} jobs)` };
  }

  // Double claim: an attempt can carry exactly one claim row.
  if (getClaim(req.bountyId, bounty.jobAttempt)) {
    return { ok: false, status: 409, code: ErrorCodes.BOUNTY_ALREADY_CLAIMED,
      message: "bounty already claimed for this attempt" };
  }

  // Cooldown (Q28): same passport holds a live lease on this bounty.
  const live = listClaimsByPassport(req.passportId).find(
    (c) =>
      c.bountyId === req.bountyId &&
      c.state === "open" &&
      c.leaseUntilMs > now,
  );
  if (live) {
    return { ok: false, status: 409, code: ErrorCodes.BOUNTY_COOLDOWN,
      message: "passport holds a live lease on this bounty" };
  }

  // 197-16 C-1: signature must carry an in-window expiry bound to
  // this chain + attempt — a leaked sig is useless elsewhere/later.
  const expiresAt = req.sigExpiresAt;
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > CLAIM_SIG_TTL_MS()
  ) {
    return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: `sigExpiresAt must be within ${CLAIM_SIG_TTL_MS()}ms` };
  }

  const verify =
    deps.verifyPayoutSig ??
    ((w, m, s) => defaultVerifyPayoutSig(net, w, m, s));
  const sigOk = await verify(
    req.payoutWallet,
    claimMessage(
      req.bountyId,
      req.payoutWallet,
      net.chain.chainId,
      bounty.jobAttempt,
      expiresAt,
    ),
    req.claimSig,
  );
  if (!sigOk) {
    return { ok: false, status: 403, code: ErrorCodes.WRONG_SIGNER,
      message: "payout wallet signature verification failed" };
  }

  const claim: BountyClaimRecord = {
    id: claimKey(req.bountyId, bounty.jobAttempt),
    bountyId: req.bountyId,
    jobAttempt: bounty.jobAttempt,
    passportId: req.passportId,
    payoutWallet: req.payoutWallet.toLowerCase(),
    state: "open",
    claimedAtMs: now,
    leaseUntilMs: now + CLAIM_TTL_MS(),
  };
  upsertClaim(claim);
  const claimed: BountyRecord = { ...bounty, status: "claimed" };
  upsertBounty(claimed);
  appendTransition({
    id: `${req.bountyId}:${bounty.jobAttempt}:claim:${now}`,
    bountyId: req.bountyId,
    actor: req.passportId,
    from: "open",
    to: "claimed",
    atMs: now,
    payload: { payoutWallet: req.payoutWallet.toLowerCase() },
  });

  // Provider bind (D-197-6).
  const tx = providerBindTx(net, claimed, req.payoutWallet);
  if (!tx) {
    return { ok: true, claim, bounty: claimed, providerBind: "none" };
  }
  if (net.variant === "acp") {
    const send =
      deps.sendProviderTx ??
      ((txs, n) => sendAsRole("client", txs, n.chain.rpcUrl));
    const hashes = await send([tx], net).catch((err) => {
      logger.warn("bounty claim: setProvider send failed", {
        bountyId: req.bountyId,
        err: String(err).slice(0, 200),
      });
      return null;
    });
    if (hashes?.length) {
      return { ok: true, claim, bounty: claimed,
        providerBind: "ops_sent", txHash: hashes[0] };
    }
    return { ok: true, claim, bounty: claimed,
      providerBind: "ops_calldata", providerTx: tx };
  }
  return { ok: true, claim, bounty: claimed,
    providerBind: "agent_selfsign", providerTx: tx };
}
