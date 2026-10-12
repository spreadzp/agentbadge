/**
 * SLICE-197-07: bounty lease sweep — core logic (timer lives in
 * services/bounty-lease-sweeper.ts, onchain helpers in sweep-chain.ts).
 *
 * claim.leaseUntil < now && !submitted → reject the old onchain job →
 * reopen the bounty on a NEW job (Q38-A: one job = one attempt,
 * provider=0x0 until claim). Re-claim cap gates reopen.
 *
 * Reject signer is picked by onchain job status (edge case): evaluator
 * rejects Funded/Submitted; client (ops) rejects an Open job — a lease
 * can expire after setBudget but before fund.
 *
 * TG alert per expiry/reopen (Q29); "open without claim > TTL" only
 * alerts (dedupe via meta key per attempt).
 */
import type { Hex } from "viem";
import { logger } from "@agentbadge/passport";

import { sendAsRole, type VenueRole } from "../venue/lifecycle-sign";
import {
  resolveVenueNetwork,
  type OnchainJob,
  type VenueNetwork,
} from "../venue/chain";
import type { PreparedTx } from "../venue/lifecycle";
import { ERC8183_STATUS } from "../../routes/venue-api-helpers";
import { assertBountyTransition } from "./lifecycle";
import { CLAIM_TTL_MS, MAX_JOB_ATTEMPTS } from "./claim";
import {
  createJobTx,
  decodeJobId,
  defaultSweepAlert,
  readJob,
  rejectJobTx,
  rejectRole,
} from "./sweep-chain";
import {
  appendTransition,
  bountyStoreReady,
  getBounty,
  getBountyMeta,
  listBounties,
  listExpiredClaims,
  putOutcome,
  setBountyMeta,
  upsertBounty,
  upsertClaim,
  type BountyClaimRecord,
} from "./store";

// ─── Deps (injectable for tests) ─────────────────────────────────

export interface SweepDeps {
  enabled?: boolean;
  now?: () => number;
  network?: () => VenueNetwork;
  fetchJob?: (jobId: number, net: VenueNetwork) => Promise<OnchainJob | null>;
  sendRole?: (
    role: VenueRole,
    txs: PreparedTx[],
    rpcUrl: string,
  ) => Promise<Hex[] | null>;
  /** Decode JobCreated from a confirmed createJob receipt. */
  fetchJobId?: (
    txHash: `0x${string}`,
    net: VenueNetwork,
  ) => Promise<number | null>;
  alert?: (message: string) => Promise<void>;
}

// ─── Per-claim sweep ─────────────────────────────────────────────

