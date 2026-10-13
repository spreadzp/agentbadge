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
import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  publicClient,
  resolveVenueNetwork,
} from "../venue/chain";
import type { VenueNetwork } from "../venue/chain";
import type { PreparedTx } from "../venue/lifecycle";
import { assertBountyTransition } from "./lifecycle";
import { finalizeClaimJob } from "./sweep-chain";
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

// 197-19 e2e: onchain job expiry ≠ offchain claim lease — the contract
// rejects too-near expiredAt, so a short BOUNTY_CLAIM_TTL_MS (expiry
// tests) must not shrink the onchain deadline.
export const JOB_EXPIRY_MS = () =>
  Number(process.env.BOUNTY_JOB_EXPIRY_MS ?? 2 * 60 * 60 * 1000); // 2h

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
  /** Client-role send for the lazy createJob at claim (197-19). */
  sendTx?: (
    txs: PreparedTx[],
    net: VenueNetwork,
  ) => Promise<`0x${string}`[] | null>;
  /** jobId decode after createJob (197-19, H-3 retry seam). */
  fetchJobId?: (
    txHash: `0x${string}`,
    net: VenueNetwork,
  ) => Promise<number | null>;
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
    return {
      ok: false, status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: "unknown bountyId"
    };
  }

  // 197-19 e2e: resume — the claim row is written BEFORE the lazy
  // createJob send, so a transient send failure leaves claimed-without-
  // job and an un-claimable bounty. Same passport + open lease + missing
  // jobId → retry the createJob leg with the existing row.
  const existingClaim = getClaim(req.bountyId, bounty.jobAttempt);
  const resume =
    !!existingClaim &&
    existingClaim.passportId === req.passportId &&
    existingClaim.state === "open" &&
    existingClaim.leaseUntilMs > now &&
    !bounty.onchainJobId;

  if (!resume) {
    const check = assertBountyTransition(bounty.status, "claim");
    if (!check.ok) {
      return {
        ok: false, status: 409, code: ErrorCodes.INVALID_STATE,
        message: check.reason ?? "cannot claim"
      };
    }
    if (bounty.jobAttempt > MAX_JOB_ATTEMPTS()) {
      return {
        ok: false, status: 409, code: ErrorCodes.BOUNTY_CAP_REACHED,
        message: `re-claim cap exhausted (${MAX_JOB_ATTEMPTS()} jobs)`
      };
    }

    // Double claim: an attempt can carry exactly one claim row.
    if (existingClaim) {
      return {
        ok: false, status: 409, code: ErrorCodes.BOUNTY_ALREADY_CLAIMED,
        message: "bounty already claimed for this attempt"
      };
    }

    // Cooldown (Q28): same passport holds a live lease on this bounty.
    const live = listClaimsByPassport(req.passportId).find(
      (c) =>
        c.bountyId === req.bountyId &&
        c.state === "open" &&
        c.leaseUntilMs > now,
    );
    if (live) {
      return {
        ok: false, status: 409, code: ErrorCodes.BOUNTY_COOLDOWN,
        message: "passport holds a live lease on this bounty"
      };
    }
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
    return {
      ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: `sigExpiresAt must be within ${CLAIM_SIG_TTL_MS()}ms`
    };
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
    return {
      ok: false, status: 403, code: ErrorCodes.WRONG_SIGNER,
      message: "payout wallet signature verification failed"
    };
  }

  const claim: BountyClaimRecord = existingClaim ?? {
    id: claimKey(req.bountyId, bounty.jobAttempt),
    bountyId: req.bountyId,
    jobAttempt: bounty.jobAttempt,
    passportId: req.passportId,
    payoutWallet: req.payoutWallet.toLowerCase(),
    state: "open",
    claimedAtMs: now,
    leaseUntilMs: now + CLAIM_TTL_MS(),
  };
  const claimed: BountyRecord = { ...bounty, status: "claimed" };
  if (!existingClaim) {
    upsertClaim(claim);
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
  }

  // 197-19 e2e: chain leg (lazy createJob + provider bind) lives in
  // sweep-chain.ts — extracted for the 300-line file cap.
  const fin = await finalizeClaimJob(net, claimed, req.payoutWallet, {
    sendTx: deps.sendTx,
    fetchJobId: deps.fetchJobId,
    sendProviderTx: deps.sendProviderTx,
    jobExpiryMs: JOB_EXPIRY_MS(),
    now,
  });
  if (!fin.ok) return fin;
  return {
    ok: true,
    claim,
    bounty: fin.bounty,
    providerTx: fin.providerTx,
    providerBind: fin.providerBind,
    txHash: fin.txHash,
  };
}
