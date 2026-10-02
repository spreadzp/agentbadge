/**
 * SLICE-154-3: settlement-side helpers for external job evaluation —
 * gas-cap WriteClient decorator + ERC-8004 giveFeedback composer.
 * Extracted from eval.ts (max-lines).
 */

import { encodeFunctionData, keccak256, toBytes, toHex } from "viem";
import type { Hex } from "viem";
import {
  ERC8004_ABI,
  MEMO_ABI,
  memoIdFor,
  type WriteClient,
} from "@agentbadge/circle-payments";

/* ------------------------------- gas cap --------------------------------- */

export class GasCapError extends Error {
  constructor(
    readonly estimated: bigint,
    readonly cap: bigint,
  ) {
    super(`estimated gas ${estimated} exceeds cap ${cap}`);
    this.name = "GasCapError";
  }
}

export type EstimateGasFn = (args: {
  address: `0x${string}`;
  abi: unknown;
  functionName: string;
  args: readonly unknown[];
  account: `0x${string}`;
}) => Promise<bigint>;

/**
 * WriteClient decorator — estimates gas before every write and aborts
 * over the cap. Settlement is the expensive step; refusing early keeps
 * a registered-but-malicious contract from draining evaluator funds.
 */
export function gasCappedWallet(
  wallet: WriteClient,
  account: `0x${string}`,
  estimate: EstimateGasFn,
  cap: bigint,
): WriteClient {
  return {
    async writeContract(call) {
      const est = await estimate({ ...call, account });
      if (est > cap) throw new GasCapError(est, cap);
      return wallet.writeContract(call);
    },
  };
}

/* --------------------------- reputation feedback -------------------------- */

/**
 * memo(reputationRegistry, giveFeedback(...), memoId, ctx) — one tx,
 * tag1="eaas-eval" so the channel stays separable in reputation queries.
 */
export function buildEaasFeedbackTx(args: {
  memo: `0x${string}`;
  registry: `0x${string}`;
  agentId: bigint;
  verdict: "approve" | "reject";
  reason: string;
  jobId: string;
  contract: `0x${string}`;
  txHash?: Hex;
}): { to: `0x${string}`; data: Hex } {
  const payload = {
    schema: "agentbadge.eaas-eval.v1",
    contract: args.contract,
    jobId: args.jobId,
    verdict: args.verdict,
    reason: args.reason,
    settleTx: args.txHash ?? null,
  };
  const feedbackURI = `data:application/json;base64,${Buffer.from(
    JSON.stringify(payload),
  ).toString("base64")}`;
  const data = encodeFunctionData({
    abi: ERC8004_ABI,
    functionName: "giveFeedback",
    args: [
      args.agentId,
      args.verdict === "approve" ? 1n : -1n,
      0,
      "eaas-eval",
      "erc8183",
      `/api/eaas/jobs/${args.jobId}`,
      feedbackURI,
      keccak256(toBytes(JSON.stringify(payload))),
    ],
  } as never);
  return {
    to: args.memo,
    data: encodeFunctionData({
      abi: MEMO_ABI,
      functionName: "memo",
      args: [
        args.registry,
        data,
        memoIdFor("eaas-eval", args.contract, args.jobId),
        toHex(JSON.stringify({ kind: "eaas-eval", jobId: args.jobId })),
      ],
    } as never),
  };
}
