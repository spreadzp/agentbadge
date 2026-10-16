/**
 * SLICE-199-06 (EPIC-199, D-199-3): column state machine — the single
 * source of truth mapping the 7 kanban columns onto the EPIC-197 bounty
 * lifecycle (`lib/bounties/lifecycle.ts`).
 *
 * deriveColumn() is a pure function of (status, outcome, fixDeadline,
 * now): the BoardCard.column denormalization is ALWAYS reproducible from
 * the journal + bounty state, so a drifted card column can be
 * reconciled. assertColumnTransition() is the ONLY legal way to move a
 * card — routes must go through it before writing journal entries.
 */
import type {
  BountyAction,
  BountyActor,
  BountyStatus,
} from "../bounties/lifecycle";
import type { BoardColumn } from "./types";

export type BoardAction =
  | "claim" // passported agent takes the card (Todo→InProgress)
  | "submit" // lease holder delivers (→Testing)
  | "qaFail" // QA runner verdict fail (→Bug + fix deadline)
  | "fixResubmit" // same provider resubmits within fix-TTL (Bug→Testing)
  | "qaPass" // QA runner verdict pass (→Review; NOT a lifecycle move)
  | "reviewApprove" // reviewer accepts → ops complete (→Done)
  | "reviewReject" // reviewer sends back to fix (→Bug)
  | "cancel"; // ops cancels the card (→Cancelled)

export type BoardActor =
  | "agent" // any passported agent (claim)
  | "provider" // the lease-holding agent (submit / fixResubmit)
  | "evaluator" // QA runner (verdicts)
  | "reviewer" // reviewer passport (human approve/reject)
  | "ops"; // operator (cancel, admin moves)

/** Actor kinds allowed to perform each column action. */
export const COLUMN_ACTION_ACTOR: Record<BoardAction, BoardActor[]> = {
  claim: ["agent"],
  submit: ["provider"],
  qaFail: ["evaluator"],
  fixResubmit: ["provider"],
  qaPass: ["evaluator"],
  reviewApprove: ["reviewer"],
  reviewReject: ["reviewer"],
  cancel: ["ops"],
};

/** Allowed source columns per action — the transition matrix. */
export const COLUMN_ACTION_FROM: Record<BoardAction, BoardColumn[]> = {
  claim: ["todo"],
  submit: ["in_progress"],
  qaFail: ["testing"],
  fixResubmit: ["bug"],
  qaPass: ["testing"],
  reviewApprove: ["review"],
  reviewReject: ["review"],
  cancel: ["todo", "in_progress", "testing", "review", "bug"],
};

/** Result column per action. */
export const COLUMN_ACTION_TO: Record<BoardAction, BoardColumn> = {
  claim: "in_progress",
  submit: "testing",
  qaFail: "bug",
  fixResubmit: "testing",
  qaPass: "review",
  reviewApprove: "done",
  reviewReject: "bug",
  cancel: "cancelled",
};

/** Terminal columns — no outbound actions (reopen is sweeper-driven). */
export const TERMINAL_COLUMNS: readonly BoardColumn[] = [
  "done",
  "cancelled",
] as const;

// ─── deterministic status→column mapping ─────────────────────────

export interface DeriveColumnArgs {
  status: BountyStatus;
  /** Latest QA outcome for the active attempt (BountyOutcomeRecord). */
  outcome?: { verdict: "pass" | "fail" | "timeout" } | null;
  /** Bug-column fix-resubmit TTL (card.fixDeadlineMs). */
  fixDeadlineMs?: number;
  nowMs?: number;
}

/**
 * Column is a pure function of bounty state:
 *  open → todo · claimed → in_progress · submitted → testing
 *  submitted+qaPass → review · passed → done
 *  failed inside fix-TTL → bug · expired/rejected/stale-fail → cancelled
 * Bug→Todo after TTL is not derived here — the sweeper reopens the
 * bounty (failed→open, 199-09) and the mapping then yields todo.
 */
