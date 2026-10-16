/**
 * SLICE-199-06 (EPIC-199): column state machine — the deterministic
 * mapping from bounty lifecycle (status/outcome/lease/fixDeadline) to the
 * 7 kanban columns, plus the action matrix with actor gating.
 *
 * Acceptance:
 *  - every column maps deterministically from (status, outcome, lease,
 *    fixDeadline);
 *  - the transition matrix covers all 8 actions + negative cases;
 *  - no path bypasses the lifecycle — every action goes through
 *    assertColumnTransition + bountyActorAllowed-compatible gating.
 */
import { describe, expect, it } from "vitest";

import {
  assertColumnTransition,
  bountyActionFor,
  bountyActorFor,
  COLUMN_ACTION_TO,
  deriveColumn,
  type BoardAction,
  type BoardActor,
} from "../src/server/lib/board/columns";
import type { BoardColumn } from "../src/server/lib/board/types";
import type { BountyStatus } from "../src/server/lib/bounties/lifecycle";

const NOW = 1_700_000_000_000;

describe("deriveColumn — deterministic status→column mapping", () => {
  const cases: [BountyStatus, Partial<Parameters<typeof deriveColumn>[0]>, BoardColumn][] = [
    ["open", {}, "todo"],
    ["claimed", {}, "in_progress"],
    ["submitted", {}, "testing"],
    ["submitted", { outcome: { verdict: "pass" } }, "review"],
    ["submitted", { outcome: { verdict: "fail" } }, "bug"],
    ["passed", {}, "done"],
    ["failed", { fixDeadlineMs: NOW + 60_000, nowMs: NOW }, "bug"],
    ["failed", { fixDeadlineMs: NOW - 1, nowMs: NOW }, "cancelled"],
    ["failed", { nowMs: NOW }, "cancelled"],
    ["expired", {}, "cancelled"],
    ["rejected", {}, "cancelled"],
  ];
  for (const [status, extra, column] of cases) {
    it(`${status} ${JSON.stringify(extra)} → ${column}`, () => {
      expect(deriveColumn({ status, ...extra })).toBe(column);
    });
  }
});

