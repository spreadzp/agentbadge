/**
 * SLICE-197-07: onchain helpers for the bounty lease sweeper —
 * kept separate from sweep.ts to satisfy the 300-line file cap.
 */
import { encodeFunctionData, keccak256, toBytes, type Hex } from "viem";
import { logger } from "@agentbadge/passport/logger";

import { sendTelegramMessage } from "../../services/contact.service";
import {
  sendAsRole,
  serverRoleAddress,
  type VenueRole,
} from "../venue/lifecycle-sign";
import {
  fetchOnchainJob,
  fetchCreatedJobId,
  type OnchainJob,
  type VenueNetwork,
} from "../venue/chain";
import { buildActionTxs, type PreparedTx } from "../venue/lifecycle";
import { ErrorCodes, type ErrorCode } from "../error-codes";
import type { BountyRecord } from "./types";
import { upsertBounty } from "./store";

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
 * createJob(provider, evaluator, expiredAt, desc, hook=0x0) for the
 * new attempt. 197-19 e2e findings: the circle deploy reverts
 * ZeroAddress() on evaluator=0x0 — the evaluator role EOA must be a
 * real address, it is what signs complete/reject. Provider: on the
 * circle deploy it is bound AT createJob (first arg) and only that
 * address may call setBudget — a zero provider makes the job
 * permanently unbindable (Unauthorized). The claim path passes
 * payoutWallet; fund's lazy path leaves 0x0 (acp ordering:
 * setProvider binds later at claim).
 */
export function createJobTx(
  net: VenueNetwork,
  bounty: BountyRecord,
  leaseTtlMs: number,
  nowMs: number = Date.now(), // 197-17 M-8
  evaluator?: `0x${string}`,
  provider?: `0x${string}`,
): PreparedTx {
  const expiredAt = BigInt(Math.floor((nowMs + leaseTtlMs) / 1000));
  const evaluatorAddr =
    evaluator ??
    serverRoleAddress("evaluator") ??
    serverRoleAddress("client") ??
    ZERO_ADDR;
  return {
    to: net.agenticCommerce,
    data: encodeFunctionData({
      abi: net.abi,
      functionName: "createJob",
      args: [
        provider ?? ZERO_ADDR,
        evaluatorAddr,
        expiredAt,
        `bounty:${bounty.bountyId}:attempt:${bounty.jobAttempt + 1}`,
        ZERO_ADDR,
      ],
    } as never),
    description: `createJob(provider=${provider ?? "0x0"}) — new attempt for ${bounty.bountyId}`,
  };
}

// ─── Post-claim chain leg (197-19, extracted for the 300-line cap) ──

export interface FinalizeClaimDeps {
  /** Client-role send for the lazy createJob. */
  sendTx?: (
    txs: PreparedTx[],
    net: VenueNetwork,
  ) => Promise<`0x${string}`[] | null>;
  /** jobId decode after createJob (H-3 retry seam). */
  fetchJobId?: (
    txHash: `0x${string}`,
    net: VenueNetwork,
  ) => Promise<number | null>;
  /** Ops signer send for acp setProvider. */
  sendProviderTx?: (
    txs: PreparedTx[],
    net: VenueNetwork,
  ) => Promise<`0x${string}`[] | null>;
  /** JOB_EXPIRY_MS value resolved by the caller. */
  jobExpiryMs: number;
  now: number;
}

export type FinalizeClaimResult =
  | {
    ok: true;
    bounty: BountyRecord;
    providerTx?: PreparedTx;
    providerBind: "ops_sent" | "ops_calldata" | "agent_selfsign" | "none";
    txHash?: `0x${string}`;
  }
  | { ok: false; status: number; code: ErrorCode; message: string };

/**
 * Provider-bind tx per variant (D-197-6). Null when the bounty has no
 * onchainJobId yet (job creation happens in finalizeClaimJob).
 */
export function providerBindTx(
  net: VenueNetwork,
  bounty: BountyRecord,
  payoutWallet: `0x${string}`,
): PreparedTx | null {
  if (!bounty.onchainJobId) return null;
  const jobId = BigInt(bounty.onchainJobId);
  const txs = buildActionTxs(net, "claim", {
    onchainJobId: jobId,
    provider: payoutWallet,
    amountUsdc: Number(bounty.budgetUsdc),
  });
  return txs[0] ?? null;
}

/**
 * Runs the chain leg after the claim row is persisted:
 * 1. lazy createJob when the bounty has no onchainJobId — the circle
 *    deploy binds provider AT createJob (first arg) and only that
 *    address may call setBudget, so a zero-provider job is dead
 *    (fund ProviderNotSet, setBudget Unauthorized). Provider =
 *    payoutWallet; H-3: persist the tx hash before the decode can fail.
 * 2. provider bind — acp: ops send (or calldata when unkeyed); circle:
 *    setBudget calldata for the agent to self-sign.
 */
export async function finalizeClaimJob(
  net: VenueNetwork,
  bounty: BountyRecord,
  payoutWallet: `0x${string}`,
  deps: FinalizeClaimDeps,
): Promise<FinalizeClaimResult> {
  let bound = bounty;
  if (!bound.onchainJobId) {
    const createTx = createJobTx(
      net, bound, deps.jobExpiryMs, deps.now,
      undefined, // evaluator → serverRoleAddress default
      payoutWallet,
    );
    const send =
      deps.sendTx ??
      ((txs, n) => sendAsRole("client", txs, n.chain.rpcUrl));
    const hashes = await send([createTx], net).catch(() => null);
    const txHash = hashes?.[0];
    if (!txHash) {
      return {
        ok: false, status: 502, code: ErrorCodes.INVALID_STATE,
        message: "createJob send failed"
      };
    }
    bound = { ...bound, chainTxs: { ...bound.chainTxs, created: txHash } };
    upsertBounty(bound);
    const fetchId =
      deps.fetchJobId ?? ((h, n) => fetchCreatedJobId(h, n));
    // RPC indexer lag: sendAsRole returns once the tx is accepted, but
    // getTransactionReceipt can still be empty — poll up to ~9s.
    let jobId: number | null = null;
    for (let i = 0; i < 6 && jobId == null; i++) {
      jobId = await fetchId(txHash, net);
      if (jobId == null) await new Promise((r) => setTimeout(r, 1500));
    }
    if (jobId == null) {
      return {
        ok: false, status: 502, code: ErrorCodes.INVALID_STATE,
        message: "JobCreated not found in createJob receipt"
      };
    }
    bound = { ...bound, onchainJobId: String(jobId) };
    upsertBounty(bound);
  }

  const tx = providerBindTx(net, bound, payoutWallet);
  if (!tx) {
    return { ok: true, bounty: bound, providerBind: "none" };
  }
  if (net.variant === "acp") {
    const send =
      deps.sendProviderTx ??
      ((txs, n) => sendAsRole("client", txs, n.chain.rpcUrl));
    const hashes = await send([tx], net).catch((err) => {
      logger.warn("bounty claim: setProvider send failed", {
        bountyId: bound.bountyId,
        err: String(err).slice(0, 200),
      });
      return null;
    });
    if (hashes?.length) {
      return {
        ok: true, bounty: bound,
        providerBind: "ops_sent", txHash: hashes[0]
      };
    }
    return {
      ok: true, bounty: bound,
      providerBind: "ops_calldata", providerTx: tx
    };
  }
  return {
    ok: true, bounty: bound,
    providerBind: "agent_selfsign", providerTx: tx
  };
}
