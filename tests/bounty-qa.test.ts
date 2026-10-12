/**
 * SLICE-197-09: QA runner — runnerEnv has no server secrets,
 * sha_not_in_pr FAIL, timeout → FAIL qa_timeout, pass/fail outcomes
 * recorded once (idempotent sweep).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  evaluateBountyQa,
  qaSweep,
  type QaDeps,
} from "../src/server/lib/bounties/qa";
import { runnerEnv } from "../src/server/lib/bounties/qa-run";
import {
  getOutcome,
  listTransitions,
  resetBountyStoreForTesting,
  upsertBounty,
  upsertClaim,
  useMemoryBountyStoreForTesting,
  type BountyClaimRecord,
  type BountyRecord,
} from "../src/server/lib/bounties/store";

const PASSPORT = "897230";
const NOW = 10_000_000;
const SHA = "abc1234";
const PR = "https://github.com/acme/widget/pull/7";

function bounty(over: Partial<BountyRecord> = {}): BountyRecord {
  return {
    bountyId: "b1",
    title: "t",
    brief: { criteria: ["c"], deliverableType: "pr" },
    budgetUsdc: "5",
    status: "submitted",
    onchainJobId: "42",
    jobAttempt: 1,
    createdAt: new Date(NOW - 10_000).toISOString(),
    ...over,
  };
}

function claimed(over: Partial<BountyClaimRecord> = {}): BountyClaimRecord {
  return {
    id: "b1:1",
    bountyId: "b1",
    jobAttempt: 1,
    passportId: PASSPORT,
    payoutWallet: "0xaa",
    state: "consumed",
    claimedAtMs: NOW - 60_000,
    leaseUntilMs: NOW + 60_000,
    payload: {
      submission: {
        prUrl: PR,
        commitSha: SHA,
        source: "self",
        submittedAtMs: NOW - 5_000,
        submitDurationMs: 55_000,
      },
    },
    ...over,
  };
}

function deps(over: Partial<QaDeps> = {}): QaDeps {
  return {
    now: () => NOW,
    fetchPrCommits: () => Promise.resolve([SHA, "def5678"]),
    runChecks: () =>
      Promise.resolve({ checks: [], reasonCodes: [] }),
    workdirRoot: () => "/tmp/qa-test",
    ...over,
  };
}

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("runnerEnv (security)", () => {
  it("whitelist only — no server secrets leak to untrusted code", () => {
    process.env.ADMIN_API_KEY = "super-secret-key";
    process.env.TELEGRAM_BOT_TOKEN = "bot-token";
    process.env.AWS_SECRET_ACCESS_KEY = "aws";
    process.env.SSH_AUTH_SOCK = "/tmp/ssh-agent";
    const env = runnerEnv("/tmp/scratch");
    const keys = Object.keys(env);
    expect(keys).toContain("PATH");
    expect(env.HOME).toBe("/tmp/scratch");
    expect(env.TMPDIR).toBe("/tmp/scratch");
    // No sensitive variables pass through.
    const dangerous = /key|secret|token|pass|auth|cred/i;
    for (const [k, v] of Object.entries(env)) {
      expect(dangerous.test(k)).toBe(false);
      expect(v).not.toContain("super-secret-key");
      expect(v).not.toContain("bot-token");
    }
    delete process.env.ADMIN_API_KEY;
  });
});

describe("evaluateBountyQa", () => {
  it("sha_not_in_pr → FAIL, no checks run", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    let ran = false;
    const v = await evaluateBountyQa(bounty(), deps({
      fetchPrCommits: () => Promise.resolve(["other999"]),
      runChecks: () => {
        ran = true;
        return Promise.resolve({ checks: [], reasonCodes: [] });
      },
    }));
    expect(ran).toBe(false);
    expect(v?.verdict).toBe("fail");
    expect(v?.reasonCodes).toContain("sha_not_in_pr");
  });

  it("unreadable PR API → FAIL pr_unreadable", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    const v = await evaluateBountyQa(bounty(), deps({
      fetchPrCommits: () => Promise.resolve(null),
    }));
    expect(v?.verdict).toBe("fail");
    expect(v?.reasonCodes).toContain("pr_unreadable");
  });

  it("bad prUrl → FAIL (repoFromPrUrl null)", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed({
      payload: { submission: { prUrl: "notaurl", commitSha: SHA } },
    }));
    const v = await evaluateBountyQa(bounty(), deps());
    expect(v?.verdict).toBe("fail");
  });

  it("check failure reasonCode → FAIL propagates", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    const v = await evaluateBountyQa(bounty(), deps({
      runChecks: () =>
        Promise.resolve({
          checks: [{ name: "test", ok: false, result: "fail" as const }],
          reasonCodes: ["qa_test_failed"],
        }),
    }));
    expect(v?.verdict).toBe("fail");
    expect(v?.reasonCodes).toContain("qa_test_failed");
  });

  it("pass verdict: checks empty, reasonCodes empty", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    const v = await evaluateBountyQa(bounty(), deps());
    expect(v?.verdict).toBe("pass");
    expect(v?.reasonCodes).toEqual([]);
    expect(v?.commitSha).toBe(SHA);
    expect(v?.checks[0].name).toBe("sha_in_pr");
  });
});

describe("qaSweep", () => {
  it("disabled by default (explicit BOUNTY_QA_RUNNER_ENABLED=true)", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    delete process.env.BOUNTY_QA_RUNNER_ENABLED;
    const r = await qaSweep(deps());
    expect(r.skipped).toBe(true);
    expect(r.evaluated).toBe(0);
  });

  it("pass verdict → outcome pass + submitted→passed transition", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    const r = await qaSweep({ ...deps(), enabled: true });
    expect(r.evaluated).toBe(1);
    expect(r.passed).toBe(1);
    const o = getOutcome("b1", 1);
    expect(o?.verdict).toBe("pass");
    expect(o?.commitSha).toBe(SHA);
    expect((o?.payload as { source?: string })?.source).toBe("qa-runner");
    const b = (await import("../src/server/lib/bounties/store"))
      .getBounty("b1");
    expect(b?.status).toBe("passed");
    expect(listTransitions("b1").at(-1)?.actor).toBe("evaluator");
  });

  it("fail verdict → outcome fail + submitted→failed transition", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    const r = await qaSweep({
      ...deps(),
      enabled: true,
      runChecks: () =>
        Promise.resolve({
          checks: [{ name: "build", ok: false, result: "fail" as const }],
          reasonCodes: ["qa_build_failed"],
        }),
    });
    expect(r.evaluated).toBe(1);
    expect(r.failed).toBe(1);
    const o = getOutcome("b1", 1);
    expect(o?.verdict).toBe("fail");
    expect(o?.reasonCodes).toContain("qa_build_failed");
  });

  it("idempotent: outcome exists → not re-evaluated", async () => {
    upsertBounty(bounty());
    upsertClaim(claimed());
    const first = await qaSweep({ ...deps(), enabled: true });
    expect(first.evaluated).toBe(1);
    let called = false;
    const second = await qaSweep({
      ...deps(),
      enabled: true,
      fetchPrCommits: () => {
        called = true;
        return Promise.resolve([SHA]);
      },
    });
    expect(called).toBe(false);
    expect(second.evaluated).toBe(0);
  });
});
