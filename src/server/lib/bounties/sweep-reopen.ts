/**
 * SLICE-197-07/197-19: shared bounty reopen — extracted from sweep.ts
 * for the 300-line file cap. Reopen on a NEW job after an expired
 * lease reject or an anchored QA fail (Q38-A: one job = one attempt,
 * re-claim cap gates reopen). On the circle variant the job is NOT
 * sent here — its createJob requires provider != 0x0, so the next
 * claim creates it lazily with provider=payoutWallet.
 */
import type { Hex } from "viem";

import { sendAsRole, type VenueRole } from "../venue/lifecycle-sign";
import type { VenueNetwork } from "../venue/chain";
import type { PreparedTx } from "../venue/lifecycle";
import { assertBountyTransition } from "./lifecycle";
import { JOB_EXPIRY_MS, MAX_JOB_ATTEMPTS } from "./claim";
import { createJobTx, decodeJobId } from "./sweep-chain";
import {
  appendTransition,
  upsertBounty,
  type BountyRecord,
} from "./store";

/** Narrow deps needed by reopenBountyAttempt (subset of SweepDeps). */
export interface ReopenDeps {
  now: () => number;
  alert: (message: string) => Promise<void>;
  sendRole?: (
    role: VenueRole,
    txs: PreparedTx[],
    rpcUrl: string,
  ) => Promise<Hex[] | null>;
  fetchJobId?: (
    txHash: `0x${string}`,
    net: VenueNetwork,
  ) => Promise<number | null>;
}

/** Shared reopen: cap check → createJob → bounty open on next attempt. */
export async function reopenBountyAttempt(
  bounty: BountyRecord,
  from: "expired" | "failed",
  jobAttempt: number,
  net: VenueNetwork,
  deps: ReopenDeps,
  errors: string[],
  reason: string,
  errTag: string,
): Promise<boolean> {
  const now = deps.now();
  const attemptsLeft = MAX_JOB_ATTEMPTS() - jobAttempt;
  const reopen = assertBountyTransition(from, "reopen", attemptsLeft);
  if (!reopen.ok) {
    upsertBounty({ ...bounty, status: from });
    await deps.alert(
      `Bounty ${bounty.bountyId} ${reason} — cap exhausted, ` +
      `bounty stays ${from} (attempt ${jobAttempt}/${MAX_JOB_ATTEMPTS()})`,
    );
    return true;
  }

  const nextAttempt = jobAttempt + 1;
  let newJobId: string | undefined;
  // 197-19 e2e: circle's createJob requires provider != 0x0 — the job is
  // created lazily on the next claim (provider=payoutWallet), so skip
  // the send here. acp binds provider later via setProvider — eager job.
  const createHashes = net.variant === "circle"
    ? null
    : await (deps.sendRole ?? sendAsRole)(
      "client",
      [createJobTx(net, bounty, JOB_EXPIRY_MS(), now)],
      net.chain.rpcUrl,
    );
  if (createHashes?.[0]) {
    const id = await (deps.fetchJobId ?? decodeJobId)(createHashes[0], net);
    newJobId = id != null ? String(id) : undefined;
    if (!newJobId) {
      errors.push(`${errTag}: JobCreated not decoded — jobId attach deferred`);
    }
  }

  upsertBounty({
    ...bounty,
    status: "open",
    jobAttempt: nextAttempt,
    onchainJobId: newJobId,
    // attempt-scoped: a stale chainTxs.funded/created would make fund/claim
    // idempotent-short-circuit on the NEW job. Old hashes stay in
    // transitions + outcomes (verdictMemoTx/verdictRejectTx, createTx).
    chainTxs: {},
  });
  appendTransition({
    id: `${bounty.bountyId}:${nextAttempt}:reopen:${now}`,
    bountyId: bounty.bountyId,
    actor: "system",
    from,
    to: "open",
    atMs: now,
    payload: { onchainJobId: newJobId, createTx: createHashes?.[0] },
  });
  await deps.alert(
    `Bounty ${bounty.bountyId} ${reason}, ` +
    `reopened on attempt ${nextAttempt}/${MAX_JOB_ATTEMPTS()}`,
  );
  return true;
}
