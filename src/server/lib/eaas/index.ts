/**
 * SLICE-154-1: EaaS service entry — issueVerdict orchestration.
 *
 * Flow: resolve policy (unknown → UnknownPolicyError → 400 at the route
 * layer, SLICE-154-2) → compute verdictId for idempotency → short-circuit
 * on an already-issued artifact (no re-sign, no second store write) →
 * run the policy → build + sign the EIP-712 artifact → persist.
 */
import type { Hex } from "viem";
import { keccak256, toBytes } from "viem";
import {
  getPolicy,
  type PolicyFn,
} from "./policies";
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

export interface IssueVerdictRequest {
  /** POLICY_REGISTRY key — unknown names throw UnknownPolicyError. */
  policy: string;
  /** Arbitrary payload — canonical-JSON-hashed into deliverableHash. */
  deliverable: unknown;
  /** Target URL for readiness-scan. */
  deliverableUri?: string;
  /** Commitment hash for hash-match. */
  expectedHash?: Hex;
  /** Idempotency nonce — same (deliverableHash, policy, nonce) = same verdictId. */
  nonce?: number | string;
  /** Requesting consumer wallet — billing/limits key. */
  consumerWallet?: string;
  /** x402 settlement tx — recorded on the StoredVerdict (SLICE-154-2). */
  paymentTx?: string;
}

export interface EaasServiceDeps {
  signer: VerdictSigner;
  store: VerdictStoreBackend;
  /** Policy registry override for tests (default: POLICY_REGISTRY). */
  registry?: Record<string, PolicyFn>;
  /** Clock override for deterministic tests. */
  now?: () => Date;
  /** SLICE-154-4: onchain memo anchor — absent = anchoring disabled. */
  anchorer?: Pick<VerdictAnchorer, "enqueue">;
}

export interface IssueVerdictResult {
  artifact: VerdictArtifact;
  /** true = served from store (idempotent replay), nothing re-signed/written. */
  duplicate: boolean;
}

export async function issueVerdict(
  req: IssueVerdictRequest,
  deps: EaasServiceDeps,
): Promise<IssueVerdictResult> {
  const policy = getPolicy(req.policy, deps.registry);
  const deliverableHash = hashDeliverable(req.deliverable);
  const verdictId = verdictIdOf(deliverableHash, req.policy, req.nonce ?? 0);

  const existing = deps.store.get(verdictId);
  if (existing) {
    return { artifact: existing.artifact, duplicate: true };
  }

  // Fail-closed (SLICE-154-2): a policy throw is a paid rejection, not a 5xx —
  // the consumer paid for an evaluation and gets a signed "reject" artifact.
  let result: { pass: boolean; reason: string; evidence?: unknown };
  try {
    result = await policy({
      deliverable: req.deliverable,
      deliverableUri: req.deliverableUri,
      expectedHash: req.expectedHash,
      consumerWallet: req.consumerWallet,
    });
  } catch (e) {
    const code = e instanceof Error ? e.name : "Error";
    result = {
      pass: false,
      reason: `evaluation-error:${code}`,
      evidence: {
        error: e instanceof Error ? e.message : String(e),
      },
    };
  }

  const unsigned: UnsignedVerdictArtifact = {
    verdictId,
    kind: result.pass ? "approve" : "reject",
    policy: req.policy,
    deliverableHash,
    reason: result.reason,
    reasonHash: keccak256(toBytes(result.reason)),
    evidenceHash: hashCanonical(result.evidence ?? null),
    evaluator: deps.signer.address as Hex,
    chainId: deps.signer.chainId,
    issuedAt: (deps.now ?? (() => new Date()))().toISOString(),
  };
  const signature = await deps.signer.sign(unsigned);
  const artifact: VerdictArtifact = { ...unsigned, signature };

  const stored: StoredVerdict = {
    artifact,
    consumerWallet: req.consumerWallet,
    paymentTx: req.paymentTx,
    evidence: result.evidence,
  };
  deps.store.put(stored);

  // SLICE-154-4: fire-and-forget onchain anchor — never blocks the response.
  deps.anchorer?.enqueue(stored);

  return { artifact, duplicate: false };
}
