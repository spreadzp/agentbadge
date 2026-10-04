/**
 * SLICE-155-11 tests: Postgres-backed SpendLedger adapter.
 *
 * Unit (always run):
 *  - factory: "db" without repo → throws (fail-closed wiring);
 *    "auto" without repo → sqlite/json fallback; "auto" + repo → db
 *  - adapter propagates repo failures (fail-closed: no silent writes)
 *
 * PG-gated (opt-in DATABASE_URL_LIVE → local docker PG :5335):
 *  - parity with memory backend: window sums + listByWallet identical
 *  - restart-equivalent: fresh adapter over same repo sees entries
 *  - denied entry + denialReason persists, excluded from windowUsage
 *  - transition attaches txHash (overlay over insert-time payload)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

import {
  createDbSpendLedger,
  createMemorySpendLedger,
  createSpendLedger,
  newSpendId,
  windowUsage,
  type SpendEntry,
} from "../src/server/lib/agent-wallet/ledger";
import type { SpendLedgerRepository } from "@agentbadge/database";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";

const wallet = () =>
  `0x${randomBytes(20).toString("hex")}` as `0x${string}`;

const entry = (w: `0x${string}`, over: Partial<SpendEntry> = {}): SpendEntry => ({
  id: newSpendId(),
  wallet: w,
  amountUsd: 10,
  kind: "eaas",
  refId: "r1",
  state: "settled",
  at: Date.now(),
  ...over,
});

/* ------------------------------- unit -------------------------------- */

describe("createSpendLedger backend selection", () => {
  it('"db" without repo → throws (fail-closed, no silent fallback)', () => {
    expect(() => createSpendLedger("db", undefined, null)).toThrow(
      /requires DATABASE_ENABLED/,
    );
  });

  it('"auto" without repo → sqlite/json fallback (never "db")', () => {
    const l = createSpendLedger("auto", undefined, null);
    expect(l.name).not.toBe("db");
  });

  it('"auto" + repo → db backend', () => {
    const repo = {
      append: async () => null,
      transition: async () => false,
      listByWallet: async () => [],
    } as unknown as SpendLedgerRepository;
    expect(createSpendLedger("auto", undefined, repo).name).toBe("db");
  });
});

describe("createDbSpendLedger fail-closed", () => {
  const deadRepo = {
    append: async () => {
      throw new Error("db down");
    },
    transition: async () => {
      throw new Error("db down");
    },
    listByWallet: async () => {
      throw new Error("db down");
    },
  } as unknown as SpendLedgerRepository;

  it("insert / transition / listByWallet propagate repo errors", async () => {
    const l = createDbSpendLedger(deadRepo);
    await expect(l.insert(entry(wallet()))).rejects.toThrow("db down");
    await expect(l.transition("x", "settled")).rejects.toThrow("db down");
    await expect(l.listByWallet("0xabc")).rejects.toThrow("db down");
  });
});

/* --------------------------- PG-gated (opt-in) ------------------------ */

describe("db ledger vs dev PG (opt-in: DATABASE_URL_LIVE)", () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  async function dbLedger() {
    if (!process.env.DATABASE_URL_LIVE) return null; // opt-in
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = process.env.DATABASE_URL_LIVE;
    resetConfigCache();
    resetDatabaseForTests();
    const { getDatabase } = await import("../src/server/lib/database");
    const repo = getDatabase().spendLedger;
    return repo ? { repo, ledger: createDbSpendLedger(repo) } : null;
  }

  it("parity: same ops on memory vs db → identical window sums", async () => {
    const ctx = await dbLedger();
    if (!ctx) return;
    const w = wallet();
    const mem = createMemorySpendLedger();
    const ops: SpendEntry[] = [
      entry(w, { amountUsd: 60, at: Date.now() - 3600_000 }),
      entry(w, { amountUsd: 30, state: "reserved" }),
      entry(w, { amountUsd: 999, at: Date.now() - 40 * 86_400_000 }),
      entry(w, { amountUsd: 7, state: "released" }),
    ];
    for (const e of ops) {
      await mem.insert(e);
      await ctx.ledger.insert(e);
    }
    const memDaily = await windowUsage(mem, w, 86_400);
    const dbDaily = await windowUsage(ctx.ledger, w, 86_400);
    expect(dbDaily.used).toBe(memDaily.used);
    const dbList = await ctx.ledger.listByWallet(w);
    expect(dbList.map((e) => e.id).sort()).toEqual(
      ops.map((e) => e.id).sort(),
    );
  });

  it("restart-equivalent: fresh adapter sees prior entries + transition", async () => {
    const ctx = await dbLedger();
    if (!ctx) return;
    const w = wallet();
    await ctx.ledger.insert(entry(w, { id: "sp_rst1", state: "reserved" }));
    // simulate restart: new adapter over the same repo
    const fresh = createDbSpendLedger(ctx.repo);
    expect(await fresh.listByWallet(w)).toHaveLength(1);
    expect(await fresh.transition("sp_rst1", "settled", "0xdead")).toBe(true);
    expect(await fresh.transition("sp_rst1", "released")).toBe(false);
    const list = await createDbSpendLedger(ctx.repo).listByWallet(w);
    expect(list[0].state).toBe("settled");
    expect(list[0].txHash).toBe("0xdead");
  });

  it("denied entry persists with denialReason; excluded from window sums", async () => {
    const ctx = await dbLedger();
    if (!ctx) return;
    const w = wallet();
    await ctx.ledger.insert(
      entry(w, {
        state: "denied",
        denialReason: "daily",
        amountUsd: 500,
        venueId: "v-test",
      }),
    );
    const list = await ctx.ledger.listByWallet(w);
    expect(list).toHaveLength(1);
    expect(list[0].state).toBe("denied");
    expect(list[0].denialReason).toBe("daily");
    expect(list[0].venueId).toBe("v-test");
    expect((await windowUsage(ctx.ledger, w, 86_400)).used).toBe(0);
  });
});
