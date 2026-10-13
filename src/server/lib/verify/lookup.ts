/**
 * SLICE-180-1 (EPIC-180): Level-1 public verdict lookup for
 * GET /api/verify/:verdictId — "don't trust us, check it yourself".
 *
 * One read path assembling everything a third party needs to start
 * verifying independently:
 *   - verdict      — the stored VerdictArtifact (EIP-712 signed, the
 *                    artifact itself is self-verifiable offline)
 *   - reason_codes — machine codes derived from the artifact
 *                    (policy + kind; the human string stays in
 *                    artifact.reason)
 *   - anchor       — per-verdict onchain memo anchor record
 *                    (154-4): {status, memoId, txHash?} — honest
 *                    "pending"/"none"/"failed", never fake "valid"
 *   - chain        — hash-chain inclusion + head-anchor state (172):
 *                    status "anchored" only when the verdict is in the
 *                    chain AND the head was anchored on-chain; "pending"
 *                    while included but unanchored; "disabled" when the
 *                    chain feature is off
 *
 * The endpoint reports; the verifier package (180-3) checks on-chain —
 * two independent levels, neither substitutes the other.
 */

import type { Hex } from "viem";
import type { VerdictStoreBackend } from "../eaas/store";
import type { AnchorStatus, AnchorStore } from "../eaas/anchor";
import type { ChainService } from "../eaas/chain";
import type { VerdictArtifact } from "../eaas/verdict";

export type VerifyChainStatus = "anchored" | "pending" | "disabled";

export interface VerifyLookup {
  verdictId: Hex;
  verdict: VerdictArtifact;
  /** Machine codes: [policy:<name>, kind:<verdict-kind>]. */
  reason_codes: string[];
  anchor: {
    status: AnchorStatus | "none";
    memoId?: Hex;
    txHash?: Hex;
    blockNumber?: string;
    explorerUrl?: string;
  };
  chain: {
    status: VerifyChainStatus;
    /** Pointer for offline recomputation of the head. */
    head_ref?: {
      headHash: Hex;
      count: number;
      /** seq of this verdict's chain entry when included. */
      seq?: number;
      /** Latest on-chain head anchor (172-3). */
      anchor?: { epochSeq: number; txHash: Hex; blockNumber: string };
      /** Public proof endpoint — fold suffix via computeEntryHash. */
      proofUrl?: string;
    };
    /** Head-anchor info when status "anchored". */
    anchored_at?: { epochSeq: number; txHash: Hex; blockNumber: string };
  };
  /** ISO timestamp of this response assembly. */
  verified_at: string;
}

export interface VerifyLookupDeps {
  store: Pick<VerdictStoreBackend, "get">;
  /** Absent = memo anchoring off → anchor.status "none". */
  anchors?: AnchorStore;
  /** Absent = hash-chain off → chain.status "disabled". */
  chain?: Pick<ChainService, "head" | "proofFor">;
  explorerTx?: (txHash: string) => string;
  /** Base path prefix for the proof pointer (default /api/eaas/chain). */
  proofBaseUrl?: string;
  now?: () => Date;
}

export function lookupVerdict(
  verdictId: Hex,
  deps: VerifyLookupDeps,
): VerifyLookup | null {
  const stored = deps.store.get(verdictId);
  if (!stored) return null;

  // ─── reason codes: machine-readable derivatives of the artifact ───
  const reason_codes = [
    `policy:${stored.artifact.policy}`,
    `kind:${stored.artifact.kind}`,
  ];

  // ─── per-verdict memo anchor (honest status — never "valid") ───
  const anchor: VerifyLookup["anchor"] = { status: "none" };
  if (deps.anchors) {
    const rec = deps.anchors.get(verdictId);
    if (rec) {
      anchor.status = rec.status;
      anchor.memoId = rec.memoId;
      if (rec.txHash) {
        anchor.txHash = rec.txHash;
        if (rec.blockNumber) anchor.blockNumber = rec.blockNumber;
        if (deps.explorerTx) {
          anchor.explorerUrl = deps.explorerTx(rec.txHash);
        }
      }
    }
  }

  // ─── hash-chain inclusion + head-anchor state ───
  const chain: VerifyLookup["chain"] = { status: "disabled" };
  if (deps.chain) {
    const head = deps.chain.head();
    const proof = deps.chain.proofFor(verdictId);
    chain.status = head.anchor && proof ? "anchored" : "pending";
    chain.head_ref = {
      headHash: head.headHash,
      count: head.count,
      ...(proof ? { seq: proof.entry.seq } : {}),
      ...(head.anchor ? { anchor: head.anchor } : {}),
      proofUrl: `${deps.proofBaseUrl ?? "/api/eaas/chain"}/proof/${verdictId}`,
    };
    if (head.anchor && proof) {
      chain.anchored_at = head.anchor;
    }
  }

  return {
    verdictId,
    verdict: stored.artifact,
    reason_codes,
    anchor,
    chain,
    verified_at: (deps.now?.() ?? new Date()).toISOString(),
  };
}

/* --------------------------- input resolution ----------------------------- */

export type ResolveVia = "verdictId" | "txHash" | "memoId";

export type ResolveOutcome =
  | { ok: true; verdictId: Hex; via: ResolveVia }
  | { ok: false; reason: "malformed" | "not_found" };

const HEX32_INPUT_RE = /^0x[0-9a-fA-F]{64}$/;

/**
 * SLICE-180-2: human-facing input resolution for /verify — one field
 * accepts a verdictId, an anchor txHash, or a memoId; all 0x+64hex, so
 * we resolve in order: verdict store → anchors.txHash → anchors.memoId.
 * Malformed input is reported as such, not as a not-found verdict.
 */
export function resolveVerdictInput(
  raw: string,
  deps: VerifyLookupDeps,
): ResolveOutcome {
  const input = raw.trim().toLowerCase();
  if (!HEX32_INPUT_RE.test(input)) return { ok: false, reason: "malformed" };
  const hex = input as Hex;
  if (deps.store.get(hex)) return { ok: true, verdictId: hex, via: "verdictId" };
  if (deps.anchors) {
    for (const rec of deps.anchors.list()) {
      if (rec.txHash?.toLowerCase() === input) {
        return { ok: true, verdictId: rec.verdictId, via: "txHash" };
      }
      if (rec.memoId.toLowerCase() === input) {
        return { ok: true, verdictId: rec.verdictId, via: "memoId" };
      }
    }
  }
  return { ok: false, reason: "not_found" };
}