async function sweepClaim(
  claim: BountyClaimRecord,
  net: VenueNetwork,
  deps: Required<Pick<SweepDeps, "now" | "alert">> & SweepDeps,
  errors: string[],
): Promise<boolean> {
  const now = deps.now();
  const bounty = getBounty(claim.bountyId);
  if (!bounty) {
    claim.state = "expired";
    upsertClaim(claim);
    errors.push(`${claim.id}: unknown bountyId`);
    return false;
  }
  // Idempotent: only a "claimed" bounty with this attempt's lease is
  // sweepable. A reopened bounty (status open, jobAttempt bumped) is
  // already handled — just close the claim row.
  if (bounty.status !== "claimed" || bounty.jobAttempt !== claim.jobAttempt) {
    claim.state = "expired";
    upsertClaim(claim);
    return false;
  }

  const jobId = bounty.onchainJobId ? Number(bounty.onchainJobId) : null;
  let rejectTx: `0x${string}` | undefined;
  if (jobId != null) {
    const job = await (deps.fetchJob ?? readJob)(jobId, net);
    const status = job?.status;
    // Only reject an alive job: open(0) / funded(1) / submitted(2).
    if (status !== undefined && [0, 1, 2].includes(status)) {
      const role = rejectRole(status);
      const send = deps.sendRole ?? sendAsRole;
      const hashes = await send(role, rejectJobTx(net, jobId),
        net.chain.rpcUrl);
      rejectTx = hashes?.[0];
      if (!rejectTx) {
        errors.push(`${claim.id}: no ${role} signer — reject skipped`);
      }
    } else {
      logger.info("bounty sweeper: job not alive onchain, skip reject", {
        bountyId: bounty.bountyId,
        status: status !== undefined ? ERC8183_STATUS[status] : "unreadable",
      });
    }
  }

  // Off-chain: claim → expired, outcome timeout, bounty claimed→expired.
  claim.state = "expired";
  upsertClaim(claim);
  putOutcome({
    id: `${bounty.bountyId}:${claim.jobAttempt}`,
    bountyId: bounty.bountyId,
    jobAttempt: claim.jobAttempt,
    passportId: claim.passportId,
    verdict: "timeout",
    reasonCodes: ["lease_expired"],
  });
  appendTransition({
    id: `${bounty.bountyId}:${claim.jobAttempt}:expire:${now}`,
    bountyId: bounty.bountyId,
    actor: "sweeper",
    from: "claimed",
    to: "expired",
    atMs: now,
    payload: { rejectTx, leaseUntilMs: claim.leaseUntilMs },
  });

  // Reopen on a new job — gated by the re-claim cap (Q38-A).
  const attemptsLeft = MAX_JOB_ATTEMPTS() - claim.jobAttempt;
  const reopen = assertBountyTransition("expired", "reopen", attemptsLeft);
  if (!reopen.ok) {
    upsertBounty({ ...bounty, status: "expired" });
    await deps.alert(
      `Bounty ${bounty.bountyId} lease expired — cap exhausted, ` +
        `bounty stays expired (attempt ${claim.jobAttempt}/${MAX_JOB_ATTEMPTS()})`,
    );
    return true;
  }

  const nextAttempt = claim.jobAttempt + 1;
  let newJobId: string | undefined;
  const send = deps.sendRole ?? sendAsRole;
  const createHashes = await send(
    "client",
    [createJobTx(net, bounty, CLAIM_TTL_MS())],
    net.chain.rpcUrl,
  );
  if (createHashes?.[0]) {
    const id = await (deps.fetchJobId ?? decodeJobId)(createHashes[0], net);
    newJobId = id != null ? String(id) : undefined;
    if (!newJobId) {
      errors.push(`${claim.id}: JobCreated not decoded — jobId attach deferred`);
    }
  }

  upsertBounty({
    ...bounty,
    status: "open",
    jobAttempt: nextAttempt,
    onchainJobId: newJobId,
  });
  appendTransition({
    id: `${bounty.bountyId}:${nextAttempt}:reopen:${now}`,
    bountyId: bounty.bountyId,
    actor: "system",
    from: "expired",
    to: "open",
    atMs: now,
    payload: { onchainJobId: newJobId, createTx: createHashes?.[0] },
  });
  await deps.alert(
    `Bounty ${bounty.bountyId} lease expired — job ${jobId ?? "?"} ` +
      `rejected${rejectTx ? ` (${rejectTx.slice(0, 10)}…)` : ""}, ` +
      `reopened on attempt ${nextAttempt}/${MAX_JOB_ATTEMPTS()}`,
  );
  return true;
}

// ─── Sweep ───────────────────────────────────────────────────────

export interface BountySweepResult {
  expired: number;
  reopened: number;
  noClaimAlerts: number;
  skipped?: boolean;
  errors: string[];
}

export async function sweepBountyLeases(
  deps: SweepDeps = {},
): Promise<BountySweepResult> {
  const enabled =
    deps.enabled ?? process.env.BOUNTY_SWEEPER_ENABLED !== "false";
  if (!enabled) {
    return { expired: 0, reopened: 0, noClaimAlerts: 0,
      skipped: true, errors: [] };
  }
  await bountyStoreReady();
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = deps.now ?? Date.now;
  const alert = deps.alert ?? defaultSweepAlert;
  const res: BountySweepResult = {
    expired: 0, reopened: 0, noClaimAlerts: 0, errors: [],
  };

  for (const claim of listExpiredClaims(now())) {
    try {
      const did = await sweepClaim(claim, net, { now, alert, ...deps },
        res.errors);
      if (did) {
        res.expired++;
        if (getBounty(claim.bountyId)?.status === "open") res.reopened++;
      }
    } catch (err) {
      res.errors.push(`${claim.id}: ${String(err).slice(0, 120)}`);
    }
  }

  // "open without claim > TTL" — alert only, once per attempt (Q29).
  const staleMs = CLAIM_TTL_MS();
  for (const b of listBounties({ status: "open" })) {
    if (now() - Date.parse(b.createdAt) <= staleMs) continue;
    const key = `no-claim-alert:${b.bountyId}:${b.jobAttempt}`;
    if (getBountyMeta(key)) continue;
    setBountyMeta(key, { alertedAtMs: now() });
    res.noClaimAlerts++;
    const ageH = Math.round((now() - Date.parse(b.createdAt)) / 3_600_000);
    await alert(
      `Bounty ${b.bountyId} open ${ageH}h without claim ` +
        `(attempt ${b.jobAttempt})`,
    );
  }

  return res;
}
