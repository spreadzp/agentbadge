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
import { CLAIM_TTL_MS } from "./claim";
import {
  defaultSweepAlert,
  readJob,
  rejectJobTx,
  rejectRole,
} from "./sweep-chain";
import { reopenBountyAttempt } from "./sweep-reopen";
import {
  appendTransition,
  bountyStoreReady,
  getBounty,
  getBountyMeta,
  getOutcome,
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
  let rejectFailed = false; // 197-17 M-3
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
        // 197-17 M-3: alive onchain job without a reject — opening a
        // fresh job would leave the old escrow locked, double-funding.
        rejectFailed = true;
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

  // 197-17 M-3: never reopen while the prior job reject is
  // unconfirmed — alert ops and keep the bounty expired instead.
  if (rejectFailed) {
    upsertBounty({ ...bounty, status: "expired" });
    await deps.alert(
      `Bounty ${bounty.bountyId} lease expired but onchain reject ` +
      `failed for job ${jobId} — reopen blocked, needs manual ` +
      `resolution (escrow may still be locked)`,
    );
    return true;
  }

  // Reopen on a new job — gated by the re-claim cap (Q38-A).
  return reopenBountyAttempt(bounty, "expired", claim.jobAttempt, net,
    deps, errors,
    `lease expired — job ${jobId ?? "?"} ` +
    `rejected${rejectTx ? ` (${rejectTx.slice(0, 10)}…)` : ""}`,
    `${claim.id}`);
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
    return {
      expired: 0, reopened: 0, noClaimAlerts: 0,
      skipped: true, errors: []
    };
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

  // 197-19 run-2 (Q38-A): a QA-failed attempt is attempt-terminal too —
  // once the anchor reject tx is recorded, reopen on a fresh job so the
  // fix → submit → PASS path runs. M-3 guard: no reopen without the
  // reject tx hash (old escrow may still be locked).
  for (const b of listBounties({ status: "failed" })) {
    const outcome = getOutcome(b.bountyId, b.jobAttempt);
    if (!outcome || outcome.verdict !== "fail") continue;
    if (!outcome.verdictRejectTx) continue; // reject not anchored yet
    try {
      const did = await reopenBountyAttempt(b, "failed", b.jobAttempt,
        net, { now, alert, ...deps }, res.errors,
        `QA verdict fail — job ${b.onchainJobId ?? "?"} rejected`,
        b.bountyId);
      if (did) res.reopened++;
    } catch (err) {
      res.errors.push(`${b.bountyId}: ${String(err).slice(0, 120)}`);
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
