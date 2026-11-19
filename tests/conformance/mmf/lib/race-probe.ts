/**
 * SLICE-255-5 / D-255-Q22: race probe — check-then-insert TOCTOU.
 *
 * envelope.ts L194-200 documents the window ("check-then-insert
 * window exists — acceptable") but claims sync backends "can't
 * interleave between the awaits". This probe tests the claim under
 * real `enforcer.begin` concurrency:
 *
 *   registry.get → checkEnvelope(listByWallet) → insertReserved(insert)
 *                    ▲ window: all N callers read before any writes
 *
 * Controlled sync: a stub SpendLedgerRepository whose listByWallet
 * blocks at an N-arity barrier — every begin() arrives, all see the
 * pre-insert state, all reserve. Deterministic overshoot, not luck.
 *
 * "Not reproduced" ≠ "atomic" — results are observations, recorded
 * per backend; we never claim a negative proves safety.
 */
import { Hono } from "hono";
import type { Context } from "hono";

import { createSpendEnforcer } from "../../../../src/server/lib/agent-wallet/enforcer";
import {
  createDbSpendLedger,
  createMemorySpendLedger,
  type SpendLedger,
} from "../../../../src/server/lib/agent-wallet/ledger";
import type { SpendEntry } from "../../../../src/server/lib/agent-wallet/ledger";
import type { SpendLedgerRepository } from "@agentbadge/database";

import { freshSpendEnv, W } from "./harness-env";

/** Row shape `spendRowToEntry` reads off the repo result. */
interface StubRow {
  payload: SpendEntry;
  state: string;
  txHash: string | null;
  sourceChain: string | null;
  venueId: string | null;
  denialReason: string | null;
}

/** A barrier that resolves once `arity` callers have arrived (with a
 *  safety release so a missed caller hangs 2s, not forever). */
export function makeBarrier(arity: number) {
  let arrived = 0;
  const waiters: Array<() => void> = [];
  const release = () => waiters.splice(0).forEach((r) => r());
  const timer = setTimeout(release, 2000);
  timer.unref();
  return {
    wait: (): Promise<void> => {
      arrived += 1;
      if (arrived >= arity) {
        clearTimeout(timer);
        release();
        return Promise.resolve();
      }
      return new Promise((r) => waiters.push(r));
    },
    arrived: () => arrived,
  };
}

export interface StubRepoOptions {
  /** If set, listByWallet blocks until `arity` callers arrive. */
  barrier?: ReturnType<typeof makeBarrier>;
}

/** In-memory SpendLedgerRepository — same await-boundaries as the real
 *  Prisma repo (network round-trip per call), minus the DB. */
export function stubRepo(opts: StubRepoOptions = {}) {
  const rows = new Map<string, StubRow>();
  const repo = {
    async append(e: {
      id: string;
      wallet: string;
      venueId?: string | null;
      kind: string;
      amountUsd: number;
      state: string;
      refId: string;
      txHash?: string | null;
      sourceChain?: string | null;
      denialReason?: string | null;
      at: number;
      payload: unknown;
    }) {
      const row: StubRow = {
        payload: e.payload as SpendEntry,
        state: e.state,
        txHash: e.txHash ?? null,
        sourceChain: e.sourceChain ?? null,
        venueId: e.venueId ?? null,
        denialReason: e.denialReason ?? null,
      };
      if (!rows.has(e.id)) rows.set(e.id, row);
      return row;
    },
    async transition(
      id: string,
      to: "settled" | "released" | "failed",
      txHash?: string,
      sourceChain?: string,
    ) {
      const row = rows.get(id);
      if (!row || row.state !== "reserved") return false;
      row.state = to;
      if (txHash) row.txHash = txHash;
      if (sourceChain) row.sourceChain = sourceChain;
      return true;
    },
    async listByWallet(wallet: string) {
      if (opts.barrier) await opts.barrier.wait();
      return [...rows.values()].filter(
        (r) => r.payload.wallet.toLowerCase() === wallet.toLowerCase(),
      );
    },
    async sumByWalletInWindow() {
      return 0;
    },
    async getByTxHash() {
      return null;
    },
    async listDenials() {
      return [];
    },
  };
  return repo as unknown as SpendLedgerRepository;
}

