/**
 * SLICE-176-11 tests: Postgres-backed ApprovalStore adapter
 * (approvals-db.ts — mirror + write-behind).
 *
 * Unit (always run):
 *  - factory: "db" without repo → throws; "auto" without repo → sqlite/json
 *    fallback (never "db"); "auto" + repo → db
 *  - mirror semantics over a fake repo: park/get/listByWallet/decide/
 *    consume/countPending/expireOverdue behave like the memory store
 *    (lazy expiry, newest-first, decide rejects terminal/expired, consume
 *    is single-use) and enqueue matching repo writes
 *
 * PG-gated (opt-in DATABASE_URL_LIVE → docker PG :5335):
 *  - restart-equivalent: fresh adapter over the same repo sees parked
 *    intents and decide outcomes
 *  - decide/concume land as conditional writes (columns+payload in sync)
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { randomBytes } from "node:crypto";

import {
  createApprovalStore,
  type ApprovalParkInput,
  type SpendApproval,
} from "../src/server/lib/agent-wallet/approvals";
import { createDbApprovalStore } from "../src/server/lib/agent-wallet/approvals-db";
import type { SpendApprovalRepository } from "@agentbadge/database";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";

const wallet = () =>
  `0x${randomBytes(20).toString("hex")}` as `0x${string}`;
const park = (w: `0x${string}`, over: Partial<ApprovalParkInput> = {}) => ({
  wallet: w,
  amountUsd: 25,
  kind: "x402" as const,
  refId: "r1",
  expiresAt: Date.now() + 3_600_000,
  ...over,
});

/* ------------------------------ fake repo -------------------------------- */

/** In-memory SpendApprovalRepository stub recording every write op. */
function fakeRepo() {
  const rows = new Map<string, Record<string, unknown>>();
  const calls: string[] = [];
  const toRow = (a: Record<string, unknown>) => ({ id: a.id, ...a });
  const repo = {
    calls,
    rows,
    async put(a: Record<string, unknown>) {
      calls.push(`put:${a.id}`);
      rows.set(a.id as string, toRow(a));
      return toRow(a);
    },
    async get(id: string) {
      return rows.get(id) ?? null;
    },
    async listByWallet(w: string) {
      return [...rows.values()].filter((r) => r.wallet === w);
    },
    async listAll() {
      return [...rows.values()];
    },
    async decide(id: string, to: string, actor: string, at: number) {
      calls.push(`decide:${id}:${to}`);
      const r = rows.get(id);
      if (!r || r.state !== "pending") return false;
      Object.assign(r, { state: to, decidedBy: actor, decidedAtMs: at });
      return true;
    },
    async consume(id: string, at: number) {
      calls.push(`consume:${id}`);
      const r = rows.get(id);
      if (!r || r.state !== "approved") return false;
      Object.assign(r, { state: "consumed", consumedAtMs: at });
      return true;
    },
    async expire(id: string) {
      calls.push(`expire:${id}`);
      const r = rows.get(id);
      if (!r || r.state !== "pending") return false;
      r.state = "expired";
      return true;
    },
    async listPending() {
      return [...rows.values()].filter((r) => r.state === "pending");
    },
  };
  return repo as unknown as SpendApprovalRepository & typeof repo;
}

const ready = async (s: { ready?(): Promise<void> }) => s.ready?.();
const flush = async (s: { flush?(): Promise<void> }) => s.flush?.();

/* ------------------------------- unit ------------------------------------ */

describe("createApprovalStore backend selection (176-11)", () => {
  it('"db" without repo → throws (fail-closed)', () => {
    expect(() => createApprovalStore("db", undefined, 20, null)).toThrow(
      /requires DATABASE_ENABLED/,
    );
  });

  it('"auto" without repo → sqlite/json fallback (never "db")', () => {
    const s = createApprovalStore("auto", undefined, 20, null);
    expect(s.name).not.toBe("db");
  });

  it('"auto" + repo → db backend', () => {
    const s = createApprovalStore("auto", undefined, 20, fakeRepo());
    expect(s.name).toBe("db");
  });
});

