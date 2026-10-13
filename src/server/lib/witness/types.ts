/**
 * SLICE-185-1 (EPIC-185): Witness layer types — enroll / seat / attestation.
 *
 * Independent witness agents attest EaaS/marketplace deliverables with
 * ADVISORY weight only (D-185-4): escrow/settlement never read these
 * records — the verdict read-path (185-3) surfaces them next to the
 * evaluator verdict with `witness_policy:"advisory"`.
 *
 * Canonical spec: docs/EPICS/185-witness-layer-verdicts/EPIC-185-*.md.
 */

/** Hard cap of external witness seats per job (D-185-5, const in v1). */
export const WITNESS_SEATS_PER_JOB = 2;

/** Self-declared domain enum (v1) — matched to nothing yet (D-185 O2:
 *  any witness may seat any job; domain-match filtering is post-v1). */
export const WITNESS_DOMAINS = ["scan", "code", "data", "generic"] as const;
export type WitnessDomain = (typeof WITNESS_DOMAINS)[number];

/** Max domains per enrollment. */
export const WITNESS_MAX_DOMAINS = 8;

/** Max chars for an attestation reason string. */
export const WITNESS_REASON_MAX = 280;

/**
 * Enrollment record (D-185-1). The wallet is declared at enroll and is
 * IMMUTABLE afterwards — COI is computed on the wallet, not agentId
 * (sybil vector: a fresh enroll with the same wallet must not reset
 * conflict checks).
 */
export interface WitnessEnroll {
  /** eip155:<chainId>:<registry>:<tokenId> — from 184 registration. */
  agentId: string;
  /** Self-declared domains, subset of WITNESS_DOMAINS, deduped. */
  domains: WitnessDomain[];
  /** EVM wallet that will sign attestations (EIP-191). Checksummed. */
  wallet: `0x${string}`;
  enrolledAt: number;
  status: "active" | "suspended";
}

/**
 * Seat claim outcome (D-185-2). Atomic inside the store backend —
 * a claim race must yield exactly WITNESS_SEATS_PER_JOB winners.
 * `window_closed` covers an expiresAt already in the past; seats are
 * never re-released in v1 (O1 — claimed seat persists past expiry).
 */
export type WitnessSeatClaim =
  | "claimed"
  | "no_seats"
  | "already_seated"
  | "already_attested"
  | "window_closed";

export interface WitnessSeat {
  /** EaaS job / marketplace deliverable id. */
  jobId: string;
  seatNo: 1 | 2;
  agentId: string;
  /** Attest window closes at this ms epoch (delivery + WITNESS_WINDOW_SEC). */
  expiresAt: number;
  claimed: boolean;
}

export interface WitnessAttestation {
  jobId: string;
  agentId: string;
  verdict: "pass" | "fail" | "inconclusive";
  /** sha256 of the deliverable content AS SEEN by the witness —
   *  a mismatch vs deliverableHash is a signal, not an error. */
  contentSha256: `0x${string}`;
  reason: string;
  /** ISO timestamp. */
  attestedAt: string;
  /** EIP-191 signature over the AgentBadgeWitness:v1 canonical payload. */
  signature: `0x${string}`;
}
