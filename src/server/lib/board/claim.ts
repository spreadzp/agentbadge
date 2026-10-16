/**
 * SLICE-199-07 (EPIC-199, D-199-1): off-chain board claim — claiming a
 * card performs ZERO chain legs. The payout wallet is bound onchain
 * later by the ops-signer (setProvider + fund in one batch, the 197
 * fund-path), so the claimant never sends a tx and never pays gas.
 *
 * Reuses the 197-06 machinery (claim row, lease TTL, cooldown, re-claim
 * cap) with the board-specific EIP-191 namespace from claim-sig.ts.
 *
 * Cache (transient only, D-199-8):
 *   board:claimlock:{cardId} — incr mutex, 30s: a concurrent second
 *     claim short-circuits to 409 before touching the store. With the
 *     cache disabled the flow degrades to the store backstops
 *     (existing claim row / card column), never to a crash.
 *   board:sig:{keccak256(sig)} — replay-set: the exact same signature
 *     twice → 409, regardless of the card it targets.
 *
 * ChainTxOutbox: claim enqueues NOTHING — off-chain by definition.
 */
import { keccak256, toBytes } from "viem";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import { tryGetCache } from "../cache";
import { resolveVenueNetwork } from "../venue/chain";
import { assertBountyTransition } from "../bounties/lifecycle";
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
} from "../bounties/store";
import { boardStore } from "./store";
import { assertColumnTransition } from "./columns";
import { newEntryId, type BoardCardRecord } from "./types";
import {
  boardClaimMessage,
  BOARD_CLAIM_SIG_TTL_MS,
  BOARD_CLAIM_TTL_MS,
  BOARD_MAX_ATTEMPTS,
  CLAIMLOCK_TTL_SEC,
  defaultVerifyPayoutSig,
  type BoardClaimDeps,
} from "./claim-sig";

export {
  boardClaimMessage,
  BOARD_CLAIM_SIG_TTL_MS,
  BOARD_CLAIM_TTL_MS,
  BOARD_MAX_ATTEMPTS,
  type BoardClaimDeps,
} from "./claim-sig";

// ─── Claim ─────────────────────────────────────────────────────

export interface BoardClaimRequest {
  cardId: string;
  /** Passport id of the claiming agent (from agentKeyAuth). */
  passportId: string;
  payoutWallet: `0x${string}`;
  /** EIP-191 signature over boardClaimMessage(...). */
  claimSig: string;
  /** Client-declared signature expiry (ms); bounded by the TTL. */
  sigExpiresAt?: number;
}

export type BoardClaimResult =
  | {
    ok: true;
    claim: BountyClaimRecord;
    card: BoardCardRecord;
    /** Always "deferred" — provider binds at ops fund-time. */
    providerBind: "deferred";
  }
  | { ok: false; status: number; code: ErrorCode; message: string };

function fail(
  status: number,
  code: ErrorCode,
  message: string,
): BoardClaimResult {
  return { ok: false, status, code, message };
}

