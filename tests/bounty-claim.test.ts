/**
 * SLICE-197-06: claimBounty — passport gate, double-claim 409,
 * cooldown, re-claim cap, EIP-191 payout bind, variant-aware provider
 * bind (acp setProvider ops-send / circle setBudget self-sign).
 */
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  claimBounty,
  claimMessage,
  type ClaimDeps,
} from "../src/server/lib/bounties/claim";
import {
  resetBountyStoreForTesting,
  upsertBounty,
  useMemoryBountyStoreForTesting,
  type BountyRecord,
} from "../src/server/lib/bounties/store";
import type { VenueNetwork } from "../src/server/lib/venue/chain";
import {
  ARC_MAINNET,
  ARC_TESTNET,
  ERC8183_ABI,
  ERC8183_ACP_ABI,
} from "@agentbadge/circle-payments";

const PASSPORT = "897230";
const PAYOUT = "0x00000000000000000000000000000000000000aa" as const;
const PAYOUT_B = "0x00000000000000000000000000000000000000bb" as const;
const JOB = "0x80040000000000000000000000000000000000ff" as const;

function bounty(over: Partial<BountyRecord> = {}): BountyRecord {
  return {
    bountyId: "b1",
    title: "t",
    brief: { criteria: ["c"], deliverableType: "pr" },
    budgetUsdc: "5",
    status: "open",
    onchainJobId: "42",
    jobAttempt: 1,
    createdAt: new Date().toISOString(),
    ...over,
  };
}

function net(variant: "circle" | "acp"): VenueNetwork {
  return {
    name: variant === "acp" ? "mainnet" : "testnet",
    chain: variant === "acp" ? ARC_MAINNET : ARC_TESTNET,
    agenticCommerce: JOB,
    identityRegistry: JOB,
    reputationRegistry: JOB,
    memo: JOB,
    variant,
    abi: variant === "acp" ? ERC8183_ACP_ABI : ERC8183_ABI,
    explorerTx: (h) => h,
    explorerAddr: (a) => a,
  } as VenueNetwork;
}

const sigOk: ClaimDeps["verifyPayoutSig"] = () => Promise.resolve(true);
const sigBad: ClaimDeps["verifyPayoutSig"] = () => Promise.resolve(false);

function req(over: Partial<Parameters<typeof claimBounty>[0]> = {}) {
  return {
    bountyId: "b1",
    passportId: PASSPORT,
    payoutWallet: PAYOUT,
    claimSig: "0x" + "ab".repeat(65),
    ...over,
  } as Parameters<typeof claimBounty>[0];
}

beforeEach(() => useMemoryBountyStoreForTesting());
afterEach(() => resetBountyStoreForTesting());

describe("claimBounty", () => {
  it("circle: claim → lease + setBudget calldata for payout wallet", async () => {
    upsertBounty(bounty());
    const r = await claimBounty(req(), {
      network: () => net("circle"),
      verifyPayoutSig: sigOk,
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.providerBind).toBe("agent_selfsign");
    expect(r.providerTx?.to).toBe(JOB);
    expect(r.claim.state).toBe("open");
    expect(r.claim.leaseUntilMs).toBeGreaterThan(r.claim.claimedAtMs);
    expect(r.claim.payoutWallet).toBe(PAYOUT.toLowerCase());
    expect(r.bounty.status).toBe("claimed");
  });

  it("acp: ops-signer setProvider path sends server tx", async () => {
    upsertBounty(bounty());
    const sent: `0x${string}`[] = [];
    const r = await claimBounty(req(), {
      network: () => net("acp"),
      verifyPayoutSig: sigOk,
      sendProviderTx: (txs) => {
        expect(txs).toHaveLength(1);
        sent.push(txs[0].to);
        return Promise.resolve([`0x${"cd".repeat(32)}`]);
      },
    });
    expect(r.ok && r.providerBind === "ops_sent").toBe(true);
    expect(sent).toEqual([JOB]);
  });

  it("acp: no ops key → calldata fallback", async () => {
    upsertBounty(bounty());
    const r = await claimBounty(req(), {
      network: () => net("acp"),
      verifyPayoutSig: sigOk,
      sendProviderTx: () => Promise.resolve(null),
    });
    expect(r.ok && r.providerBind === "ops_calldata" && !!r.providerTx).toBe(true);
  });

  it("404 unknown bounty / 409 non-open status", async () => {
    const miss = await claimBounty(req({ bountyId: "nope" }), {
      network: () => net("circle"), verifyPayoutSig: sigOk });
    expect(!miss.ok && miss.status === 404).toBe(true);
    upsertBounty(bounty({ status: "claimed" }));
    const r = await claimBounty(req(), {
      network: () => net("circle"), verifyPayoutSig: sigOk });
    expect(!r.ok && r.status === 409 && r.code === "INVALID_STATE").toBe(true);
  });

  it("double claim → 409", async () => {
    upsertBounty(bounty());
    const deps: ClaimDeps = {
      network: () => net("circle"),
      verifyPayoutSig: sigOk,
    };
    expect((await claimBounty(req(), deps)).ok).toBe(true);
    upsertBounty(bounty({ status: "open" })); // force re-open for check
    const r2 = await claimBounty(req({ payoutWallet: PAYOUT_B }), deps);
    expect(!r2.ok && r2.status === 409 && r2.code === "bounty_already_claimed").toBe(true);
  });

  it("cooldown: same passport cannot re-claim with live lease", async () => {
    upsertBounty(bounty({ jobAttempt: 2 }));
    // Prior attempt lease still live for this passport.
    const deps: ClaimDeps = {
      network: () => net("circle"),
      verifyPayoutSig: sigOk,
      now: () => 1_000_000,
    };
    upsertBounty(bounty({ jobAttempt: 1 }));
    await claimBounty(req(), deps);
    upsertBounty(bounty({ jobAttempt: 2 }));
    const r = await claimBounty(req({ payoutWallet: PAYOUT_B }), deps);
    expect(!r.ok && r.status === 409 && r.code === "bounty_cooldown").toBe(true);
  });

  it("bad payout sig → 403", async () => {
    upsertBounty(bounty());
    const r = await claimBounty(req(), {
      network: () => net("circle"),
      verifyPayoutSig: sigBad,
    });
    expect(!r.ok && r.status === 403 && r.code === "WRONG_SIGNER").toBe(true);
  });

  it("claimMessage format is stable", () => {
    expect(claimMessage("b1", PAYOUT)).toBe(
      `bounty-claim:b1:${PAYOUT.toLowerCase()}`,
    );
  });
});
