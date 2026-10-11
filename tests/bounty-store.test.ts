/**
 * SLICE-197-02: BountyStore contract tests — the same suite runs against
 * the JSON backend (always, in-memory) and the Postgres backend
 * (live-gated on DATABASE_ENABLED + DATABASE_URL). Acceptance: both
 * paths behave identically; flush() lands writes; re-put of an outcome
 * on the same (bountyId, jobAttempt) never overwrites a verdict.
 */
import { randomBytes } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getDatabase } from "../src/server/lib/database";
import type {
  BountyClaimRecord,
  BountyOutcomeRecord,
  BountyRecord,
  BountyStoreBackend,
  BountyTransitionRecord,
} from "../src/server/lib/bounties/store";
import {
  createJsonBountyStore,
  newBountyId,
  newTransitionId,
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/bounties/json-store";
import { PrismaBountyStore } from "../src/server/lib/bounties/db-store";

const RUN = `t197s-${randomBytes(4).toString("hex")}`;

function mkBounty(status: BountyRecord["status"], n = 0): BountyRecord {
  return {
    bountyId: `${RUN}-b${n}-${newBountyId()}`,
    title: `bounty ${n}`,
    brief: { criteria: ["tests pass"], deliverableType: "pr" },
    budgetUsdc: "5.00",
    status,
    jobAttempt: 1,
    createdAt: new Date(1_700_000_000_000 + n * 1000).toISOString(),
  };
}

function mkClaim(bountyId: string, n = 0): BountyClaimRecord {
  return {
    id: `${bountyId}:1`,
    bountyId,
    jobAttempt: 1,
    passportId: `${RUN}-ps-${n}`,
    payoutWallet: "0x00000000000000000000000000000000000000cc",
    state: "open",
    claimedAtMs: 1_700_000_000_000,
    leaseUntilMs: 1_700_000_100_000,
  };
}

function mkTransition(bountyId: string, atMs: number): BountyTransitionRecord {
  return {
    id: newTransitionId(),
    bountyId,
    actor: "agent",
    from: "open",
    to: "claimed",
    atMs,
  };
}

function mkOutcome(bountyId: string, n = 0): BountyOutcomeRecord {
  return {
    id: `${bountyId}:1`,
    bountyId,
    jobAttempt: 1,
    passportId: `${RUN}-ps-${n}`,
    verdict: "pass",
    reasonCodes: ["green"],
  };
}

/**
 * Shared contract — call per backend. `make` returns a fresh backend;
 * `cleanup` drops test rows afterwards (db lane).
 */
function bountyStoreContract(
  name: string,
  make: () => BountyStoreBackend | null,
  cleanup?: () => Promise<void>,
) {
  let store: BountyStoreBackend | null = null;

  beforeEach(async () => {
    store = make();
    await store?.ready();
  });

  afterEach(async () => {
    await store?.flush();
    await cleanup?.();
  });

  describe(`BountyStore contract [${name}]`, () => {
    it("upsertBounty + getBounty roundtrip; list filters + sorts desc", async () => {
      if (!store) return;
      const a = mkBounty("open", 1);
      const b = mkBounty("claimed", 2);
      store.upsertBounty(a);
      store.upsertBounty(b);

      expect(store.getBounty(a.bountyId)?.title).toBe("bounty 1");
      const open = store.listBounties({ status: "open" });
      expect(open.map((x) => x.bountyId)).toContain(a.bountyId);
      expect(open.map((x) => x.bountyId)).not.toContain(b.bountyId);
      // Newest first (b createdAt > a createdAt).
      const all = store
        .listBounties()
        .filter((x) => x.bountyId.startsWith(RUN));
      expect(all[0]?.bountyId).toBe(b.bountyId);
      // Re-upsert updates status.
      store.upsertBounty({ ...a, status: "claimed" });
      expect(store.getBounty(a.bountyId)?.status).toBe("claimed");
    });

    it("claim lifecycle: upsert/get, expired sweep list, by passport", () => {
      if (!store) return;
      const bounty = mkBounty("claimed", 3);
      store.upsertBounty(bounty);
      const claim = mkClaim(bounty.bountyId, 3);
      store.upsertClaim(claim);

      expect(
        store.getClaim(bounty.bountyId, 1)?.passportId,
      ).toBe(`${RUN}-ps-3`);

      // Not yet expired.
      expect(
        store.listExpiredClaims(1_700_000_099_999).map((c) => c.id),
      ).not.toContain(claim.id);
      // Past lease → sweeper sees it.
      expect(
        store.listExpiredClaims(1_700_000_100_001).map((c) => c.id),
      ).toContain(claim.id);
      // Consumed claims never sweep.
      store.upsertClaim({ ...claim, state: "consumed" });
      expect(
        store.listExpiredClaims(1_800_000_000_000).map((c) => c.id),
      ).not.toContain(claim.id);
      expect(
        store.listClaimsByPassport(`${RUN}-ps-3`).map((c) => c.bountyId),
      ).toContain(bounty.bountyId);
    });

    it("transitions append + order by atMs per bounty", () => {
      if (!store) return;
      const bounty = mkBounty("open", 4);
      store.upsertBounty(bounty);
      const t1 = mkTransition(bounty.bountyId, 100);
      const t2 = mkTransition(bounty.bountyId, 200);
      store.appendTransition(t2);
      store.appendTransition(t1);
      const other = mkBounty("open", 5);
      store.upsertBounty(other);
      store.appendTransition(mkTransition(other.bountyId, 150));

      const list = store.listTransitions(bounty.bountyId);
      expect(list.map((t) => t.atMs)).toEqual([100, 200]);
      expect(list.every((t) => t.bountyId === bounty.bountyId)).toBe(true);
    });

    it("outcome: put/get, by passport, duplicate put is a no-op", () => {
      if (!store) return;
      const bounty = mkBounty("passed", 6);
      store.upsertBounty(bounty);
      const outcome = mkOutcome(bounty.bountyId, 6);
      store.putOutcome(outcome);

      expect(store.getOutcome(bounty.bountyId, 1)?.verdict).toBe("pass");
      expect(
        store.listOutcomesByPassport(`${RUN}-ps-6`).map((o) => o.bountyId),
      ).toContain(bounty.bountyId);

      // Verdict is final — re-put with a different verdict must not win.
      store.putOutcome({ ...outcome, verdict: "fail" });
      expect(store.getOutcome(bounty.bountyId, 1)?.verdict).toBe("pass");
    });

    it("meta roundtrip + ready/flush resolve", async () => {
      if (!store) return;
      store.setMeta(`${RUN}-key`, { watermark: 42 });
      expect(store.getMeta<{ watermark: number }>(`${RUN}-key`)).toEqual({
        watermark: 42,
      });
      await expect(store.flush()).resolves.toBeUndefined();
    });
  });
}

// ─── JSON backend (always) ───────────────────────────────────────

bountyStoreContract(
  "json",
  () => {
    useMemoryStoreForTesting();
    return createJsonBountyStore();
  },
  async () => resetStoreForTesting(),
);

// ─── Postgres backend (live-gated) ───────────────────────────────

const db = getDatabase().db;

describe.skipIf(!db)("BountyStore Postgres backend (live)", () => {
  const cleanup = async () => {
    const statements = [
      db!.raw.sql`DELETE FROM "bountyOutcome" WHERE "bountyId" LIKE ${`${RUN}%`}`,
      db!.raw.sql`DELETE FROM "bountyTransition" WHERE "bountyId" LIKE ${`${RUN}%`}`,
      db!.raw.sql`DELETE FROM "bountyClaim" WHERE "bountyId" LIKE ${`${RUN}%`}`,
      db!.raw.sql`DELETE FROM "bounty" WHERE "bountyId" LIKE ${`${RUN}%`}`,
    ];
    for (const q of statements) {
      await db!.runtime().execute(q.affectedCount().build());
    }
  };

  bountyStoreContract("prisma", () => new PrismaBountyStore(db!));
  afterEach(cleanup);
});
