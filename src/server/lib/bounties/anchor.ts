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
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  toBytes,
  type Hex,
} from "viem";
import { MEMO_ABI, memoIdFor } from "@agentbadge/circle-payments";
import { logger } from "@agentbadge/passport";

import {
  getOutcome,
  listBounties,
  patchOutcome,
  type BountyOutcomeRecord,
  type BountyRecord,
} from "./store";
import { buildActionTxs, type PreparedTx } from "../venue/lifecycle";
import { sendAsRole } from "../venue/lifecycle-sign";
import { resolveVenueNetwork, type VenueNetwork } from "../venue/chain";

/** Minimal ERC-721 name() — the wrapped no-op target call. */
const NAME_ABI = [
  {
    type: "function",
    name: "name",
    stateMutability: "view",
    inputs: [],
    outputs: [{ name: "", type: "string" }],
  },
] as const;

/** Deterministic memoId — indexed in the Memo event; IS the pointer. */
export function verdictMemoId(
  bountyId: string,
  jobAttempt: number,
  commitSha: string,
): Hex {
  return memoIdFor(
    "agentbadge",
    "bounty-verdict",
    bountyId,
    BigInt(jobAttempt),
    commitSha,
  );
}

/** ABI-encoded verdict fields carried in the Memo event. */
export function encodeVerdictMemo(f: {
  bountyId: string;
  jobId: bigint;
  verdict: string;
  commitSha: string;
  reasonCodes: string[];
  runnerLogHash: Hex;
}): Hex {
  return encodeAbiParameters(
    [
      { name: "bountyId", type: "string" },
      { name: "jobId", type: "uint256" },
      { name: "verdict", type: "string" },
      { name: "commitSha", type: "string" },
      { name: "reasonCodes", type: "string" },
      { name: "runnerLogHash", type: "bytes32" },
    ],
    [
      f.bountyId,
      f.jobId,
      f.verdict,
      f.commitSha,
      f.reasonCodes.join(","),
      f.runnerLogHash,
    ],
  );
}

export interface AnchorDeps {
  network?: () => VenueNetwork;
  now?: () => number;
  /** Sender for a PreparedTx batch — default evaluator signer. */
  send?: (txs: PreparedTx[]) => Promise<Hex[] | null>;
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
 * Anchor a recorded outcome: memo tx → complete|reject(reason=memoId).
 * Returns existing hashes when already anchored.
 */
export async function anchorBountyOutcome(
  bounty: BountyRecord,
  outcome: BountyOutcomeRecord,
  deps: AnchorDeps = {},
): Promise<AnchorResult> {
  if (outcome.verdictMemoTx) {
    return {
      ok: true,
      skipped: true,
      memoTxHash: outcome.verdictMemoTx as Hex,
      actionTxHash: outcome.verdictRejectTx as Hex | undefined,
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
  const runnerLogHash = keccak256(
    toBytes(JSON.stringify(outcome.payload?.checks ?? [])),
  );
  const memoId = verdictMemoId(
    bounty.bountyId,
    bounty.jobAttempt,
    outcome.commitSha ?? "",
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

  // Lifecycle tx — reason = memoId (verifiable pointer to the Memo
  // event; indexed field, resolvable by any third party).
  let actionHash: Hex | undefined;
  if (bounty.onchainJobId) {
    const action = outcome.verdict === "pass" ? "complete" : "reject";
    const txs = buildActionTxs(net, action, {
      onchainJobId: jobId,
      reason: memoId,
    });
    actionHash = (await send(txs))?.[0];
    if (!actionHash) {
      logger.warn("bounty-anchor: lifecycle tx failed after anchor", {
        bountyId: bounty.bountyId,
        memoTxHash: memoHash,
      });
    }
  }

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
    if (!outcome || outcome.verdictMemoTx) continue;
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
