/**
 * SLICE-180-4 (EPIC-180, D-180-5): versioned proof-kind registry.
 *
 * Every on-chain proof the verification surface understands is declared
 * here — memo format, verifier rule, spec version — so a verifier can
 * negotiate coverage instead of guessing. Unknown kind → typed
 * `unknown_proof_kind` (error-catalog registered), never a silent skip.
 *
 * Bridge with 172-4: `verdict` wraps the per-verdict memo anchor that
 * `chainProofOf`/`proofFor` complement on-chain; `anchor-head` is the
 * 172-3 epoch anchor the chain proof's headHash cross-checks against.
 * `witness` is reserved for the witness-enrollment layer (registry row
 * exists so clients can feature-detect it).
 */
import { memoIdFor } from "@agentbadge/circle-payments";
import type { Hex } from "viem";

export type ProofKindName = "verdict" | "witness" | "anchor-head";

export interface ProofKindSpec {
  /** How the proof is materialized on-chain (memo namespace + payload). */
  memoFormat: string;
  /** What a third-party verifier must re-check for ok:true. */
  verifierRule: string;
  /** Registry schema version — bump on any rule/memoFormat change. */
  specVersion: 1;
  /** false = declared for feature-detection, not yet verifiable. */
  implemented: boolean;
}

export const PROOF_KINDS_V1: Record<ProofKindName, ProofKindSpec> = {
  verdict: {
    memoFormat:
      "memo(target, 0x, memoIdFor('eaas', verdictId), artifactHash)",
    verifierRule:
      "Memo event exists for memoIdFor('eaas', verdictId); memoData " +
      "=== keccak256(canonicalJson(artifact)) when artifact supplied",
    specVersion: 1,
    implemented: true,
  },
  witness: {
    memoFormat:
      "memo(target, 0x, memoIdFor('witness', witnessId), witnessHash) " +
      "— reserved; enrollment layer",
    verifierRule:
      "Not yet implemented — declared so verifiers can feature-detect",
    specVersion: 1,
  },
  "anchor-head": {
    memoFormat:
      "memo(self, 0x, memoIdFor('chain', domain, epochSeq), " +
      "abiEncode(headHash, count, prevAnchoredHeadHash))",
    verifierRule:
      "epochs contiguous from 0; recomputed headHash over supplied " +
      "entries === anchored headHash; prevAnchored links epoch chain",
    specVersion: 1,
  },
};

/** memoId for a proof kind + subject — the on-chain lookup key. */
export function proofMemoId(
  kind: ProofKindName,
  subject: { verdictId?: Hex; domain?: string; epochSeq?: bigint },
): Hex {
  assertProofKind(kind);
  switch (kind) {
    case "verdict":
      if (!subject.verdictId) throw new Error("verdictId required");
      return memoIdFor("eaas", subject.verdictId);
    case "anchor-head":
      if (subject.domain === undefined || subject.epochSeq === undefined) {
        throw new Error("domain + epochSeq required");
      }
      return memoIdFor("chain", subject.domain, subject.epochSeq);
    case "witness":
      throw new Error("witness proof kind not yet implemented");
  }
}

export interface UnknownProofKindError extends Error {
  code: "unknown_proof_kind";
  kind: string;
  known: ProofKindName[];
}

/**
 * Narrow an arbitrary kind string to a registered ProofKindName.
 * Unknown → typed error (callers map to 400 unknown_proof_kind).
 */
export function assertProofKind(kind: string): asserts kind is ProofKindName {
  if (!(kind in PROOF_KINDS_V1)) {
    const err = new Error(
      `unknown proof kind "${kind}" — known: ${Object.keys(PROOF_KINDS_V1).join(", ")}`,
    ) as UnknownProofKindError;
    err.code = "unknown_proof_kind";
    err.kind = kind;
    err.known = Object.keys(PROOF_KINDS_V1) as ProofKindName[];
    throw err;
  }
}

/** Registry view for API output — kinds + spec versions, no rules text. */
export function proofKindsSummary(): Record<
  ProofKindName,
  { specVersion: number; implemented: boolean }
> {
  return Object.fromEntries(
    Object.entries(PROOF_KINDS_V1).map(([k, v]) => [
      k,
      { specVersion: v.specVersion, implemented: v.implemented },
    ]),
  ) as Record<ProofKindName, { specVersion: number; implemented: boolean }>;
}