export function deriveColumn(args: DeriveColumnArgs): BoardColumn {
  const { status, outcome, fixDeadlineMs, nowMs = Date.now() } = args;
  switch (status) {
    case "open":
      return "todo";
    case "claimed":
      return "in_progress";
    case "submitted":
      if (outcome?.verdict === "pass") return "review";
      if (outcome?.verdict === "fail") return "bug";
      return "testing";
    case "passed":
      return "done";
    case "failed":
      return fixDeadlineMs !== undefined && nowMs < fixDeadlineMs
        ? "bug"
        : "cancelled";
    case "expired":
    case "rejected":
      return "cancelled";
  }
}

// ─── transition guard ────────────────────────────────────────────

export interface BoardTransitionCheck {
  ok: boolean;
  column: BoardColumn;
  to?: BoardColumn;
  expected?: BoardColumn[];
  reason?: string;
}

export interface AssertColumnArgs {
  column: BoardColumn;
  action: BoardAction;
  actor: { kind: BoardActor; passportId?: string };
  /** Passport that holds the claim — submit/fixResubmit require it. */
  leasePassportId?: string;
  /** fix-resubmit TTL — required for fixResubmit. */
  fixDeadlineMs?: number;
  nowMs?: number;
  /** Attempts left for fixResubmit (BOARD_MAX_ATTEMPTS gate, D-199-11). */
  attemptsLeft?: number;
}

/**
 * Validate a column move: actor gating FIRST (wrong role → reject),
 * then the source-column matrix, then action-specific rules
 * (lease-holder match, fix-TTL, attempt cap). Every board mutation
 * must pass through this before touching the store.
 */
export function assertColumnTransition(
  args: AssertColumnArgs,
): BoardTransitionCheck {
  const {
    column,
    action,
    actor,
    leasePassportId,
    fixDeadlineMs,
    nowMs = Date.now(),
    attemptsLeft,
  } = args;

  const kinds = COLUMN_ACTION_ACTOR[action];
  if (!kinds.includes(actor.kind)) {
    return {
      ok: false,
      column,
      expected: COLUMN_ACTION_FROM[action],
      reason: `actor kind "${actor.kind}" cannot ${action} (allowed: ${kinds.join(", ")})`,
    };
  }

  const from = COLUMN_ACTION_FROM[action];
  if (!from.includes(column)) {
    return {
      ok: false,
      column,
      expected: from,
      reason: `cannot ${action} a card in column "${column}"`,
    };
  }

  // Lease-holder-only actions: submit + fixResubmit require the active
  // lease passport (bountyActorAllowed provider rule).
  if (action === "submit" || action === "fixResubmit") {
    if (!leasePassportId || actor.passportId !== leasePassportId) {
      return {
        ok: false,
        column,
        expected: from,
        reason: `${action} requires the lease-holding passport`,
      };
    }
  }

  if (action === "fixResubmit") {
    if (fixDeadlineMs === undefined || nowMs >= fixDeadlineMs) {
      return {
        ok: false,
        column,
        expected: from,
        reason: "fix deadline elapsed — card reopens to todo via sweeper",
      };
    }
    if (attemptsLeft !== undefined && attemptsLeft <= 0) {
      return {
        ok: false,
        column,
        expected: from,
        reason: "attempt cap exhausted — no fix attempts left",
      };
    }
  }

  return { ok: true, column, to: COLUMN_ACTION_TO[action], expected: from };
}

// ─── lifecycle bridge ────────────────────────────────────────────

/**
 * Board action → bounty lifecycle action the engine performs.
 * `qaPass` has NO lifecycle transition: it records the outcome and the
 * card parks in review until reviewApprove fires the lifecycle "pass".
 */
export function bountyActionFor(action: BoardAction): BountyAction | null {
  switch (action) {
    case "claim":
      return "claim";
    case "submit":
      return "submit";
    case "qaFail":
      return "fail";
    case "fixResubmit":
      return "reopen";
    case "qaPass":
      return null;
    case "reviewApprove":
      return "pass";
    case "reviewReject":
      return "fail";
    case "cancel":
      return "reject";
  }
}

/** Board actor kind → bounty actor kind (reviewer acts as evaluator). */
export function bountyActorFor(actor: BoardActor): BountyActor {
  switch (actor) {
    case "reviewer":
      return "evaluator";
    default:
      return actor;
  }
}
