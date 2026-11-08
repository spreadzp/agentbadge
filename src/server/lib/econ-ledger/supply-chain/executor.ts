/**
 * SLICE-207-7: hop job executors — the chain seam.
 *
 * `Erc8183HopExecutor` (prod, D-207-7): one ERC-8183 job per hop.
 * Reuses the ref-variant tx builders (erc8183-ref.ts) + server-sign
 * `sendAsRole` — the pack never signs keys itself.
 *
 * Audit fixes (reviews/supply-chain-REVIEW.md):
 *  C-2 settle(jobId, amountUsdc) — amount cross-checked against the
 *     job's onchain budget before `complete`; a divergent figure
 *     aborts instead of paying blind.
 *  H-4 onchain evaluator = ops evaluator EOA (server-signed). The
 *     LOGICAL evaluator (next hop's receiver per D-207-7) is recorded
 *     in the job description/spec — the receiver's key is not ours.
 *  H-1 funding failure now throws with the jobId — the job exists
 *     onchain; ops retries fund on that id (repair path).
 *  M-2 toAtomic validates the decimal form — garbage/negatives never
 *     reach an onchain call.
 *  N-4 refApproveFundTxs is built once, destructured — no duplicate
 *     builder calls.
 *
 * `InMemoryHopExecutor`: dogfood/tests — records specs, returns
 * deterministic jobIds, no chain. The e2e exercises the same
 * HopJobExecutor contract.
 */

import type { VenueNetwork } from "../../venue/chain";
import { sendAsRole } from "../../venue/lifecycle-sign";
import { deliverableHash } from "../../venue/lifecycle";
import {
  decodeRefJobId,
  readRefJob,
  refApproveFundTxs,
  refCompleteTx,
  refCreateJobTx,
  REF_STATUS,
} from "../../board/erc8183-ref";
import {
  assertPositiveAmountUsdc,
  DECIMAL_USDC_RE,
  ShipmentOrderError,
  usdcMicros,
} from "./state";
import type {
  HopJobExecutor,
  HopJobRef,
  HopJobSpec,
} from "./types";

const DEFAULT_HOP_TTL_SEC = 48 * 3600;

export class Erc8183HopExecutor implements HopJobExecutor {
  constructor(
    private readonly net: VenueNetwork,
    private readonly usdcToken: `0x${string}`,
    private readonly rpcUrl: string,
    /** Onchain evaluator EOA — the server-signed ops address (H-4).
     *  The logical evaluator (next receiver) stays in the job spec. */
    private readonly evaluatorAddr: `0x${string}`,
  ) {}

  async createJob(spec: HopJobSpec): Promise<HopJobRef> {
    // 216-3 (audit C-2): a zero-budget job is not an escrow — the
    // settle budget check would skip it outright. Refuse at create.
    assertPositiveAmountUsdc(spec.amountUsdc);
    if (spec.ttlSec !== undefined && (!Number.isInteger(spec.ttlSec) || spec.ttlSec <= 0)) {
      throw new ShipmentOrderError(`ttlSec must be a positive integer: ${spec.ttlSec}`);
    }
    // 216-3 (audit M-6): honor the hop's ttlSec when the plan sets one.
    const expiredAt = BigInt(
      Math.floor(Date.now() / 1000) + (spec.ttlSec ?? DEFAULT_HOP_TTL_SEC),
    );
    const hashes = await sendAsRole(
      "client",
      [
        refCreateJobTx(this.net, {
          provider: spec.provider,
          evaluator: this.evaluatorAddr,
          expiredAtSec: expiredAt,
          // Logical evaluator = next hop's receiver (D-207-7) — recorded
          // in the description since the onchain evaluator is ops EOA.
          description: `${spec.description} | eval-next=${spec.evaluator}`,
        }),
      ],
      this.rpcUrl,
    );
    if (!hashes?.length) {
      throw new Error(`createJob for ${spec.shipmentId}#${spec.hopIndex} failed onchain`);
    }
    const txHash = hashes[0]!;
    const jobId = await decodeRefJobId(txHash, this.net);
    if (jobId === null) {
      throw new Error(`createJob tx ${txHash} mined without JobCreated log`);
    }
    // Budget + fund — built once, sequential sends (N-4).
    const amount = usdcMicros(spec.amountUsdc);
    const [approveTx, fundTx] = refApproveFundTxs(this.net, jobId, this.usdcToken, amount);
    const funded = await sendAsRole("client", [approveTx!, fundTx!], this.rpcUrl);
    // 216-3 (audit H-6 residual): sendAsRole returns null on any
    // failure — a partial batch is impossible — but assert BOTH hashes
    // anyway: approve alone must never read as funded.
    if (!funded || funded.length !== 2) {
      // H-1: the job EXISTS onchain but is unfunded — throw with the
      // jobId so ops retries fund on that id instead of a phantom hop.
      throw new Error(
        `hop job ${jobId} created (tx ${txHash}) but funding failed — ` +
          `retry fund on jobId ${jobId} before proceeding`,
      );
    }
    return { jobId: String(jobId), txHash };
  }

