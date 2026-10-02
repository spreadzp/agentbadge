/**
 * SLICE-154-3: external-job evaluation service — settle a foreign
 * ERC-8183 job AND return a signed VerdictArtifact in one call.
 *
 * Pipeline (POST /api/eaas/jobs/evaluate after x402 settle):
 *   1. escrow.getJob(jobId)              — status gate (EvaluatorError → 409)
 *   2. expired → claimRefund             — verdict "expired"
 *   3. Submitted → POLICY_REGISTRY[policy] → complete/reject onchain
 *   4. sign VerdictArtifact (signer key; evaluator = settler EOA)
 *   5. persist eval record (idempotent per chainId:contract:jobId)
 *   6. giveFeedback(agentId, ±1, tag1="eaas-eval") — best-effort,
 *      skipped when contract.terms.noFeedback or no agentId resolver hit
 *
 * Gas-cap: the evaluator WriteClient is wrapped so every writeContract
 * is preceded by estimateGas — over ARC_EAAS_GAS_CAP aborts before send.
 */

import { logger } from "@agentbadge/passport";
import { createEvaluator } from "@agentbadge/circle-payments";
import type {
  EvaluationVerdict,
  Erc8183,
  JobView,
  WriteClient,
} from "@agentbadge/circle-payments";
import type { Hex } from "viem";
import type { PolicyFn } from "./policies";
import {
  hashCanonical,
  hashDeliverable,
  verdictIdOf,
  type UnsignedVerdictArtifact,
  type VerdictArtifact,
  type VerdictSigner,
} from "./verdict";
import type { StoredVerdict, VerdictStoreBackend } from "./store";
import type { VerdictAnchorer } from "./anchor";
import type { EaasContract } from "./contracts";
import {
  evalJobKey,
  type EvalJobStore,
  type EvalJobRecord,
} from "./eval-store";
import {
  buildEaasFeedbackTx,
  gasCappedWallet,
  type EstimateGasFn,
} from "./settle";

// Re-exports for consumers (route + wiring) — keep a single import surface.
export {
  createJsonEvalStore,
  createMemoryEvalStore,
  evalJobKey,
  type EvalJobRecord,
  type EvalJobStore,
} from "./eval-store";
export { GasCapError, buildEaasFeedbackTx, gasCappedWallet } from "./settle";
export type { EstimateGasFn } from "./settle";

/* ------------------------------ evaluation ------------------------------- */

export interface EvaluateJobInput {
  contract: EaasContract;
  jobId: bigint;
  /** POLICY_REGISTRY key — default from contract.terms or hash-match. */
  policy?: string;
  expectedHash?: Hex;
  /** Optional deliverable override (URI the provider pointed at). */
  deliverableUri?: string;
  consumerWallet?: string;
  paymentTx?: string;
}

export interface EvaluateJobDeps {
  /** escrow factory per registered contract — reads rec.variant
   *  (probe-detected ABI flavor) to pick circle vs acp ABI. */
  escrowFor: (contract: EaasContract) => Erc8183;
  /** Settler WriteClient (ARC_EVALUATOR_KEY-derived EOA). */
  wallet: WriteClient;
  /** Settler address — stamped into artifact.evaluator. */
  settlerAddress: `0x${string}`;
  estimateGas?: EstimateGasFn;
  /** ARC_EAAS_GAS_CAP — max estimated gas for a settle tx. */
  gasCap: number;
  policy: Record<string, PolicyFn>;
  signer: VerdictSigner;
  verdictStore: VerdictStoreBackend;
  evalStore: EvalJobStore;
  /** ERC-8004 agentId for the job provider wallet → feedback. */
  resolveAgentId?: (provider: `0x${string}`) => Promise<bigint | null>;
  /** reputation-registry giveFeedback target + memo wrapper. */
  reputation?: { registry: `0x${string}`; memo: `0x${string}` };
  /** Sender for the feedback tx (evaluator EOA). */
  sendTx?: (tx: { to: `0x${string}`; data: Hex }) => Promise<Hex>;
  /** SLICE-154-4: onchain memo anchor — absent = anchoring disabled. */
  anchorer?: Pick<VerdictAnchorer, "enqueue">;
  now?: () => number;
}

export interface EvaluateJobResult {
  verdict: EvaluationVerdict;
  artifact: VerdictArtifact;
  feedbackTx?: string;
  duplicate?: boolean;
}

/** Build the policy VerifyFn closure for evaluator.verify. */
function makeVerify(input: EvaluateJobInput, deps: EvaluateJobDeps) {
  return async (job: JobView, result?: unknown) => {
    const policyName =
      input.policy ?? input.contract.terms?.policyDefault ?? "hash-match";
    const policy = deps.policy[policyName];
    if (!policy) {
      return {
        pass: false,
        reason: `evaluation-error:unknown-policy:${policyName}`,
      };
    }
    const deliverable =
      result ??
      (input.deliverableUri
        ? { uri: input.deliverableUri }
        : {
          data: {
            contract: input.contract.address,
            jobId: job.id.toString(),
            description: job.description,
          },
        });
    try {
      return await policy({
        deliverable,
        deliverableUri: input.deliverableUri,
        expectedHash: input.expectedHash,
        consumerWallet: input.consumerWallet,
      });
    } catch (e) {
      const code = e instanceof Error ? e.name : "Error";
      return {
        pass: false,
        reason: `evaluation-error:${code}`,
        evidence: { error: e instanceof Error ? e.message : String(e) },
      };
    }
  };
}

