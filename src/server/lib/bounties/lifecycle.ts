/**
 * SLICE-197-03: bounty lifecycle state matrix (off-chain statuses).
 *
 * Mirrors `lib/venue/lifecycle.ts` shape (ALLOWED_FROM / assertTransition /
 * RESULT_STATUS / actor gating) but for bounty-level states — the ERC-8183
 * job lifecycle stays onchain in the venue module.
 *
 * Model (Q37-A/Q38-A): one job = one attempt. A FAIL verdict or lease
 * expiry is terminal for the CURRENT attempt — the bounty then reopens
 * (`reopen`) with a fresh job while `jobAttempt` increments, up to the
 * re-claim cap. Every transition must be logged to `bounty_transition`
 * by the caller (store layer).
 */

// ─── Types ───────────────────────────────────────────────────

export type BountyStatus =
  | "open"
  | "claimed"
  | "submitted"
  | "passed"
  | "failed"
  | "expired"
  | "rejected";

export type BountyAction =
  | "claim" // passported agent takes the bounty (lease starts)
  | "submit" // lease holder delivers {prUrl, commitSha}
  | "pass" // evaluator QA verdict → release
  | "fail" // evaluator QA verdict → reject current job (terminal attempt)
  | "expire" // sweeper: lease TTL elapsed without submit
  | "reopen" // system: new job attempt after fail/expire (cap-gated)
  | "reject"; // evaluator|ops cancels the bounty (refund)

/** Actor kinds allowed to perform each action. */
export type BountyActor =
  | "agent" // any passported agent (claim)
  | "provider" // the lease-holding agent (submit)
  | "evaluator" // QA runner / ops-evaluator (verdicts)
  | "sweeper" // bounty-lease-sweeper service
  | "ops" // operator / ops-signer (client role)
  | "system"; // internal transition (reopen)

export const ACTION_ACTOR: Record<BountyAction, BountyActor[]> = {
  claim: ["agent"],
  submit: ["provider"],
  pass: ["evaluator"],
  fail: ["evaluator"],
  expire: ["sweeper", "ops"],
  reopen: ["system", "ops"],
  reject: ["evaluator", "ops"],
};

const ALLOWED_FROM: Record<BountyAction, BountyStatus[]> = {
  claim: ["open"],
  submit: ["claimed"],
  pass: ["submitted"],
  fail: ["submitted"],
  expire: ["claimed"],
  reopen: ["failed", "expired"],
  reject: ["open", "claimed", "submitted"],
};

export const RESULT_STATUS: Record<BountyAction, BountyStatus> = {
  claim: "claimed",
  submit: "submitted",
  pass: "passed",
  fail: "failed",
  expire: "expired",
  reopen: "open",
  reject: "rejected",
};

/** Terminal states — no outbound transitions. */
export const TERMINAL_STATUSES: readonly BountyStatus[] = [
  "passed",
  "rejected",
] as const;

/** Attempt-terminal states — the job dies, bounty may reopen. */
export const ATTEMPT_TERMINAL: readonly BountyStatus[] = [
  "failed",
  "expired",
] as const;

// ─── Transition guard ────────────────────────────────────────

export interface BountyTransitionCheck {
  ok: boolean;
  current: BountyStatus;
  to?: BountyStatus;
  expected?: BountyStatus[];
  reason?: string;
}

/**
 * Validate a transition. `attemptsLeft` is required only for `reopen`
 * (re-claim cap counts jobs per bounty — Q38-A).
 */
export function assertBountyTransition(
  current: BountyStatus,
  action: BountyAction,
  attemptsLeft?: number,
): BountyTransitionCheck {
  const allowed = ALLOWED_FROM[action];
  if (!allowed.includes(current)) {
    return {
      ok: false,
      current,
      expected: allowed,
      reason: `cannot ${action} a bounty in status "${current}"`,
    };
  }
  if (action === "reopen" && attemptsLeft !== undefined && attemptsLeft <= 0) {
    return {
      ok: false,
      current,
      expected: allowed,
      reason: "re-claim cap exhausted — no job attempts left",
    };
  }
  return { ok: true, current, to: RESULT_STATUS[action], expected: allowed };
}

// ─── Actor gating ────────────────────────────────────────────

export interface BountyActorCtx {
  kind: BountyActor;
  /** Passport id of the acting agent (claim/submit paths). */
  passportId?: string;
}

export interface BountyActorCheck {
  ok: boolean;
  reason?: string;
}

/**
 * Actor check for an action. `leasePassportId` is the passport that
 * holds the claim — required for `submit` (lease-holder-only rule).
 */
export function bountyActorAllowed(
  action: BountyAction,
  actor: BountyActorCtx,
  leasePassportId?: string,
): BountyActorCheck {
  const kinds = ACTION_ACTOR[action];
  if (!kinds.includes(actor.kind)) {
    return {
      ok: false,
      reason: `actor kind "${actor.kind}" cannot ${action} (allowed: ${kinds.join(", ")})`,
    };
  }
  if (action === "submit") {
    if (!leasePassportId || actor.passportId !== leasePassportId) {
      return { ok: false, reason: "submit requires the lease-holding passport" };
    }
  }
  return { ok: true };
}
