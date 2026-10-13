/**
 * SLICE-197-07: onchain helpers for the bounty lease sweeper —
 * kept separate from sweep.ts to satisfy the 300-line file cap.
 */
import { encodeFunctionData, keccak256, toBytes, type Hex } from "viem";
import { logger } from "@agentbadge/passport";

import { sendTelegramMessage } from "../../services/contact.service";
import { sendAsRole, type VenueRole } from "../venue/lifecycle-sign";
import {
  fetchOnchainJob,
  fetchCreatedJobId,
  type OnchainJob,
  type VenueNetwork,
} from "../venue/chain";
import { buildActionTxs, type PreparedTx } from "../venue/lifecycle";
import type { BountyRecord } from "./types";

const ZERO_ADDR = "0x0000000000000000000000000000000000000000";
/**
 * Reject reason. Circle ABI declares `reason: bytes32` (acp: `bytes`)
 * — a 32-byte hash encodes cleanly for both, `0x` does not.
 */
export const REJECT_REASON = keccak256(toBytes("bounty_lease_expired"));

export async function defaultSweepAlert(message: string): Promise<void> {
  if (!process.env.TELEGRAM_BOT_TOKEN || !process.env.TELEGRAM_CHAT_ID) {
    return;
  }
  await sendTelegramMessage({ message }).catch((err) => {
    logger.warn("bounty sweeper: telegram alert failed", {
      err: String(err).slice(0, 200),
    });
  });
}

/** reject role by onchain status: open → client (ops), else evaluator. */
export function rejectRole(status: number): VenueRole {
  return status === 0 ? "client" : "evaluator";
}

/** Read onchain job; swallows RPC errors → null. */
export async function readJob(
  jobId: number,
  net: VenueNetwork,
): Promise<OnchainJob | null> {
  return fetchOnchainJob(jobId, net).catch(() => null);
}

export async function decodeJobId(
  txHash: `0x${string}`,
  net: VenueNetwork,
): Promise<number | null> {
  return fetchCreatedJobId(txHash, net).catch(() => null);
}

/** reject(jobId, reason, 0x) for the expiring attempt's job. */
export function rejectJobTx(net: VenueNetwork, jobId: number): PreparedTx[] {
  return buildActionTxs(net, "reject", {
    onchainJobId: BigInt(jobId),
    reason: REJECT_REASON,
  });
}

/** Send a prepared tx set as `role`; null on send failure. */
export async function sendRoleTxs(
  role: VenueRole,
  txs: PreparedTx[],
  net: VenueNetwork,
): Promise<Hex[] | null> {
  return sendAsRole(role, txs, net.chain.rpcUrl).catch(() => null);
}

/**
 * createJob(provider=0x0, evaluator, expiredAt, desc, hook=0x0) for the
 * new attempt. Evaluator falls back to zero when unset — contract
 * accepts 0x0 as "evaluator = client" on the circle variant.
 */
export function createJobTx(
  net: VenueNetwork,
  bounty: BountyRecord,
  leaseTtlMs: number,
  nowMs: number = Date.now(), // 197-17 M-8
): PreparedTx {
  const expiredAt = BigInt(Math.floor((nowMs + leaseTtlMs) / 1000));
  return {
    to: net.agenticCommerce,
    data: encodeFunctionData({
      abi: net.abi,
      functionName: "createJob",
      args: [
        ZERO_ADDR,
        ZERO_ADDR,
        expiredAt,
        `bounty:${bounty.bountyId}:attempt:${bounty.jobAttempt + 1}`,
        ZERO_ADDR,
      ],
    } as never),
    description: `createJob(provider=0x0) — new attempt for ${bounty.bountyId}`,
  };
}
