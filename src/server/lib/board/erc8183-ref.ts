/**
 * SLICE-199-13 (EPIC-199): ERC-8183 "ref" variant — the vendored deploy
 * (ERC8183_REF_ADDRESS, contracts/erc8183-ref/ERC8183.sol). Its
 * signatures differ from both Circle's testnet deploy ("circle") and
 * the ACP mainnet deploy ("acp"), so lifecycle.ts/buildActionTxs does
 * NOT cover it:
 *
 *   createJob(provider, evaluator, expiredAt, desc, hook, providerAgentId)
 *   setProvider(jobId, provider_, agentId)            — client only
 *   setBudget(jobId, token, amount, optParams)        — provider only
 *   setPayoutReceiver(jobId, payoutReceiver)          — provider only
 *   fund(jobId, expectedToken, expectedBudget, opt)   — client only
 *   submit(jobId, deliverable, optParams)             — provider only
 *   complete(jobId, reason, optParams)                — evaluator only
 *   reject(jobId, reason, optParams)                  — evaluator (Funded/Submitted)
 *                                                       client|provider (Open)
 *   claimRefund(jobId)                                — client only
 *
 * Roles: client = ops EOA, provider = server provider EOA (it signs
 * submit server-side — the agent's payoutWallet goes into
 * payoutReceiver so escrow pays the agent), evaluator = ops/reviewer
 * EOA. Contract enforces client != provider != evaluator.
 */
import {
  decodeEventLog,
  encodeFunctionData,
  parseAbi,
  type Hex,
} from "viem";

import { publicClient, type VenueNetwork } from "../venue/chain";
import type { PreparedTx } from "../venue/lifecycle";

// getJob's tuple return defeats abitype@1.2.3's human-readable parser —
// it ships as a JSON ABI fragment appended to the parsed list.
const REF_GET_JOB_ITEM = {
  type: "function",
  name: "getJob",
  stateMutability: "view",
  inputs: [{ name: "jobId", type: "uint256" }],
  outputs: [
    {
      name: "",
      type: "tuple",
      components: [
        { name: "client", type: "address" },
        { name: "status", type: "uint8" },
        { name: "provider", type: "address" },
        { name: "expiredAt", type: "uint48" },
        { name: "evaluator", type: "address" },
        { name: "submittedAt", type: "uint48" },
        { name: "budget", type: "uint256" },
        { name: "hook", type: "address" },
        { name: "paymentToken", type: "address" },
        { name: "providerAgentId", type: "uint256" },
        { name: "description", type: "string" },
        { name: "settledAmount", type: "uint256" },
        { name: "payoutReceiver", type: "address" },
      ],
    },
  ],
} as const;

export const ERC8183_REF_ABI = [
  ...parseAbi([
    "function createJob(address provider, address evaluator, uint48 expiredAt, string description, address hook, uint256 providerAgentId) returns (uint256)",
    "function setProvider(uint256 jobId, address provider_, uint256 agentId)",
    "function setBudget(uint256 jobId, address token, uint256 amount, bytes optParams)",
    "function setPayoutReceiver(uint256 jobId, address payoutReceiver)",
    "function fund(uint256 jobId, address expectedToken, uint256 expectedBudget, bytes optParams)",
    "function submit(uint256 jobId, bytes32 deliverable, bytes optParams)",
    "function complete(uint256 jobId, bytes32 reason, bytes optParams)",
    "function reject(uint256 jobId, bytes32 reason, bytes optParams)",
    "function claimRefund(uint256 jobId)",
    "event JobCreated(uint256 indexed jobId, address indexed client, address indexed provider, address evaluator, uint48 expiredAt, address hook)",
  ] as const),
  REF_GET_JOB_ITEM,
] as const;

const EMPTY = "0x" as Hex;
export const ZERO_ADDR = "0x0000000000000000000000000000000000000000";

/** JobStatus enum on the ref contract. */
export const REF_STATUS = {
  Open: 0,
  Funded: 1,
  Submitted: 2,
  Completed: 3,
  Rejected: 4,
  Expired: 5,
} as const;

export interface RefJob {
  client: `0x${string}`;
  status: number;
  provider: `0x${string}`;
  expiredAt: bigint;
  evaluator: `0x${string}`;
  submittedAt: bigint;
  budget: bigint;
  hook: `0x${string}`;
  paymentToken: `0x${string}`;
  providerAgentId: bigint;
  description: string;
  settledAmount: bigint;
  payoutReceiver: `0x${string}`;
}