export async function claimBoardCard(
  req: BoardClaimRequest,
  deps: BoardClaimDeps = {},
): Promise<BoardClaimResult> {
  // Passport gate (agentKeyAuth should already block this — defense in
  // depth at the lib boundary).
  if (!req.passportId) {
    return fail(403, ErrorCodes.INVALID_INPUT, "passport required");
  }

  await bountyStoreReady();
  const st = boardStore();
  await st.ready();
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = (deps.now ?? Date.now)();
  const cache = deps.cache === null ? null : (deps.cache ?? tryGetCache());

  // Claimlock: concurrent claims on the same card race to 409 before
  // touching the store; the unique claim row is the correctness
  // backstop when the cache is off.
  const lockKey = `board:claimlock:${req.cardId}`;
  if (cache) {
    const n = await cache.incr(lockKey, CLAIMLOCK_TTL_SEC).catch(() => 0);
    if (n > 1) {
      return fail(
        409,
        ErrorCodes.BOUNTY_ALREADY_CLAIMED,
        "claim already in flight for this card",
      );
    }
  }

  const card = st.getCard(req.cardId);
  if (!card) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "unknown cardId");
  }

  // Column gate via the state machine (actor kind agent, todo only).
  const col = assertColumnTransition({
    column: card.column,
    action: "claim",
    actor: { kind: "agent", passportId: req.passportId },
  });
  if (!col.ok) {
    return fail(409, ErrorCodes.INVALID_STATE, col.reason ?? "cannot claim");
  }

  const bounty = getBounty(card.bountyId);
  if (!bounty) {
    return fail(404, ErrorCodes.RESOURCE_NOT_FOUND, "card bounty missing");
  }
  const lc = assertBountyTransition(bounty.status, "claim");
  if (!lc.ok) {
    return fail(409, ErrorCodes.INVALID_STATE, lc.reason ?? "cannot claim");
  }
  if (bounty.jobAttempt > BOARD_MAX_ATTEMPTS()) {
    return fail(
      409,
      ErrorCodes.BOUNTY_CAP_REACHED,
      `attempt cap exhausted (${BOARD_MAX_ATTEMPTS()} jobs)`,
    );
  }

  // Signature freshness window.
  const expiresAt = req.sigExpiresAt;
  if (
    typeof expiresAt !== "number" ||
    !Number.isFinite(expiresAt) ||
    expiresAt <= now ||
    expiresAt - now > BOARD_CLAIM_SIG_TTL_MS()
  ) {
    return fail(
      400,
      ErrorCodes.INVALID_INPUT,
      `sigExpiresAt must be within ${BOARD_CLAIM_SIG_TTL_MS()}ms`,
    );
  }

  // Replay-set: the identical signature bytes twice → 409.
  const sigHash = keccak256(toBytes(req.claimSig));
  const replayKey = `board:sig:${sigHash}`;
  if (cache) {
    const seen = await cache.get<string>(replayKey).catch(() => null);
    if (seen !== null) {
      return fail(
        409,
        ErrorCodes.BOUNTY_ALREADY_CLAIMED,
        "signature already used",
      );
    }
  }

  const verify =
    deps.verifyPayoutSig ??
    ((w, m, s) => defaultVerifyPayoutSig(net, w, m, s));
  const sigOk = await verify(
    req.payoutWallet,
    boardClaimMessage(
      net.chain.chainId,
      card.cardId,
      bounty.jobAttempt,
      req.payoutWallet,
      expiresAt,
    ),
    req.claimSig,
  );
  if (!sigOk) {
    return fail(
      403,
      ErrorCodes.WRONG_SIGNER,
      "payout wallet signature verification failed",
    );
  }
  // Store backstops: one claim row per attempt + Q28 cooldown.
  const existing = getClaim(bounty.bountyId, bounty.jobAttempt);
  if (existing) {
    return fail(
      409,
      ErrorCodes.BOUNTY_ALREADY_CLAIMED,
      "bounty already claimed for this attempt",
    );
  }
  const live = listClaimsByPassport(req.passportId).find(
    (c) =>
      c.bountyId === bounty.bountyId &&
      c.state === "open" &&
      c.leaseUntilMs > now,
  );
  if (live) {
    return fail(
      409,
      ErrorCodes.BOUNTY_COOLDOWN,
      "passport holds a live lease on this bounty",
    );
  }

  // ─── writes (all off-chain) ──────────────────────────────────
  // Re-check synchronously: a concurrent claim could have landed during
  // the awaited sig verify above (audit C-2). Single-thread re-check with
  // no await between it and upsertClaim closes the interleaving window.
  if (getClaim(bounty.bountyId, bounty.jobAttempt)) {
    return fail(
      409,
      ErrorCodes.BOUNTY_ALREADY_CLAIMED,
      "bounty already claimed for this attempt",
    );
  }
  const claim: BountyClaimRecord = {
    id: claimKey(bounty.bountyId, bounty.jobAttempt),
    bountyId: bounty.bountyId,
    jobAttempt: bounty.jobAttempt,
    passportId: req.passportId,
    payoutWallet: req.payoutWallet.toLowerCase(),
    state: "open",
    claimedAtMs: now,
    leaseUntilMs: now + BOARD_CLAIM_TTL_MS(),
  };
  upsertClaim(claim);
  upsertBounty({ ...bounty, status: "claimed" });
  appendTransition({
    id: `${bounty.bountyId}:${bounty.jobAttempt}:claim:${now}`,
    bountyId: bounty.bountyId,
    actor: req.passportId,
    from: "open",
    to: "claimed",
    atMs: now,
    payload: { payoutWallet: req.payoutWallet.toLowerCase() },
  });
  const patched = st.patchCard(card.cardId, {
    column: "in_progress",
    currentPassportId: req.passportId,
  });
  st.appendEntry({
    id: newEntryId(),
    cardId: card.cardId,
    attempt: bounty.jobAttempt,
    seq: st.nextEntrySeq(card.cardId),
    kind: "claim",
    actor: req.passportId,
    atMs: now,
    payload: {
      payoutWallet: req.payoutWallet.toLowerCase(),
      sigHash,
      providerBind: "deferred",
    },
  });

  // Replay-set AFTER the store writes (audit H-5): on failure the sig
  // stays usable for a retry instead of being burned for its TTL.
  // Second concurrent claims are stopped by the claim-row re-check above.
  if (cache) {
    await cache
      .set(replayKey, req.cardId, {
        ttlSec: Math.ceil(BOARD_CLAIM_SIG_TTL_MS() / 1000),
        tags: ["board", "sig"],
      })
      .catch(() => undefined);
  }

  return {
    ok: true,
    claim,
    card: patched ?? card,
    providerBind: "deferred",
  };
}
