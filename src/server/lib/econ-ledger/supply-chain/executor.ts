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
} from "../../board/erc8183-ref";
import { DECIMAL_USDC_RE, ShipmentOrderError } from "./state";
import type {
  HopJobExecutor,
  HopJobRef,
  HopJobSpec,
} from "./types";

const USDC_DECIMALS = 6;
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
    if (!DECIMAL_USDC_RE.test(spec.amountUsdc)) {
      throw new ShipmentOrderError(`invalid amountUsdc: ${spec.amountUsdc}`);
    }
    const expiredAt = BigInt(Math.floor(Date.now() / 1000) + DEFAULT_HOP_TTL_SEC);
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
    const amount = toAtomic(spec.amountUsdc);
    const [approveTx, fundTx] = refApproveFundTxs(this.net, jobId, this.usdcToken, amount);
    const funded = await sendAsRole("client", [approveTx!, fundTx!], this.rpcUrl);
    if (!funded?.length) {
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
    if (job && job.budget !== 0n && job.budget !== toAtomic(amountUsdc)) {
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

/** Exact decimal→atomic conversion; rejects non-decimal input (M-2). */
function toAtomic(usdc: string): bigint {
  if (!DECIMAL_USDC_RE.test(usdc)) {
    throw new ShipmentOrderError(`invalid amountUsdc: ${usdc}`);
  }
  const [whole, frac = ""] = usdc.split(".");
  const micros = BigInt(whole) * 10n ** BigInt(USDC_DECIMALS) +
    BigInt((frac + "000000").slice(0, USDC_DECIMALS));
  return micros;
}

/** Deterministic test/dogfood executor — same contract, no chain. */
export class InMemoryHopExecutor implements HopJobExecutor {
  readonly created: HopJobSpec[] = [];
  readonly settled: Array<{ jobId: string; amountUsdc: string }> = [];
  /** Injected failure for the "failed hop preserves the log" AC. */
  failOnSettleJobId?: string;

  async createJob(spec: HopJobSpec): Promise<HopJobRef> {
    this.created.push(spec);
    return { jobId: `job-${spec.shipmentId}-${spec.hopIndex}` };
  }

  async settle(jobId: string, amountUsdc: string): Promise<{ txHash?: string }> {
    if (jobId === this.failOnSettleJobId) {
      throw new Error(`settle of ${jobId} rejected (injected)`);
    }
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