export interface RaceProbeResult {
  backend: string;
  n: number;
  /** begins that returned a reservation (allow). */
  allowed: number;
  /** begins denied (402 body). */
  denied: number;
  /** begins that threw/5xx. */
  threw: number;
  reservedEntries: number;
  reservedUsd: number;
  /** reservedUsd − dailyUsd when positive. */
  overshootUsd: number;
  sequentialAllowed: number;
}

/**
 * Fire `n` parallel begin()s (amountUsd each) at one wallet capped by
 * dailyUsd. Sequential baseline measured first on an identical env.
 */
export async function runRaceProbe(opts: {
  n: number;
  amountUsd: number;
  dailyUsd: number;
  backend: "db-barrier" | "memory";
}): Promise<{ probe: RaceProbeResult; ledger: SpendLedger }> {
  // --- sequential baseline -------------------------------------------------
  const seq = freshSpendEnv({ dailyUsd: opts.dailyUsd }, false);
  await seq.save();
  const seqEnforcer = createSpendEnforcer({
    ledger: stubLedger(opts),
    registry: seq.registry,
    requireRegistered: false,
  });
  const sequentialAllowed = (
    await fire(seqEnforcer, opts.n, opts.amountUsd, false)
  ).allowed;
  // --- probe run -----------------------------------------------------------
  const barrier =
    opts.backend === "db-barrier" ? makeBarrier(opts.n) : undefined;
  const repo = stubRepo({ ...(barrier ? { barrier } : {}) });
  const ledger =
    opts.backend === "db-barrier"
      ? createDbSpendLedger(repo)
      : createMemorySpendLedger();
  const env = freshSpendEnv({ dailyUsd: opts.dailyUsd }, false);
  await env.save();
  const enforcer = createSpendEnforcer({
    ledger,
    registry: env.registry,
    requireRegistered: false,
  });
  const { allowed, denied, threw } = await fire(
    enforcer,
    opts.n,
    opts.amountUsd,
    true,
  );
  const entries = await ledger.listByWallet(W);
  const reserved = entries.filter((e) => e.state === "reserved");
  const reservedUsd = reserved.reduce((a, e) => a + e.amountUsd, 0);
  return {
    ledger,
    probe: {
      backend: opts.backend,
      n: opts.n,
      allowed,
      denied,
      threw,
      reservedEntries: reserved.length,
      reservedUsd,
      overshootUsd: Math.max(0, reservedUsd - opts.dailyUsd),
      sequentialAllowed,
    },
  };
}

function stubLedger(opts: { backend: string }): SpendLedger {
  // sequential baseline uses the same backend minus the barrier
  return opts.backend === "db-barrier"
    ? createDbSpendLedger(stubRepo())
    : createMemorySpendLedger();
}

async function fire(
  enforcer: ReturnType<typeof createSpendEnforcer>,
  n: number,
  amountUsd: number,
  parallel: boolean,
): Promise<{ allowed: number; denied: number; threw: number }> {
  const app = new Hono();
  app.post("/enforce", async (c: Context) => {
    const begun = await enforcer.begin(c, amountUsd, "x402", "race");
    if (begun instanceof Response) return begun;
    return c.json({ ok: true, entry: begun.entry?.id ?? null });
  });
  const call = () =>
    app.request("/enforce", {
      method: "POST",
      headers: { "x-wallet": W },
    });
  const results: Response[] = [];
  if (parallel) {
    results.push(...(await Promise.all(Array.from({ length: n }, call))));
  } else {
    for (let i = 0; i < n; i++) results.push(await call());
  }
  let allowed = 0;
  let denied = 0;
  let threw = 0;
  for (const r of results) {
    if (r.status === 200) allowed += 1;
    else if (r.status >= 500) threw += 1;
    else denied += 1;
  }
  return { allowed, denied, threw };
}