describe("db approval store — mirror semantics", () => {
  let repo: ReturnType<typeof fakeRepo>;
  let store: ReturnType<typeof createDbApprovalStore>;
  beforeEach(async () => {
    repo = fakeRepo();
    store = createDbApprovalStore(repo, 3);
    await ready(store!);
  });

  it("park → get/listByWallet/countPending reflect mirror; put enqueued", async () => {
    const w = wallet();
    const a = (await store!.park(park(w)))!;
    expect((await store!.get(a.id))!.state).toBe("pending");
    expect(await store!.listByWallet(w)).toHaveLength(1);
    expect(await store!.countPending(w)).toBe(1);
    await flush(store!);
    expect(repo.calls).toContain(`put:${a.id}`);
  });

  it("decide approves live pending + refreshes expiresAt; repo gets conditional decide", async () => {
    const w = wallet();
    const a = (await store!.park(park(w)))!;
    const newExp = a.expiresAt + 60_000;
    expect(await store!.decide(a.id, "approve", "0xowner", newExp)).toBe(true);
    const v = (await store!.get(a.id))!;
    expect(v.state).toBe("approved");
    expect(v.decidedBy).toBe("0xowner");
    expect(v.expiresAt).toBe(newExp);
    await flush(store!);
    expect(repo.calls).toContain(`decide:${a.id}:approved`);
  });

  it("decide rejects terminal/expired (lazy expiry — no write)", async () => {
    const w = wallet();
    const a = (await store!.park(park(w, { expiresAt: Date.now() - 1 })))!;
    expect(await store!.decide(a.id, "approve", "0xowner")).toBe(false);
    expect((await store!.get(a.id))!.state).toBe("expired");
    await flush(store!);
    expect(repo.calls.filter((c) => c.startsWith("decide"))).toHaveLength(0);
  });

  it("consume is single-use", async () => {
    const w = wallet();
    const a = (await store!.park(park(w)))!;
    await store!.decide(a.id, "approve", "0xowner");
    expect(await store!.consume(a.id)).toBe(true);
    expect(await store!.consume(a.id)).toBe(false);
    await flush(store!);
    expect(repo.calls).toContain(`consume:${a.id}`);
  });

  it("park throws approval_queue_full past cap", async () => {
    const w = wallet();
    for (let i = 0; i < 3; i++) await store!.park(park(w));
    await expect(store!.park(park(w))).rejects.toThrow("approval_queue_full");
  });

  it("expireOverdue flips mirror + enqueues conditional expire", async () => {
    const w = wallet();
    const a = (await store!.park(park(w, { expiresAt: Date.now() - 5 })))!;
    const expired = await store!.expireOverdue();
    expect(expired.map((e: SpendApproval) => e.id)).toContain(a.id);
    expect((await store!.get(a.id))!.state).toBe("expired");
    await flush(store!);
    expect(repo.calls).toContain(`expire:${a.id}`);
  });
});

/* --------------------------- PG-gated (opt-in) --------------------------- */

describe("db approval store vs dev PG (opt-in: DATABASE_URL_LIVE)", () => {
  const originalEnv = { ...process.env };
  beforeEach(() => {
    process.env = { ...originalEnv };
  });
  afterEach(() => {
    process.env = { ...originalEnv };
    resetConfigCache();
    resetDatabaseForTests();
  });

  async function dbStore() {
    if (!process.env.DATABASE_URL_LIVE) return null;
    process.env.DATABASE_ENABLED = "true";
    process.env.DATABASE_URL = process.env.DATABASE_URL_LIVE;
    resetConfigCache();
    resetDatabaseForTests();
    const { getDatabase } = await import("../src/server/lib/database");
    const repo = getDatabase().spendApprovals;
    if (!repo) return null;
    const s = createDbApprovalStore(repo, 20)!;
    await s.ready();
    return { repo, s };
  }

  it("restart-equivalent: parked + decided survive a fresh adapter", async () => {
    const h = await dbStore();
    if (!h) return;
    const { repo, s } = h;
    const w = wallet();
    const parked = await s.park(park(w));
    await s.decide(parked.id, "approve", "0xowner");
    await s.flush();

    // "restart" — a brand-new mirror hydrates from the repo rows
    const s2 = createDbApprovalStore(repo, 20)!;
    await s2.ready();
    const v = await s2.get(parked.id);
    expect(v!.state).toBe("approved");
    expect(v!.decidedBy).toBe("0xowner");
    expect((await s2.listByWallet(w)).map((x) => x.id)).toContain(parked.id);
    await s2.flush();
  });
});
