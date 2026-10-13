/**
 * SLICE-197-10: verdict memo-anchor (EPIC-172 pattern).
 *
 * Anchor = memo tx carrying
 *   {bountyId, jobId, verdict, commitSha, reason_codes, runnerLogHash}
 * emitted by the Arc Memo contract — FAIL is anchored exactly like
 * PASS (the negative is a provable fact too).
 *
 * Q37-A: FAIL is the terminal evaluator reject — the anchor is sent
 * BEFORE the reject-tx and the onchain reason field carries the
 * deterministic memoId, so anyone can resolve the Memo event by its
 * indexed memoId and verify the verdict. PASS: anchor → complete with
 * the same reason=memoId pointer.
 *
 * Idempotent: an outcome that already has verdictMemoTx is never
 * re-anchored (repeat QA never duplicates tx).
 */
import {
  encodeFunctionData,
  keccak256,
  parseUnits,
  toBytes,
  type Hex,
} from "viem";
import { MEMO_ABI } from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";

import {
  getClaim,
  getOutcome,
  listBounties,
  patchOutcome,
  type BountyOutcomeRecord,
  type BountyRecord,
} from "./store";
import { buildActionTxs, type PreparedTx } from "../venue/lifecycle";
import { sendAsRole } from "../venue/lifecycle-sign";
import {
  fetchOnchainJob,
  resolveVenueNetwork,
  type OnchainJob,
  type VenueNetwork,
} from "../venue/chain";

export {
  encodeVerdictMemo,
  verdictMemoId,
} from "./anchor-memo";
import {
  encodeVerdictMemo,
  NAME_ABI,
  verdictMemoId,
} from "./anchor-memo";

export interface AnchorDeps {
  network?: () => VenueNetwork;
  now?: () => number;
  /** Sender for a PreparedTx batch — default evaluator signer. */
  send?: (txs: PreparedTx[]) => Promise<Hex[] | null>;
  /** Onchain job read for solvency/provider guard (197-12). */
  readJob?: (jobId: bigint, net: VenueNetwork) => Promise<OnchainJob | null>;
  rpcUrl?: string;
  enabled?: boolean;
}

export interface AnchorResult {
  ok: boolean;
  skipped?: boolean;
  memoTxHash?: Hex;
  actionTxHash?: Hex;
  error?: string;
}

/** memo(...) calldata → PreparedTx to the Memo contract. */
function anchorTx(
  net: VenueNetwork,
  memoId: Hex,
  memoData: Hex,
): PreparedTx {
  const inner = encodeFunctionData({
    abi: NAME_ABI,
    functionName: "name",
    args: [],
  });
  return {
    to: net.memo,
    data: encodeFunctionData({
      abi: MEMO_ABI,
      functionName: "memo",
      args: [net.identityRegistry, inner, memoId, memoData],
    }),
    description: "memo anchor: bounty verdict",
  };
}

/**
 * Solvency + provider guard before `complete` (VULN-11 lesson,
 * EPIC-196): never release more than the funded deposit, and only
 * to the bound payout wallet. null = pass; string = abort reason.
 */
export async function solvencyBlock(
  bounty: BountyRecord,
  net: VenueNetwork,
  readJob: (id: bigint, n: VenueNetwork) => Promise<OnchainJob | null>,
): Promise<string | null> {
  if (!bounty.onchainJobId) return null;
  const job = await readJob(BigInt(bounty.onchainJobId), net);
  if (!job) return null; // unreadable chain → let the tx decide
  const deposit = parseUnits(bounty.budgetUsdc || "0", 6);
  if (job.budget > deposit) {
    return `onchain budget ${job.budget} exceeds deposit ${deposit}`;
  }
  const payout = getClaim(bounty.bountyId, bounty.jobAttempt)
    ?.payoutWallet?.toLowerCase();
  if (payout && job.provider.toLowerCase() !== payout) {
    return `onchain provider ${job.provider} != payout ${payout}`;
  }
  return null;
}

/**
 * Anchor a recorded outcome: memo tx → complete|reject(reason=memoId).
 * Idempotent: verdictMemoTx present → memo never re-sent; a missing
 * verdictRejectTx is retried on its own (crash between the two txs).
 */