  /** settle = evaluator completes the job → escrow pays the receiver.
   *  C-2: amountUsdc is cross-checked against the onchain budget — a
   *  divergent figure aborts instead of paying blind. */
  async settle(jobId: string, amountUsdc: string): Promise<{ txHash?: string }> {
    if (!DECIMAL_USDC_RE.test(amountUsdc)) {
      throw new ShipmentOrderError(`invalid amountUsdc: ${amountUsdc}`);
    }
    const job = await readRefJob(BigInt(jobId), this.net);
    // 216-3 (audit C-2): FAIL CLOSED — an unreadable or absent job
    // cannot prove its budget, so the settle refuses rather than
    // signing an unchecked complete() on the wrong amount.
    if (!job) {
      throw new ShipmentOrderError(
        `job ${jobId} unreadable or absent — settle refused (cannot verify budget)`,
      );
    }
    // Idempotent settle: an already-Completed job returns without a
    // new tx — lets the ledger leg converge after a failed append retry.
    if (job.status === REF_STATUS.Completed) {
      if (job.settledAmount !== usdcMicros(amountUsdc)) {
        throw new ShipmentOrderError(
          `job ${jobId} already settled at a different amount`,
        );
      }
      return {};
    }
    if (job.status !== REF_STATUS.Funded && job.status !== REF_STATUS.Submitted) {
      throw new ShipmentOrderError(
        `job ${jobId} status ${job.status} is not settleable`,
      );
    }
    if (job.budget !== usdcMicros(amountUsdc)) {
      throw new ShipmentOrderError(
        `settle amount ${amountUsdc} ≠ onchain budget ${job.budget} (job ${jobId})`,
      );
    }
    const hashes = await sendAsRole(
      "evaluator",
      [refCompleteTx(this.net, BigInt(jobId), deliverableHash(`hop:${jobId}:settled`))],
      this.rpcUrl,
    );
    if (!hashes?.length) {
      throw new Error(`settle(complete) of job ${jobId} failed onchain`);
    }
    return { txHash: hashes[0] };
  }
}

/** Deterministic test/dogfood executor — same contract, no chain. */
export class InMemoryHopExecutor implements HopJobExecutor {
  readonly created: HopJobSpec[] = [];
  readonly settled: Array<{ jobId: string; amountUsdc: string }> = [];
  /** 216-3 (audit C-2): mirrors the chain executor's Completed check —
   *  a repeated settle() on the same jobId is a no-op. */
  private readonly settledIds = new Set<string>();
  /** Injected failure for the "failed hop preserves the log" AC. */
  failOnSettleJobId?: string;

  async createJob(spec: HopJobSpec): Promise<HopJobRef> {
    // 216-3 (audit C-2): mirror the chain executor — a zero-amount hop
    // is not an escrow, refuse it identically.
    assertPositiveAmountUsdc(spec.amountUsdc);
    if (spec.ttlSec !== undefined && (!Number.isInteger(spec.ttlSec) || spec.ttlSec <= 0)) {
      throw new ShipmentOrderError(`ttlSec must be a positive integer: ${spec.ttlSec}`);
    }
    this.created.push(spec);
    return { jobId: `job-${spec.shipmentId}-${spec.hopIndex}` };
  }

  async settle(jobId: string, amountUsdc: string): Promise<{ txHash?: string }> {
    // 216-3 (audit C-2): idempotent like the chain executor — a
    // re-settle of an already-settled job is a no-op, not a dup row.
    if (this.settledIds.has(jobId)) return {};
    if (jobId === this.failOnSettleJobId) {
      throw new Error(`settle of ${jobId} rejected (injected)`);
    }
    // Mark settled only AFTER a successful settle — a failed attempt
    // must stay retryable (the chain executor does too: the job never
    // reached Completed onchain).
    this.settledIds.add(jobId);
    this.settled.push({ jobId, amountUsdc });
    return {};
  }
}

// Compile-time interface check (audit C-2 guard): the class must
// satisfy HopJobExecutor exactly — a dropped param breaks this line.
const _executorInterfaceCheck: new (
  net: VenueNetwork,
  usdc: `0x${string}`,
  rpc: string,
  evalAddr: `0x${string}`,
) => HopJobExecutor = Erc8183HopExecutor;
void _executorInterfaceCheck;
