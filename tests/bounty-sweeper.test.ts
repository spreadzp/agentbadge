/**
 * SLICE-197-07: bounty lease sweeper — expired lease → reject +
 * reopen on new job; Open-state client reject edge; idempotency;
 * env gate; cap exhaustion; no-claim alert.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  sweepBountyLeases,
  type SweepDeps,
} from "../src/server/services/bounty-lease-sweeper";
import {
  getBounty,
  getClaim,
  getOutcome,
  listTransitions,
  putOutcome,
  resetBountyStoreForTesting,
  upsertBounty,
  upsertClaim,
  useMemoryBountyStoreForTesting,
  type BountyClaimRecord,
  type BountyRecord,
} from "../src/server/lib/bounties/store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import {
  ARC_TESTNET,
  ERC8183_ABI,
} from "@agentbadge/circle-payments";
import type { VenueRole } from "../src/server/lib/venue/lifecycle-sign";

const PASSPORT = "897230";
const NOW = 10_000_000;

function net(): VenueNetwork {
  return {
    name: "testnet",
    chain: ARC_TESTNET,
    agenticCommerce: "0x80040000000000000000000000000000000000ff",
    identityRegistry: "0x80040000000000000000000000000000000000ff",
    reputationRegistry: "0x80040000000000000000000000000000000000ff",
    memo: "0x80040000000000000000000000000000000000ff",
    variant: "circle",
    abi: ERC8183_ABI,
    explorerTx: (h) => h,
    explorerAddr: (a) => a,
  } as VenueNetwork;
}

function bounty(over: Partial<BountyRecord> = {}): BountyRecord {
  return {
    bountyId: "b1",
    title: "t",
    brief: { criteria: ["c"], deliverableType: "pr" },
    budgetUsdc: "5",
    status: "claimed",
    onchainJobId: "42",
    jobAttempt: 1,
    createdAt: new Date(NOW - 10_000).toISOString(),
    ...over,
  };
}

function lease(over: Partial<BountyClaimRecord> = {}): BountyClaimRecord {
  return {
    id: "b1:1",
    bountyId: "b1",
    jobAttempt: 1,
    passportId: PASSPORT,
    payoutWallet: "0xaa",
    state: "open",
    claimedAtMs: NOW - 8_000_000,
    leaseUntilMs: NOW - 1_000, // already expired
    ...over,
  };
}

const silent: SweepDeps["alert"] = () => Promise.resolve();

function deps(over: Partial<SweepDeps> = {}): SweepDeps {
  return {
    enabled: true,
    now: () => NOW,
    network: net,
    fetchJob: () => Promise.resolve({ status: 1 } as never), // funded
    sendRole: () => Promise.resolve([`0x${"cd".repeat(32)}`]),
    fetchJobId: () => Promise.resolve(77),
    alert: silent,
    ...over,
  };
}

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("sweepBountyLeases", () => {
  it("expired lease → evaluator reject (funded) + reopen on new job", async () => {
    upsertBounty(bounty());
    upsertClaim(lease());
    const roles: VenueRole[] = [];
    const r = await sweepBountyLeases(
      deps({
        fetchJob: () => Promise.resolve({ status: 1 } as never), // funded
        sendRole: (role) => {
          roles.push(role);
          return Promise.resolve([`0x${"cd".repeat(32)}`]);
        },
      }),
    );
    expect(r.expired).toBe(1);
    expect(r.reopened).toBe(1);
    const b = getBounty("b1")!;
    expect(b.status).toBe("open");
    expect(b.jobAttempt).toBe(2);
    // 197-19 e2e: circle createJob needs provider!=0x0 — job is created
    // lazily on the next claim, so reopen leaves onchainJobId unset.
    expect(b.onchainJobId).toBeUndefined();
    expect(getClaim("b1", 1)?.state).toBe("expired");
    expect(getOutcome("b1", 1)?.verdict).toBe("timeout");
    const txs = listTransitions("b1").map((t) => t.to);
    expect(txs).toEqual(["expired", "open"]);
    // reject only (evaluator for funded) — no eager createJob on circle
    expect(roles).toEqual(["evaluator"]);
  });

  it("QA-failed bounty + anchored reject → reopen on new job", async () => {
    upsertBounty(bounty({ status: "failed" }));
    putOutcome({
      id: "b1:1", bountyId: "b1", jobAttempt: 1, passportId: PASSPORT,
      verdict: "fail", reasonCodes: ["qa_fail"],
      verdictMemoTx: "0x" + "aa".repeat(32) as `0x${string}`,
      verdictRejectTx: "0x" + "bb".repeat(32) as `0x${string}`,
    });
    const sends: VenueRole[] = [];
    const r = await sweepBountyLeases(deps({
      sendRole: (role) => {
        sends.push(role);
        return Promise.resolve([`0x${"cd".repeat(32)}`]);
      },
    }));
    expect(r.reopened).toBe(1);
    const b = getBounty("b1")!;
    expect(b.status).toBe("open");
    expect(b.jobAttempt).toBe(2);
    expect(b.onchainJobId).toBeUndefined(); // circle: lazy createJob at claim
    expect(sends).toHaveLength(0); // no reject (already anchored), no createJob
  });

  it("QA-failed bounty WITHOUT anchored reject → stays failed (M-3)", async () => {
    upsertBounty(bounty({ status: "failed" }));
    putOutcome({
      id: "b1:1", bountyId: "b1", jobAttempt: 1, passportId: PASSPORT,
      verdict: "fail", reasonCodes: ["qa_fail"],
    });
    const r = await sweepBountyLeases(deps());
    expect(r.reopened).toBe(0);
    expect(getBounty("b1")!.status).toBe("failed");
  });

  it("edge: onchain Open → client rejects, not evaluator", async () => {
    upsertBounty(bounty());
    upsertClaim(lease());
    const roles: VenueRole[] = [];
    await sweepBountyLeases(
      deps({
        fetchJob: () => Promise.resolve({ status: 0 } as never), // open
        sendRole: (role) => {
          roles.push(role);
          return Promise.resolve([`0x${"ab".repeat(32)}`]);
        },
      }),
    );
    expect(roles[0]).toBe("client");
  });

  it("idempotent: second tick finds no open lease", async () => {
    upsertBounty(bounty());
    upsertClaim(lease());
    const sends: VenueRole[] = [];
    const d = deps({
      sendRole: (role) => {
        sends.push(role);
        return Promise.resolve([`0x${"cd".repeat(32)}`]);
      },
    });
    await sweepBountyLeases(d);
    const r2 = await sweepBountyLeases(d);
    expect(r2.expired).toBe(0);
    // only first tick sent txs (reject; circle: no eager createJob)
    expect(sends).toHaveLength(1);
  });

  it("BOUNTY_SWEEPER_ENABLED=false → skipped", async () => {
    upsertBounty(bounty());
    upsertClaim(lease());
    const r = await sweepBountyLeases({ enabled: false });
    expect(r.skipped).toBe(true);
    expect(r.expired).toBe(0);
    expect(getClaim("b1", 1)?.state).toBe("open");
  });

  it("cap exhausted → bounty stays expired, no createJob", async () => {
    upsertBounty(bounty({ jobAttempt: 2 })); // cap = 2 by default
    upsertClaim(lease({ jobAttempt: 2, id: "b1:2" }));
    const sends: VenueRole[] = [];
    const alerts: string[] = [];
    const r = await sweepBountyLeases(
      deps({
        sendRole: (role) => {
          sends.push(role);
          return Promise.resolve([`0x${"cd".repeat(32)}`]);
        },
        alert: (m) => { alerts.push(m); return Promise.resolve(); },
      }),
    );
    expect(r.expired).toBe(1);
    expect(r.reopened).toBe(0);
    expect(getBounty("b1")!.status).toBe("expired");
    expect(getBounty("b1")!.jobAttempt).toBe(2);
    // reject sent, but NO createJob (client) — only 1 tx call
    expect(sends).toEqual(["evaluator"]);
    expect(alerts[0]).toContain("cap exhausted");
  });

  it("open bounty > TTL without claim → alert once (dedupe)", async () => {
    upsertBounty(
      bounty({
        status: "open",
        jobAttempt: 1,
        createdAt: new Date(NOW - 3 * 3_600_000).toISOString(), // 3h ago
      }),
    );
    const alerts: string[] = [];
    const d = deps({ alert: (m) => { alerts.push(m); return Promise.resolve(); } });
    const r1 = await sweepBountyLeases(d);
    expect(r1.noClaimAlerts).toBe(1);
    expect(alerts[0]).toContain("without claim");
    const r2 = await sweepBountyLeases(d);
    expect(r2.noClaimAlerts).toBe(0);
  });
});
