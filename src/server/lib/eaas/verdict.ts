/**
 * SLICE-154-1: VerdictArtifact — self-verifiable verdict object.
 *
 * EaaS sells verification as a "trust oracle": the consumer verifies the
 * artifact OFFLINE via EIP-712 recover — no trust in our API required.
 * The mechanism mirrors packages/evm-core/eip712.ts (ethers v6
 * signTypedData/verifyTypedData, EIP712Domain { name, version, chainId,
 * verifyingContract }), with a dedicated domain name "AgentBadgeVerdict"
 * version "1" bound to the chain. Memo-anchoring onchain lands in
 * SLICE-154-4 — the artifact is a pure offchain object here.
 *
 * `kind` re-uses VerdictKind from @agentbadge/circle-payments minus
 * "expired" — expiry is a job-bound outcome and never appears in a
 * standalone artifact.
 */
import type { Hex } from "viem";
import { keccak256, toBytes } from "viem";
import { ethers } from "ethers";
import type { VerdictKind } from "@agentbadge/circle-payments";

export type VerdictArtifactKind = Exclude<VerdictKind, "expired">;

export interface VerdictArtifact {
  /** keccak256(`${deliverableHash}:${policy}:${nonce}`) — idempotency key. */
  verdictId: Hex;
  /** "approve" | "reject" (VerdictKind minus job-bound "expired"). */
  kind: VerdictArtifactKind;
  /** POLICY_REGISTRY key, e.g. "deliverable-present" | "hash-match" | "readiness-scan". */
  policy: string;
  /** keccak256(canonical deliverable JSON). */
  deliverableHash: Hex;
  /** Human-readable verdict reason. */
  reason: string;
  /** keccak256(reason) — onchain-compatible attestation hash. */
  reasonHash: Hex;
  /** keccak256(canonical evidence JSON). */
  evidenceHash: Hex;
  /** Signer EOA (EIP-712 recover must equal this). */
  evaluator: Hex;
  chainId: number;
  /** ISO timestamp. */
  issuedAt: string;
  /** EIP-712 signature over all fields above. */
  signature: Hex;
}

/** The fields actually covered by the EIP-712 signature. */
export type UnsignedVerdictArtifact = Omit<VerdictArtifact, "signature">;

export const VERDICT_DOMAIN_NAME = "AgentBadgeVerdict";
export const VERDICT_DOMAIN_VERSION = "1";
/**
 * Artifact is verified offchain (recover vs evaluator); there is no
 * onchain verifying contract — zero-address sentinel keeps the domain
 * shape consistent with evm-core eip712.ts.
 */
export const VERDICT_VERIFYING_CONTRACT =
  "0x0000000000000000000000000000000000000000";

const VERDICT_TYPE = [
  { name: "verdictId", type: "bytes32" },
  { name: "kind", type: "string" },
  { name: "policy", type: "string" },
  { name: "deliverableHash", type: "bytes32" },
  { name: "reason", type: "string" },
  { name: "reasonHash", type: "bytes32" },
  { name: "evidenceHash", type: "bytes32" },
  { name: "evaluator", type: "address" },
  { name: "issuedAt", type: "string" },
  { name: "chainId", type: "uint256" },
];

export function buildVerdictDomain(chainId: number) {
  return {
    name: VERDICT_DOMAIN_NAME,
    version: VERDICT_DOMAIN_VERSION,
    chainId,
    verifyingContract: VERDICT_VERIFYING_CONTRACT,
  };
}

/**
 * Deterministic JSON with recursively sorted object keys — so hashes of
 * "the same" evidence/deliverable are stable regardless of key order.
 */
export function canonicalJson(value: unknown): string {
  if (value === undefined) return "null";
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  const keys = Object.keys(value as Record<string, unknown>).sort();
  const body = keys
    .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
    .map(
      (k) =>
        `${JSON.stringify(k)}:${canonicalJson((value as Record<string, unknown>)[k])}`,
    )
    .join(",");
  return `{${body}}`;
}

export function hashCanonical(value: unknown): Hex {
  return keccak256(toBytes(canonicalJson(value)));
}

/** keccak256(canonical deliverable JSON) — the artifact subject. */
export function hashDeliverable(deliverable: unknown): Hex {
  return hashCanonical(deliverable);
}

/**
 * Idempotency key: re-requesting the same (deliverableHash, policy, nonce)
 * yields the same verdictId — the store dedupes on it and no second
 * record is written.
 */
export function verdictIdOf(
  deliverableHash: Hex,
  policy: string,
  nonce: number | string,
): Hex {
  return keccak256(toBytes(`${deliverableHash}:${policy}:${nonce}`));
}

function messageOf(a: UnsignedVerdictArtifact) {
  return {
    verdictId: a.verdictId,
    kind: a.kind,
    policy: a.policy,
    deliverableHash: a.deliverableHash,
    reason: a.reason,
    reasonHash: a.reasonHash,
    evidenceHash: a.evidenceHash,
    evaluator: a.evaluator,
    issuedAt: a.issuedAt,
    chainId: BigInt(a.chainId),
  };
}

export interface VerdictSigner {
  /** Signer EOA — stamped into artifact.evaluator. */
  address: string;
  chainId: number;
  sign(artifact: UnsignedVerdictArtifact): Promise<Hex>;
}

/** EIP-712 signer for the ARC_VERDICT_SIGNER_KEY EOA (NOT ARC_EVALUATOR_KEY). */
export function createVerdictSigner(
  privateKey: string,
  chainId: number,
): VerdictSigner {
  const wallet = new ethers.Wallet(privateKey);
  const types = { VerdictArtifact: VERDICT_TYPE };
  return {
    address: wallet.address,
    chainId,
    async sign(artifact) {
      return (await wallet.signTypedData(
        buildVerdictDomain(artifact.chainId),
        types,
        messageOf(artifact),
      )) as Hex;
    },
  };
}

/**
 * Offline verification: recover the EIP-712 signer and compare against
 * artifact.evaluator. Any tampering (reason, kind, hashes, issuedAt...)
 * produces a different digest → different recovered address → false.
 * Malformed signatures also return false rather than throwing.
 */
export function verifyVerdictSignature(artifact: VerdictArtifact): boolean {
  try {
    const recovered = ethers.verifyTypedData(
      buildVerdictDomain(artifact.chainId),
      { VerdictArtifact: VERDICT_TYPE },
      messageOf(artifact),
      artifact.signature,
    );
    return recovered.toLowerCase() === artifact.evaluator.toLowerCase();
  } catch {
    return false;
  }
}