/** Sign the artifact mirroring the settled EvaluationVerdict. */
async function signEvalArtifact(
  input: EvaluateJobInput,
  verdict: EvaluationVerdict,
  job: JobView,
  deps: EvaluateJobDeps,
): Promise<VerdictArtifact> {
  const policy =
    input.policy ?? input.contract.terms?.policyDefault ?? "hash-match";
  const deliverable = {
    kind: "erc8183-job",
    contract: input.contract.address,
    jobId: verdict.jobId,
    description: job.description,
    client: job.client,
    provider: job.provider,
  };
  const deliverableHash = hashDeliverable(deliverable);
  const unsigned: UnsignedVerdictArtifact = {
    verdictId: verdictIdOf(deliverableHash, policy, `job:${verdict.jobId}`),
    kind: verdict.verdict === "approve" ? "approve" : "reject",
    policy,
    deliverableHash,
    reason: verdict.reason,
    reasonHash: verdict.reasonHash,
    evidenceHash: hashCanonical(verdict.evidence ?? null),
    evaluator: deps.settlerAddress as Hex,
    chainId: input.contract.chainId,
    issuedAt: verdict.evaluatedAt,
  };
  return { ...unsigned, signature: await deps.signer.sign(unsigned) };
}

/* ------------------------------- orchestrate ------------------------------ */

export async function evaluateExternalJob(
  input: EvaluateJobInput,
  deps: EvaluateJobDeps,
): Promise<EvaluateJobResult> {
  const key = evalJobKey(
    input.contract.chainId,
    input.contract.address,
    input.jobId.toString(),
  );
  const existing = deps.evalStore.get(key);
  if (existing) {
    const artifact = deps.verdictStore.get(existing.verdictId)?.artifact;
    return {
      verdict: existing.verdict,
      artifact: artifact ?? ({} as VerdictArtifact),
      duplicate: true,
    };
  }

  const escrow = deps.escrowFor(input.contract);
  const wallet =
    deps.estimateGas && deps.gasCap > 0
      ? gasCappedWallet(
        deps.wallet,
        deps.settlerAddress,
        deps.estimateGas,
        BigInt(deps.gasCap),
      )
      : deps.wallet;

  const evaluator = createEvaluator({
    escrow,
    wallet,
    verify: makeVerify(input, deps),
    ...(deps.now ? { now: () => Math.floor(deps.now!() / 1000) } : {}),
  });

  // EvaluatorError (non-Submitted, non-expired) propagates → route maps 409.
  // Erc8183Error on settle propagates → route maps 502.
  const verdict = await evaluator.evaluate(input.jobId);

  // Re-read for artifact fields (client/provider/description).
  const ZERO = "0x0000000000000000000000000000000000000000" as `0x${string}`;
  const job = await escrow.getJob(input.jobId).catch(() => null);
  const artifact = await signEvalArtifact(
    input,
    verdict,
    job ?? {
      id: input.jobId,
      client: ZERO,
      provider: ZERO,
      evaluator: deps.settlerAddress,
      description: "",
      budget: 0n,
      expiredAt: 0n,
      status: "Submitted",
      hook: ZERO,
    },
    deps,
  );

  const stored = {
    artifact,
    ...(input.consumerWallet ? { consumerWallet: input.consumerWallet } : {}),
    ...(input.paymentTx ? { paymentTx: input.paymentTx } : {}),
    evidence: verdict.evidence,
  } satisfies StoredVerdict;
  deps.verdictStore.put(stored);
  // Reputation write-back — best-effort, never fails the response.
  let feedbackTx: string | undefined;
  if (
    deps.reputation &&
    deps.sendTx &&
    deps.resolveAgentId &&
    !input.contract.terms?.noFeedback &&
    (verdict.verdict === "approve" || verdict.verdict === "reject") &&
    job
  ) {
    try {
      const agentId = await deps.resolveAgentId(job.provider);
      if (agentId != null) {
        const tx = buildEaasFeedbackTx({
          memo: deps.reputation.memo,
          registry: deps.reputation.registry,
          agentId,
          verdict: verdict.verdict,
          reason: verdict.reason,
          jobId: verdict.jobId,
          contract: input.contract.address,
          ...(verdict.txHash ? { txHash: verdict.txHash } : {}),
        });
        feedbackTx = await deps.sendTx(tx);
      }
    } catch (e) {
      logger.warn("eaas-eval feedback failed", {
        jobId: verdict.jobId,
        err: e instanceof Error ? e.message : String(e),
      });
    }
  }

  deps.evalStore.put({
    key,
    contract: input.contract.address,
    chainId: input.contract.chainId,
    jobId: verdict.jobId,
    verdict,
    verdictId: artifact.verdictId,
    ...(feedbackTx ? { feedbackTx } : {}),
    ...(input.paymentTx ? { paymentTx: input.paymentTx } : {}),
  } satisfies EvalJobRecord);

  // SLICE-154-4: fire-and-forget onchain anchor (async, retried).
  deps.anchorer?.enqueue(stored);

  return { verdict, artifact, ...(feedbackTx ? { feedbackTx } : {}) };
}
