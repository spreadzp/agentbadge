/**
 * SLICE-197-08: bounty submit — lease holder delivers {prUrl, commitSha,
 * models?, tokens?} before leaseUntil (Q8, Q23).
 *
 * Guard chain: bounty "claimed" → live claim for this attempt →
 * passportId is the lease holder → lease still alive. claim.state
 * flips to "consumed"; the agent then signs submit(jobId,
 * deliverableHash(commitSha), 0x) from payoutWallet — server returns
 * calldata (provider must sign itself, like claim's circle path).
 *
 * models[]/tokens are self-reported (agent attestation, verified only
 * by QA-run 197-09): stored under `source:"self"`. Elapsed work time
 * is server-computed (now − claimedAtMs), never self-reported.
 *
 * Idempotent: a repeated submit of the SAME commitSha on a consumed
 * claim replays the stored result — no dup transitions/outcomes.
 */
import type { Hex } from "viem";

import { ErrorCodes, type ErrorCode } from "../error-codes";
import {
  buildActionTxs,
  deliverableHash,
  type PreparedTx,
} from "../venue/lifecycle";
import { resolveVenueNetwork, type VenueNetwork } from "../venue/chain";
import { assertBountyTransition } from "./lifecycle";
import {
  appendTransition,
  bountyStoreReady,
  getBounty,
  getClaim,
  upsertBounty,
  upsertClaim,
  type BountyClaimRecord,
  type BountyRecord,
} from "./store";

// ─── Types ─────────────────────────────────────────────────────

export interface SubmitRequest {
  bountyId: string;
  /** Lease-holding passport (from agentKeyAuth). */
  passportId: string;
  prUrl: string;
  commitSha: string;
  models?: string[];
  tokens?: number;
}

/** Self-reported submission payload persisted on the claim (Q23). */
export interface SubmitPayload {
  prUrl: string;
  commitSha: string;
  models?: string[];
  tokens?: number;
  source: "self";
  submittedAtMs: number;
  /** Server-computed claim→submit elapsed (never self-reported). */
  submitDurationMs: number;
}

export type SubmitResult =
  | {
      ok: true;
      bounty: BountyRecord;
      claim: BountyClaimRecord;
      deliverable: Hex;
      /** Calldata for agent self-sign (submit from payoutWallet). */
      submitTx?: PreparedTx;
      submission: SubmitPayload;
      idempotent?: true;
    }
  | { ok: false; status: number; code: ErrorCode; message: string };

export interface SubmitDeps {
  network?: () => VenueNetwork;
  now?: () => number;
}

const SHA_RE = /^(0x)?[0-9a-fA-F]{4,64}$/;
const MAX_MODELS = 16;

// ─── Submit ────────────────────────────────────────────────────

export async function submitBounty(
  req: SubmitRequest,
  deps: SubmitDeps = {},
): Promise<SubmitResult> {
  await bountyStoreReady();
  const net = (deps.network ?? resolveVenueNetwork)();
  const now = (deps.now ?? Date.now)();

  const prUrl = req.prUrl?.trim();
  const commitSha = req.commitSha?.trim();
  if (!prUrl || !commitSha) {
    return { ok: false, status: 400, code: ErrorCodes.MISSING_FIELDS,
      message: "prUrl and commitSha are required" };
  }
  if (prUrl.length > 512 || !/^https?:\/\//.test(prUrl)) {
    return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: "prUrl must be an http(s) URL ≤512 chars" };
  }
  if (!SHA_RE.test(commitSha)) {
    return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: "commitSha must be hex (4–64 chars, optional 0x)" };
  }
  const models = req.models?.slice(0, MAX_MODELS).map((m) =>
    String(m).slice(0, 64));
  if (req.models && req.models.length > MAX_MODELS) {
    return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: `models[] capped at ${MAX_MODELS}` };
  }
  const tokens =
    req.tokens != null &&
    Number.isInteger(req.tokens) &&
    req.tokens >= 0 &&
    req.tokens <= 1e12
      ? req.tokens
      : undefined;
  if (req.tokens != null && tokens === undefined) {
    return { ok: false, status: 400, code: ErrorCodes.INVALID_INPUT,
      message: "tokens must be a non-negative integer" };
  }

  const bounty = getBounty(req.bountyId);
  if (!bounty) {
    return { ok: false, status: 404, code: ErrorCodes.RESOURCE_NOT_FOUND,
      message: "unknown bountyId" };
  }

  const claim = getClaim(req.bountyId, bounty.jobAttempt);
  const stored = claim?.payload?.submission as SubmitPayload | undefined;

  // Idempotent replay: same commitSha on a consumed claim.
  if (
    claim?.state === "consumed" &&
    stored &&
    stored.commitSha === commitSha
  ) {
    return {
      ok: true,
      bounty,
      claim,
      deliverable: deliverableHash(commitSha),
      submission: stored,
      idempotent: true,
    };
  }

  const check = assertBountyTransition(bounty.status, "submit");
  if (!check.ok) {
    return { ok: false, status: 409, code: ErrorCodes.INVALID_STATE,
      message: check.reason ?? "cannot submit" };
  }

  if (!claim || claim.passportId !== req.passportId) {
    return { ok: false, status: 409, code: ErrorCodes.BOUNTY_NOT_HOLDER,
      message: "bounty lease is held by another passport" };
  }
  if (claim.state !== "open" || claim.leaseUntilMs < now) {
    return { ok: false, status: 409, code: ErrorCodes.BOUNTY_LEASE_EXPIRED,
      message: "lease expired — sweeper will reject the attempt" };
  }

  const deliverable = deliverableHash(commitSha);
  const submission: SubmitPayload = {
    prUrl,
    commitSha,
    models: models?.length ? models : undefined,
    tokens,
    source: "self",
    submittedAtMs: now,
    submitDurationMs: Math.max(0, now - claim.claimedAtMs),
  };

  claim.state = "consumed";
  claim.payload = { ...claim.payload, submission };
  upsertClaim(claim);

  const submitted: BountyRecord = { ...bounty, status: "submitted" };
  upsertBounty(submitted);
  appendTransition({
    id: `${req.bountyId}:${claim.jobAttempt}:submit:${now}`,
    bountyId: req.bountyId,
    actor: req.passportId,
    from: "claimed",
    to: "submitted",
    atMs: now,
    payload: { commitSha, prUrl, deliverable },
  });

  // Calldata for agent self-sign — provider is payoutWallet (Q38-A).
  let submitTx: PreparedTx | undefined;
  if (bounty.onchainJobId) {
    submitTx = buildActionTxs(net, "submit", {
      onchainJobId: BigInt(bounty.onchainJobId),
      deliverable,
    })[0];
  }

  return { ok: true, bounty: submitted, claim, deliverable, submitTx,
    submission };
}