export function isRefVenue(net: VenueNetwork): boolean {
  const ref = process.env.ERC8183_REF_ADDRESS?.toLowerCase();
  return !!ref && ref === net.agenticCommerce.toLowerCase();
}

const enc = (functionName: string, args: unknown[]): Hex =>
  encodeFunctionData({
    abi: ERC8183_REF_ABI,
    functionName,
    args,
  } as never);

export function refCreateJobTx(
  net: VenueNetwork,
  args: {
    provider: `0x${string}`; // 0x0 = deferred bind via setProvider
    evaluator: `0x${string}`;
    expiredAtSec: bigint;
    description: string;
    providerAgentId?: bigint;
  },
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("createJob", [
      args.provider,
      args.evaluator,
      args.expiredAtSec,
      args.description,
      ZERO_ADDR,
      args.providerAgentId ?? 0n,
    ]),
    description: `ref createJob(eval=${args.evaluator}) — board card`,
  };
}

export function refSetProviderTx(
  net: VenueNetwork,
  jobId: bigint,
  provider: `0x${string}`,
  agentId: bigint,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("setProvider", [jobId, provider, agentId]),
    description: `ref setProvider(${jobId}, ${provider}, agent=${agentId})`,
  };
}

export function refSetPayoutReceiverTx(
  net: VenueNetwork,
  jobId: bigint,
  receiver: `0x${string}`,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("setPayoutReceiver", [jobId, receiver]),
    description: `ref setPayoutReceiver(${jobId}, ${receiver})`,
  };
}

export function refSetBudgetTx(
  net: VenueNetwork,
  jobId: bigint,
  token: `0x${string}`,
  amount: bigint,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("setBudget", [jobId, token, amount, EMPTY]),
    description: `ref setBudget(${jobId}, ${token}, ${amount})`,
  };
}

export function refApproveFundTxs(
  net: VenueNetwork,
  jobId: bigint,
  token: `0x${string}`,
  amount: bigint,
): PreparedTx[] {
  return [
    {
      to: token,
      data: encodeFunctionData({
        abi: parseAbi([
          "function approve(address spender, uint256 amount) returns (bool)",
        ] as const),
        functionName: "approve",
        args: [net.agenticCommerce, amount],
      }),
      description: `USDC approve(${net.agenticCommerce}, ${amount})`,
    },
    {
      to: net.agenticCommerce,
      data: enc("fund", [jobId, token, amount, EMPTY]),
      description: `ref fund(${jobId}, token=${token}, budget=${amount})`,
    },
  ];
}

export function refSubmitTx(
  net: VenueNetwork,
  jobId: bigint,
  deliverable: Hex,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("submit", [jobId, deliverable, EMPTY]),
    description: `ref submit(${jobId})`,
  };
}

export function refCompleteTx(
  net: VenueNetwork,
  jobId: bigint,
  reason: Hex,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("complete", [jobId, reason, EMPTY]),
    description: `ref complete(${jobId})`,
  };
}

export function refRejectTx(
  net: VenueNetwork,
  jobId: bigint,
  reason: Hex,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("reject", [jobId, reason, EMPTY]),
    description: `ref reject(${jobId})`,
  };
}

export function refClaimRefundTx(
  net: VenueNetwork,
  jobId: bigint,
): PreparedTx {
  return {
    to: net.agenticCommerce,
    data: enc("claimRefund", [jobId]),
    description: `ref claimRefund(${jobId})`,
  };
}

/** Onchain job read — ref struct, used for idempotent pre-flight. */
export async function readRefJob(
  jobId: bigint,
  net: VenueNetwork,
): Promise<RefJob | null> {
  try {
    return (await publicClient(net).readContract({
      address: net.agenticCommerce,
      abi: ERC8183_REF_ABI,
      functionName: "getJob",
      args: [jobId],
    } as never)) as RefJob;
  } catch {
    return null;
  }
}

/** Decode jobId from a createJob receipt — JobCreated topic[1]. */
export async function decodeRefJobId(
  txHash: Hex,
  net: VenueNetwork,
): Promise<bigint | null> {
  try {
    const receipt = await publicClient(net).getTransactionReceipt({
      hash: txHash,
    });
    for (const log of receipt.logs) {
      try {
        const ev = decodeEventLog({
          abi: ERC8183_REF_ABI,
          data: log.data,
          topics: log.topics as [`0x${string}`, ...`0x${string}`[]],
        });
        if (ev.eventName === "JobCreated") {
          return (ev.args as unknown as { jobId: bigint }).jobId;
        }
      } catch {
        continue;
      }
    }
    return null;
  } catch {
    return null;
  }
}
