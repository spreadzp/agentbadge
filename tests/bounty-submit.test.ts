/**
 * SLICE-197-08: submitBounty — lease-holder guard (409 non-holder /
 * expired lease), deliverableHash(commitSha), self-reported
 * models/tokens tagged source:"self", idempotent replay.
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { decodeFunctionData, keccak256, toBytes } from "viem";

import { submitBounty, type SubmitDeps } from "../src/server/lib/bounties/submit";
import {
  listTransitions,
  resetBountyStoreForTesting,
  upsertBounty,
  upsertClaim,
  useMemoryBountyStoreForTesting,
  type BountyClaimRecord,
  type BountyRecord,
} from "../src/server/lib/bounties/store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import { ARC_TESTNET, ERC8183_ABI } from "@agentbadge/circle-payments";

const PASSPORT = "897230";
const OTHER = "111111";
const NOW = 10_000_000;
const SHA = "a".repeat(40);
const JOB = "0x80040000000000000000000000000000000000ff" as const;

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

function claim(over: Partial<BountyClaimRecord> = {}): BountyClaimRecord {
  return {
    id: "b1:1",
    bountyId: "b1",
    jobAttempt: 1,
    passportId: PASSPORT,
    payoutWallet: "0xaa",
    state: "open",
    claimedAtMs: NOW - 60_000,
    leaseUntilMs: NOW + 60_000,
    ...over,
  };
}

function deps(): SubmitDeps {
  return {
    network: () =>
      ({
        name: "testnet",
        chain: ARC_TESTNET,
        agenticCommerce: JOB,
        identityRegistry: JOB,
        reputationRegistry: JOB,
        memo: JOB,
        variant: "circle",
        abi: ERC8183_ABI,
        explorerTx: (h: string) => h,
        explorerAddr: (a: string) => a,
      }) as VenueNetwork,
    now: () => NOW,
  };
}

const req = (over: Record<string, unknown> = {}) => ({
  bountyId: "b1",
  passportId: PASSPORT,
  prUrl: "https://github.com/x/y/pull/1",
  commitSha: SHA,
  ...over,
});

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("submitBounty", () => {
  it("happy path: consumed claim, submitted bounty, deliverable + submitTx", async () => {
    upsertBounty(bounty());
    upsertClaim(claim());
    const r = await submitBounty(
      req({ models: ["gpt-5"], tokens: 4200 }),
      deps(),
    );
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.bounty.status).toBe("submitted");
    expect(r.claim.state).toBe("consumed");
    expect(r.deliverable).toBe(keccak256(toBytes(SHA)));
    // Self-reported marked (Q23); duration is server-side.
    expect(r.submission.source).toBe("self");
    expect(r.submission.models).toEqual(["gpt-5"]);
    expect(r.submission.tokens).toBe(4200);
    expect(r.submission.submitDurationMs).toBe(60_000);
    // submit(jobId, deliverable, 0x) calldata for agent self-sign.
    expect(r.submitTx?.to).toBe(JOB);
    const dec = decodeFunctionData({
      abi: ERC8183_ABI,
      data: r.submitTx!.data,
    });
    expect(dec.functionName).toBe("submit");
    expect(dec.args[0]).toBe(42n);
    expect(dec.args[1]).toBe(keccak256(toBytes(SHA)));
    const tr = listTransitions("b1");
    expect(tr.at(-1)?.to).toBe("submitted");
    expect(tr.at(-1)?.actor).toBe(PASSPORT);
  });

  it("409: submit by a passport that is not the lease holder", async () => {
    upsertBounty(bounty());
    upsertClaim(claim());
    const r = await submitBounty(req({ passportId: OTHER }), deps());
    expect(r).toMatchObject({ ok: false, status: 409,
      code: "bounty_not_holder" });
  });

  it("409: submit after lease expiry (state open, leaseUntil < now)", async () => {
    upsertBounty(bounty());
    upsertClaim(claim({ leaseUntilMs: NOW - 1 }));
    const r = await submitBounty(req(), deps());
    expect(r).toMatchObject({ ok: false, status: 409,
      code: "bounty_lease_expired" });
  });

  it("409: claim already swept (state expired)", async () => {
    upsertBounty(bounty());
    upsertClaim(claim({ state: "expired" }));
    const r = await submitBounty(req(), deps());
    expect(r).toMatchObject({ ok: false, status: 409,
      code: "bounty_lease_expired" });
  });

  it("409: no claim row for this attempt (non-holder/no lease)", async () => {
    upsertBounty(bounty());
    const r = await submitBounty(req(), deps());
    expect(r).toMatchObject({ ok: false, status: 409,
      code: "bounty_not_holder" });
  });

  it("409: bounty not in 'claimed' state", async () => {
    upsertBounty(bounty({ status: "open" }));
    const r = await submitBounty(req(), deps());
    expect(r).toMatchObject({ ok: false, status: 409, code: "INVALID_STATE" });
  });

  it("404: unknown bountyId", async () => {
    const r = await submitBounty(req(), deps());
    expect(r).toMatchObject({ ok: false, status: 404 });
  });

  it("idempotent: same commitSha replay returns stored result, no dup", async () => {
    upsertBounty(bounty());
    upsertClaim(claim());
    const first = await submitBounty(req({ models: ["m1"] }), deps());
    expect(first.ok).toBe(true);
    const again = await submitBounty(req({ models: ["m2"], tokens: 9 }),
      deps());
    expect(again.ok).toBe(true);
    if (!again.ok) return;
    expect(again.idempotent).toBe(true);
    // Stored payload wins — second call's fields are ignored.
    expect(again.submission.models).toEqual(["m1"]);
    expect(again.submission.tokens).toBeUndefined();
    // No dup transitions/outcomes.
    expect(listTransitions("b1").filter((t) => t.to === "submitted"))
      .toHaveLength(1);
    // No submitTx on replay — claim already consumed.
    expect(again.submitTx).toBeUndefined();
  });

  it("409: consumed claim with a DIFFERENT sha is not replayed", async () => {
    upsertBounty(bounty());
    upsertClaim(claim());
    await submitBounty(req(), deps());
    const r = await submitBounty(req({ commitSha: "b".repeat(40) }), deps());
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.status).toBe(409);
  });

  it("400: missing fields / bad sha / bad url / bad tokens", async () => {
    upsertBounty(bounty());
    upsertClaim(claim());
    for (const bad of [
      req({ prUrl: "" }),
      req({ commitSha: "" }),
      req({ commitSha: "not-hex!" }),
      req({ prUrl: "ftp://x" }),
      req({ tokens: -5 }),
      req({ tokens: 1.5 }),
    ]) {
      const r = await submitBounty(bad, deps());
      expect(r.ok).toBe(false);
      if (r.ok) return;
      expect(r.status).toBe(400);
    }
  });

  it("no onchainJobId → submitTx undefined but submit succeeds", async () => {
    upsertBounty(bounty({ onchainJobId: undefined }));
    upsertClaim(claim());
    const r = await submitBounty(req(), deps());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.submitTx).toBeUndefined();
    expect(r.bounty.status).toBe("submitted");
  });
});
