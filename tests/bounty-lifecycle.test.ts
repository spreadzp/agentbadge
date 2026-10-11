/**
 * SLICE-197-03 tests: bounty lifecycle state matrix.
 *
 * Covered (per slice acceptance):
 *  - all valid transitions pass; every invalid one → explicit error
 *  - re-claim cap: reopen allowed while attempts remain, denied at 0
 *  - actor rules: claim = any passported agent, submit = lease holder only,
 *    verdicts = evaluator only, expire = sweeper, reject = evaluator|ops
 *  - terminal states (passed|rejected) accept no further actions
 */
import { describe, expect, it } from "vitest";

import {
  ACTION_ACTOR,
  assertBountyTransition,
  ATTEMPT_TERMINAL,
  bountyActorAllowed,
  RESULT_STATUS,
  TERMINAL_STATUSES,
  type BountyAction,
  type BountyStatus,
} from "../src/server/lib/bounties/lifecycle";

const ALL_STATUSES: BountyStatus[] = [
  "open",
  "claimed",
  "submitted",
  "passed",
  "failed",
  "expired",
  "rejected",
];
const ALL_ACTIONS = Object.keys(ACTION_ACTOR) as BountyAction[];

describe("assertBountyTransition — valid paths", () => {
  it.each([
    ["open", "claim", "claimed"],
    ["claimed", "submit", "submitted"],
    ["submitted", "pass", "passed"],
    ["submitted", "fail", "failed"],
    ["claimed", "expire", "expired"],
    ["failed", "reopen", "open"],
    ["expired", "reopen", "open"],
    ["open", "reject", "rejected"],
    ["claimed", "reject", "rejected"],
    ["submitted", "reject", "rejected"],
  ] as const)("%s --%s--> %s", (from, action, to) => {
    const r = assertBountyTransition(from, action, 1);
    expect(r.ok).toBe(true);
    expect(r.to).toBe(to);
    expect(RESULT_STATUS[action]).toBe(to);
  });
});

describe("assertBountyTransition — invalid paths", () => {
  it("every non-allowed transition is denied with a reason", () => {
    for (const from of ALL_STATUSES) {
      for (const action of ALL_ACTIONS) {
        const r = assertBountyTransition(from, action);
        if (r.ok) continue;
        expect(r.reason).toMatch(new RegExp(`cannot ${action}`));
        expect(r.expected).toBeDefined();
      }
    }
  });

  it.each(["passed", "rejected"] as const)(
    "terminal %s accepts no action",
    (status) => {
      for (const action of ALL_ACTIONS) {
        expect(assertBountyTransition(status, action).ok).toBe(false);
      }
    },
  );

  it("expire cannot fire on submitted work", () => {
    expect(assertBountyTransition("submitted", "expire").ok).toBe(false);
  });

  it("reopen requires an attempt-terminal state", () => {
    expect(assertBountyTransition("open", "reopen").ok).toBe(false);
    expect(assertBountyTransition("claimed", "reopen").ok).toBe(false);
    expect(assertBountyTransition("submitted", "reopen").ok).toBe(false);
  });
});

describe("re-claim cap (Q38-A: one job = one attempt)", () => {
  it("reopen ok with attemptsLeft>0, denied at 0", () => {
    expect(assertBountyTransition("failed", "reopen", 1).ok).toBe(true);
    const denied = assertBountyTransition("failed", "reopen", 0);
    expect(denied.ok).toBe(false);
    expect(denied.reason).toMatch(/cap exhausted/);
  });
});

describe("bountyActorAllowed", () => {
  it("claim accepts any passported agent", () => {
    expect(
      bountyActorAllowed("claim", { kind: "agent", passportId: "p-1" }).ok,
    ).toBe(true);
  });

  it("claim rejects non-agent actors", () => {
    expect(bountyActorAllowed("claim", { kind: "ops" }).ok).toBe(false);
    expect(bountyActorAllowed("claim", { kind: "evaluator" }).ok).toBe(false);
  });

  it("submit requires the lease-holding passport", () => {
    expect(
      bountyActorAllowed(
        "submit",
        { kind: "provider", passportId: "p-1" },
        "p-1",
      ).ok,
    ).toBe(true);
    // wrong passport → denied (acceptance: submit не от держателя лизы)
    expect(
      bountyActorAllowed(
        "submit",
        { kind: "provider", passportId: "p-2" },
        "p-1",
      ).ok,
    ).toBe(false);
    // no lease holder recorded → denied
    expect(
      bountyActorAllowed("submit", { kind: "provider", passportId: "p-1" })
        .ok,
    ).toBe(false);
    // non-provider kind cannot submit at all
    expect(
      bountyActorAllowed(
        "submit",
        { kind: "agent", passportId: "p-1" },
        "p-1",
      ).ok,
    ).toBe(false);
  });

  it("verdicts are evaluator-only", () => {
    for (const a of ["pass", "fail"] as const) {
      expect(bountyActorAllowed(a, { kind: "evaluator" }).ok).toBe(true);
      expect(bountyActorAllowed(a, { kind: "agent" }).ok).toBe(false);
      expect(bountyActorAllowed(a, { kind: "ops" }).ok).toBe(false);
    }
  });

  it("expire runs under sweeper or ops only", () => {
    expect(bountyActorAllowed("expire", { kind: "sweeper" }).ok).toBe(true);
    expect(bountyActorAllowed("expire", { kind: "ops" }).ok).toBe(true);
    expect(bountyActorAllowed("expire", { kind: "agent" }).ok).toBe(false);
  });

  it("reject allows evaluator and ops", () => {
    expect(bountyActorAllowed("reject", { kind: "evaluator" }).ok).toBe(true);
    expect(bountyActorAllowed("reject", { kind: "ops" }).ok).toBe(true);
    expect(bountyActorAllowed("reject", { kind: "agent" }).ok).toBe(false);
  });
});

describe("status sets", () => {
  it("terminal and attempt-terminal sets are disjoint and complete", () => {
    for (const s of TERMINAL_STATUSES) {
      expect(ALL_STATUSES).toContain(s);
      expect(ATTEMPT_TERMINAL).not.toContain(s);
    }
    expect(ATTEMPT_TERMINAL).toEqual(["failed", "expired"]);
  });
});
