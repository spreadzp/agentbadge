/**
 * SLICE-197-02/04: BountyStore record types. Shared shape for the
 * JSON lane (.data/bounties.json) and the Postgres mirror.
 */
import type { BountyStatus } from "./lifecycle";

export interface BountyRecord {
  bountyId: string;
  title: string;
  /** Pre-claim structured brief (Q33): criteria, deliverable, steps, verify. */
  brief: {
    criteria: string[];
    deliverableType: "pr" | "url" | "post" | "report";
    steps?: string[];
    verify?: string;
  };
  description?: string;
  /** Decimal USDC string (matches Prisma Decimal codec). */
  budgetUsdc: string;
  status: BountyStatus;
  /** Active ERC-8183 onchain jobId; provider=0x0 until claim. */
  onchainJobId?: string;
  /** One job = one attempt (Q37/Q38-A); increments on reopen. */
  jobAttempt: number;
  /** Created by ops passport/wallet (Q4 client role). */
  createdBy?: string;
  /** Passport id of the agent that created the bounty (self-posted). */
  createdByPassportId?: string;
  /** Onchain tx hashes keyed by lifecycle step. */
  chainTxs?: Partial<
    Record<
      "created" | "funded" | "submitted" | "completed" | "rejected",
      string
    >
  >;
  /** Latest verdict memo anchor (197-10). */
  verdictMemoTx?: string;
  /** Extensible metadata (deliverable ref, tags…). */
  payload?: Record<string, unknown>;
  createdAt: string;
}

export interface BountyClaimRecord {
  /** Composite key `${bountyId}:${jobAttempt}` — one claim per attempt. */
  id: string;
  bountyId: string;
  jobAttempt: number;
  passportId: string;
  payoutWallet: string;
  /** open = active lease; expired = sweeper fired; consumed = submitted. */
  state: "open" | "expired" | "consumed";
  claimedAtMs: number;
  leaseUntilMs: number;
  payload?: Record<string, unknown>;
}

export interface BountyTransitionRecord {
  id: string;
  bountyId: string;
  actor: string;
  from: string;
  to: string;
  reason?: string;
  atMs: number;
  payload?: Record<string, unknown>;
}

export interface BountyOutcomeRecord {
  /** Composite key `${bountyId}:${jobAttempt}` — one verdict per attempt. */
  id: string;
  bountyId: string;
  jobAttempt: number;
  passportId?: string;
  verdict: "pass" | "fail" | "timeout";
  reasonCodes?: string[];
  verdictMemoTx?: string;
  verdictRejectTx?: string;
  commitSha?: string;
  payload?: Record<string, unknown>;
}

/**
 * SLICE-197-04: passport owner index — latest observed owner of an
 * ERC-8004 identity token (agentId), built from Transfer logs (O7:
 * no Enumerable → onchain list-by-owner impossible).
 */
export interface PassportOwnerRecord {
  /** agentId (uint256 decimal string) on the identity registry. */
  passportId: string;
  owner: string;
  /** Block of the Transfer that set this owner (monotonic guard). */
  blockNumber: number;
  logIndex?: number;
  txHash?: string;
  payload?: Record<string, unknown>;
}

export interface BountyData {
  bounties: Record<string, BountyRecord>;
  claims: Record<string, BountyClaimRecord>;
  /** Append-only audit — keyed by transition id. */
  transitions: Record<string, BountyTransitionRecord>;
  outcomes: Record<string, BountyOutcomeRecord>;
  /** passportId → latest owner (indexer mirror, 197-04). */
  owners: Record<string, PassportOwnerRecord>;
  /** Sweeper watermark + misc state. */
  meta?: Record<string, unknown>;
}

export function claimKey(bountyId: string, jobAttempt: number): string {
  return `${bountyId}:${jobAttempt}`;
}