describe("assertColumnTransition — full action matrix", () => {
  const agent = { kind: "agent", passportId: "ps_a" } as const;
  const provider = { kind: "provider", passportId: "ps_b" } as const;
  const evaluator = { kind: "evaluator" } as const;
  const reviewer = { kind: "reviewer", passportId: "ps_rev" } as const;
  const ops = { kind: "ops" } as const;

  // [action, allowedColumn, resultColumn]
  const matrix: [BoardAction, BoardColumn, BoardColumn, BoardActor][] = [
    ["claim", "todo", "in_progress", "agent"],
    ["submit", "in_progress", "testing", "provider"],
    ["qaFail", "testing", "bug", "evaluator"],
    ["fixResubmit", "bug", "testing", "provider"],
    ["qaPass", "testing", "review", "evaluator"],
    ["reviewApprove", "review", "done", "reviewer"],
    ["reviewReject", "review", "bug", "reviewer"],
  ];

  for (const [action, from, to, actorKind] of matrix) {
    it(`${action}: ${from} → ${to} (actor ${actorKind})`, () => {
      const actor =
        action === "claim"
          ? agent
          : action === "submit" || action === "fixResubmit"
            ? provider
            : action === "qaFail" || action === "qaPass"
              ? evaluator
              : reviewer;
      const r = assertColumnTransition({
        column: from,
        action,
        actor: { ...actor },
        leasePassportId: "ps_b",
        fixDeadlineMs: NOW + 60_000,
        nowMs: NOW,
        attemptsLeft: 2,
      });
      expect(r.ok).toBe(true);
      expect(r.to).toBe(to);
      expect(COLUMN_ACTION_TO[action]).toBe(to);
    });
  }

  it("cancel: any non-terminal column → cancelled (ops)", () => {
    for (const column of [
      "todo",
      "in_progress",
      "testing",
      "review",
      "bug",
    ] as BoardColumn[]) {
      const r = assertColumnTransition({ column, action: "cancel", actor: { ...ops } });
      expect(r.ok).toBe(true);
      expect(r.to).toBe("cancelled");
    }
  });

  // ─── negatives: wrong source column ──────────────────────────
  const allColumns: BoardColumn[] = [
    "todo",
    "in_progress",
    "testing",
    "review",
    "done",
    "bug",
    "cancelled",
  ];
  const allowedFrom: Record<BoardAction, BoardColumn[]> = {
    claim: ["todo"],
    submit: ["in_progress"],
    qaFail: ["testing"],
    fixResubmit: ["bug"],
    qaPass: ["testing"],
    reviewApprove: ["review"],
    reviewReject: ["review"],
    cancel: ["todo", "in_progress", "testing", "review", "bug"],
  };
  for (const [action, allowed] of Object.entries(allowedFrom) as [
    BoardAction,
    BoardColumn[],
  ][]) {
    for (const column of allColumns.filter((c) => !allowed.includes(c))) {
      it(`rejects ${action} from ${column}`, () => {
        const r = assertColumnTransition({
          column,
          action,
          actor: { kind: "ops" },
          fixDeadlineMs: NOW + 60_000,
          nowMs: NOW,
          attemptsLeft: 3,
        });
        expect(r.ok).toBe(false);
        expect(r.reason).toContain(action);
      });
    }
  }

  // ─── actor gating negatives ──────────────────────────────────
  it("claim requires a passported agent", () => {
    for (const kind of ["provider", "evaluator", "reviewer", "ops"] as BoardActor[]) {
      const r = assertColumnTransition({
        column: "todo",
        action: "claim",
        actor: { kind, passportId: "ps_x" },
      });
      expect(r.ok).toBe(false);
    }
  });

  it("submit requires the lease-holding passport", () => {
    // wrong passport
    expect(
      assertColumnTransition({
        column: "in_progress",
        action: "submit",
        actor: { ...agent, passportId: "ps_wrong" },
        leasePassportId: "ps_b",
      }).ok,
    ).toBe(false);
    // non-provider kind even with the right passport
    expect(
      assertColumnTransition({
        column: "in_progress",
        action: "submit",
        actor: { ...ops },
        leasePassportId: "ps_b",
      }).ok,
    ).toBe(false);
  });

  it("qa verdicts require the evaluator actor", () => {
    for (const action of ["qaFail", "qaPass"] as BoardAction[]) {
      const r = assertColumnTransition({
        column: "testing",
        action,
        actor: { ...agent },
      });
      expect(r.ok).toBe(false);
    }
  });

  it("review actions require the reviewer actor", () => {
    for (const action of ["reviewApprove", "reviewReject"] as BoardAction[]) {
      for (const kind of ["agent", "provider", "evaluator"] as BoardActor[]) {
        const r = assertColumnTransition({
          column: "review",
          action,
          actor: { kind, passportId: "ps_x" },
        });
        expect(r.ok).toBe(false);
      }
    }
  });

  it("cancel requires ops", () => {
    for (const kind of ["agent", "provider", "evaluator", "reviewer"] as BoardActor[]) {
      const r = assertColumnTransition({
        column: "todo",
        action: "cancel",
        actor: { kind, passportId: "ps_x" },
      });
      expect(r.ok).toBe(false);
    }
  });

  // ─── fixResubmit specifics: fix-TTL + attempt cap ────────────
  it("fixResubmit rejected after fix deadline", () => {
    const r = assertColumnTransition({
      column: "bug",
      action: "fixResubmit",
      actor: { ...provider },
      leasePassportId: "ps_b",
      fixDeadlineMs: NOW - 1,
      nowMs: NOW,
      attemptsLeft: 2,
    });
    expect(r.ok).toBe(false);
  });

  it("fixResubmit rejected when attempt cap exhausted", () => {
    const r = assertColumnTransition({
      column: "bug",
      action: "fixResubmit",
      actor: { ...provider },
      leasePassportId: "ps_b",
      fixDeadlineMs: NOW + 60_000,
      nowMs: NOW,
      attemptsLeft: 0,
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/attempt/i);
  });

  it("fixResubmit requires the same provider that held the lease", () => {
    const r = assertColumnTransition({
      column: "bug",
      action: "fixResubmit",
      actor: { kind: "provider", passportId: "ps_other" },
      leasePassportId: "ps_b",
      fixDeadlineMs: NOW + 60_000,
      nowMs: NOW,
      attemptsLeft: 2,
    });
    expect(r.ok).toBe(false);
  });

  // ─── lifecycle bridge ────────────────────────────────────────
  it("maps board actions to bounty lifecycle actions (qaPass has none)", () => {
    expect(bountyActionFor("claim")).toBe("claim");
    expect(bountyActionFor("submit")).toBe("submit");
    expect(bountyActionFor("qaFail")).toBe("fail");
    expect(bountyActionFor("fixResubmit")).toBe("reopen");
    expect(bountyActionFor("qaPass")).toBeNull();
    expect(bountyActionFor("reviewApprove")).toBe("pass");
    expect(bountyActionFor("reviewReject")).toBe("fail");
    expect(bountyActionFor("cancel")).toBe("reject");
  });

  it("maps board actor kinds to bounty actor kinds", () => {
    expect(bountyActorFor("agent")).toBe("agent");
    expect(bountyActorFor("provider")).toBe("provider");
    expect(bountyActorFor("evaluator")).toBe("evaluator");
    expect(bountyActorFor("reviewer")).toBe("evaluator");
    expect(bountyActorFor("ops")).toBe("ops");
  });
});
