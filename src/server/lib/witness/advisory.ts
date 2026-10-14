/**
 * SLICE-185-3 (EPIC-185): advisory surface helpers.
 *
 * D-185-4: witnesses[] are advisory-only — exposed next to the evaluator
 * verdict, never read by settle/escrow paths.
 * D-185-8: independence — witness attestations are revealed only after
 * the attest window closes (deliveredAt + WITNESS_WINDOW_SEC). A seated
 * witness must not be able to peek at peers' verdicts pre-submission,
 * and the public read is anonymous so identity-gating is impossible.
 */
import type { WitnessAttestation } from "./store";
import type { WitnessJobRef } from "./jobs";

/**
 * Agreement over witness verdicts (O4):
 *   any "fail" → false; all "pass" (≥1) → true; otherwise → null
 *   (mixed pass+inconclusive, only inconclusive, or empty).
 */
export function computeWitnessAgreement(
  attestations: Pick<WitnessAttestation, "verdict">[],
): boolean | null {
  if (attestations.length === 0) return null;
  if (attestations.some((a) => a.verdict === "fail")) return false;
  if (attestations.every((a) => a.verdict === "pass")) return true;
  return null;
}

/**
 * Public shape of an attestation for the advisory surface — the fields a
 * consumer needs to re-verify the EIP-191 signature themselves
 * (AgentBadgeWitness:v1 payload rebuild) plus verdict + timestamp.
 * No seat internals or store metadata.
 */
export interface PublicWitnessAttestation {
  agentId: string;
  verdict: WitnessAttestation["verdict"];
  contentSha256: `0x${string}`;
  /**
   * M-1: does the witness-signed contentSha256 equal the on-chain
   * deliverableHash? null when the job has no projected hash (EaaS
   * evaluates or pre-submit reads) — consumers treat null as
   * "unverifiable", not "mismatch".
   */
  hashMatchesDeliverable: boolean | null;
  reason: string;
  signature: `0x${string}`;
  attestedAt: string;
}

export function publicAttestation(
  a: WitnessAttestation,
  deliverableHash?: `0x${string}`,
): PublicWitnessAttestation {
  return {
    agentId: a.agentId,
    verdict: a.verdict,
    contentSha256: a.contentSha256,
    hashMatchesDeliverable:
      deliverableHash !== undefined
        ? a.contentSha256.toLowerCase() === deliverableHash.toLowerCase()
        : null,
    reason: a.reason,
    signature: a.signature,
    attestedAt: a.attestedAt,
  };
}

export interface WitnessAdvisoryBlock {
  witness_policy: "advisory";
  witness_agreement: boolean | null;
  /** true once the attest window closed and witnesses[] is populated. */
  witnessesRevealed: boolean;
  /** ISO timestamp when witnesses[] becomes visible; absent if undelivered. */
  revealAt?: string;
  witnesses: PublicWitnessAttestation[];
}

/**
 * Compose the advisory block for a job read. witnesses[] stays empty
 * (witnessesRevealed:false) until the attest window closes — pending
 * attestations are invisible to everyone, preserving independence.
 */
export function buildWitnessAdvisory(
  job: WitnessJobRef,
  attestations: WitnessAttestation[],
  windowSec: number,
  now = Date.now(),
): WitnessAdvisoryBlock {
  // deliveredAt > 0 — a zeroed stamp must not reveal early (N-v3-1).
  const revealed =
    job.deliveredAt !== undefined &&
    job.deliveredAt > 0 &&
    now >= job.deliveredAt + windowSec * 1000;
  const publicAtts = revealed
    ? attestations.map((a) => publicAttestation(a, job.deliverableHash))
    : [];
  return {
    witness_policy: "advisory",
    witness_agreement: revealed ? computeWitnessAgreement(attestations) : null,
    witnessesRevealed: revealed,
    ...(job.deliveredAt !== undefined
      ? { revealAt: new Date(job.deliveredAt + windowSec * 1000).toISOString() }
      : {}),
    witnesses: publicAtts,
  };
}
