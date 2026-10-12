/**
 * SLICE-197-10: verdict memo encoding — deterministic memoId +
 * ABI-encoded verdict fields. Kept separate from anchor.ts to
 * satisfy the 300-line file cap.
 */
import { encodeAbiParameters, type Hex } from "viem";
import { memoIdFor } from "@agentbadge/circle-payments";

/** Minimal ERC-721 name() — the wrapped no-op target call. */
export const NAME_ABI = [
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