export async function anchorBountyOutcome(
  bounty: BountyRecord,
  outcome: BountyOutcomeRecord,
  deps: AnchorDeps = {},
): Promise<AnchorResult> {
  if (outcome.verdictMemoTx && outcome.verdictRejectTx) {
    return {
      ok: true,
      skipped: true,
      memoTxHash: outcome.verdictMemoTx as Hex,
      actionTxHash: outcome.verdictRejectTx as Hex,
    };
  }
  const net = (deps.network ?? resolveVenueNetwork)();
  const rpc =
    deps.rpcUrl ??
    (net.chain as { rpcUrls?: { default?: { http?: string[] } } })
      .rpcUrls?.default?.http?.[0] ??
    "";
  const send =
    deps.send ??
    ((txs: PreparedTx[]) => sendAsRole("evaluator", txs, rpc));
  const jobId = BigInt(bounty.onchainJobId ?? "0");
  const memoId = verdictMemoId(
    bounty.bountyId,
    bounty.jobAttempt,
    outcome.commitSha ?? "",
  );

  // 197-12: memo already anchored → retry only the lifecycle tx.
  if (outcome.verdictMemoTx) {
    const actionHash = await sendAction(
      send, net, bounty, outcome, jobId, memoId,
    );
    if (actionHash) {
      patchOutcome(bounty.bountyId, bounty.jobAttempt, {
        verdictRejectTx: actionHash,
      });
    }
    return {
      ok: !!actionHash,
      skipped: true,
      memoTxHash: outcome.verdictMemoTx as Hex,
      actionTxHash: actionHash,
      ...(actionHash ? {} : { error: "action tx send failed" }),
    };
  }

  // 197-12 solvency: release path BLOCKS; 197-16 H-1 — reject path
  // must proceed (refund) but provider mismatch gets a structured warn.
  const readJob =
    deps.readJob ?? ((id, n) => fetchOnchainJob(Number(id), n));
  const solvency = await solvencyBlock(bounty, net, readJob);
  if (outcome.verdict === "pass" && solvency) {
    logger.warn("bounty-anchor: solvency guard blocked release", {
      bountyId: bounty.bountyId,
      reason: solvency,
    });
    return { ok: false, error: `solvency guard: ${solvency}` };
  }
  if (solvency?.includes("provider")) {
    logger.warn("bounty-anchor: provider mismatch on reject path", {
      bountyId: bounty.bountyId,
      reason: solvency,
    });
  }

  const runnerLogHash = keccak256(
    toBytes(JSON.stringify(outcome.payload?.checks ?? [])),
  );
  const memoData = encodeVerdictMemo({
    bountyId: bounty.bountyId,
    jobId,
    verdict: outcome.verdict,
    commitSha: outcome.commitSha ?? "",
    reasonCodes: outcome.reasonCodes ?? [],
    runnerLogHash,
  });

  const memoHash = (await send([anchorTx(net, memoId, memoData)]))?.[0];
  if (!memoHash) {
    return { ok: false, error: "anchor send unavailable/reverted" };
  }

  const actionHash = await sendAction(
    send, net, bounty, outcome, jobId, memoId,
  );

  patchOutcome(bounty.bountyId, bounty.jobAttempt, {
    verdictMemoTx: memoHash,
    verdictRejectTx: actionHash,
    payload: {
      ...outcome.payload,
      memoId,
      explorerTxs: {
        memo: net.explorerTx(memoHash),
        action: actionHash ? net.explorerTx(actionHash) : undefined,
      },
    },
  });
  return { ok: true, memoTxHash: memoHash, actionTxHash: actionHash };
}

/** complete|reject with reason = memoId — verifiable Memo pointer. */
async function sendAction(
  send: (txs: PreparedTx[]) => Promise<Hex[] | null>,
  net: VenueNetwork,
  bounty: BountyRecord,
  outcome: BountyOutcomeRecord,
  jobId: bigint,
  memoId: Hex,
): Promise<Hex | undefined> {
  if (!bounty.onchainJobId) return undefined;
  const action = outcome.verdict === "pass" ? "complete" : "reject";
  const txs = buildActionTxs(net, action, {
    onchainJobId: jobId,
    reason: memoId,
  });
  const hash = (await send(txs))?.[0];
  if (!hash) {
    logger.warn("bounty-anchor: lifecycle tx failed after anchor", {
      bountyId: bounty.bountyId,
    });
  }
  return hash;
}

export interface AnchorSweepResult {
  anchored: number;
  skipped: number;
  disabled?: boolean;
  errors: string[];
}

/** Anchor every recorded-but-unanchored outcome (passed|failed). */
export async function anchorSweep(
  deps: AnchorDeps = {},
): Promise<AnchorSweepResult> {
  const enabled =
    deps.enabled ?? process.env.BOUNTY_QA_RUNNER_ENABLED === "true";
  if (!enabled) {
    return { anchored: 0, skipped: 0, disabled: true, errors: [] };
  }
  const res: AnchorSweepResult = {
    anchored: 0,
    skipped: 0,
    errors: [],
  };
  const pending = [
    ...listBounties({ status: "passed" }),
    ...listBounties({ status: "failed" }),
  ];
  for (const b of pending) {
    const outcome = getOutcome(b.bountyId, b.jobAttempt);
    // Fully anchored = memo + action tx. A memo-only outcome is a
    // crash-window retry; no jobId → memo alone is final.
    const done =
      outcome?.verdictMemoTx &&
      (outcome.verdictRejectTx || !b.onchainJobId);
    if (!outcome || done) continue;
    try {
      const r = await anchorBountyOutcome(b, outcome, deps);
      if (r.ok) res.anchored++;
      else res.errors.push(`${b.bountyId}: ${r.error}`);
    } catch (err) {
      res.errors.push(`${b.bountyId}: ${String(err).slice(0, 120)}`);
    }
  }
  return res;
}
