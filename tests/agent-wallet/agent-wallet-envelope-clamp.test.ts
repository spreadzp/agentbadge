/**
 * SLICE-263-1 tests: MMF v0.5-clamp on the envelope path —
 * SpendCaps.clamp + effective-amount verdict + SpendEntry clamp fields.
 *
 * Unit level (envelope.ts surface). Enforcer/gate/route coverage lives
 * in agent-wallet-envelope-clamp-enforcer.test.ts.
 *
 * Covered (per slice AC):
 *  - D4: clamp absent/false + over-perTx → identical legacy deny verdict
 *  - clamp:true + over-perTx → allow at effective=perTxUsd, verdict
 *    carries clamped{requested,cap}; windows evaluate effective
 *  - non-bool clamp → validateCaps throws (PATCH route maps to 400 —
 *    covered in the enforcer file)
 *  - D6/D7: entry.amountUsd === verdict.amount (identity, no recompute)
 *  - D9: clamped-candidate + window deny → zero reserved entries
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";

import { createMemorySpendLedger } from "../../src/server/lib/agent-wallet/ledger";
import {
  checkEnvelope,
  reserve,
  validateCaps,
} from "../../src/server/lib/agent-wallet/envelope";

const W = "0x00000000000000000000000000000000000000b1" as `0x${string}`;
const SAVED_DB = process.env.DATABASE_ENABLED;

beforeEach(() => {
  process.env.DATABASE_ENABLED = "false";
});
afterEach(() => {
  if (SAVED_DB === undefined) delete process.env.DATABASE_ENABLED;
  else process.env.DATABASE_ENABLED = SAVED_DB;
});

/* ------------------------------ validateCaps ------------------------------ */

describe("validateCaps — clamp flag (Q2, draft §2.2)", () => {
  it("boolean accepted; absent → off; non-boolean → throw", () => {
    expect(validateCaps({ perTxUsd: 5, clamp: true })).toEqual({
      perTxUsd: 5,
      clamp: true,
    });
    expect(validateCaps({ clamp: false })).toEqual({ clamp: false });
    expect(validateCaps({ perTxUsd: 5 })).toEqual({ perTxUsd: 5 });
    expect(() => validateCaps({ clamp: "yes" })).toThrow(/boolean/);
    expect(() => validateCaps({ clamp: 1 })).toThrow(/boolean/);
    expect(() => validateCaps({ clamp: {} })).toThrow(/boolean/);
  });
});

/* ------------------------- checkEnvelope — clamp -------------------------- */

describe("checkEnvelope — perTx clamp resolution", () => {
  it("clamp absent + over-perTx → legacy deny (D4)", async () => {
    const l = createMemorySpendLedger();
    const v = await checkEnvelope(l, { perTxUsd: 5 }, W, 10);
    expect(v).toMatchObject({
      allow: false,
      deny: { cap: "perTx", used: 10, limit: 5 },
    });
  });

  it("clamp:false → byte-identical deny (D4)", async () => {
    const l = createMemorySpendLedger();
    const v = await checkEnvelope(l, { perTxUsd: 5, clamp: false }, W, 10);
    expect(v).toMatchObject({
      allow: false,
      deny: { cap: "perTx", used: 10, limit: 5 },
    });
  });

  it("clamp:true + over-perTx → allow, amount=cap, clamped{requested,cap}", async () => {
    const l = createMemorySpendLedger();
    const v = await checkEnvelope(l, { perTxUsd: 5, clamp: true }, W, 10);
    expect(v).toEqual({
      allow: true,
      amount: 5,
      clamped: { requested: 10, cap: 5 },
    });
  });

  it("clamp:true + under-cap → allow, NO clamped field (no false marker)", async () => {
    const l = createMemorySpendLedger();
    const v = await checkEnvelope(l, { perTxUsd: 5, clamp: true }, W, 3);
    expect(v).toEqual({ allow: true, amount: 3 });
    expect("clamped" in v).toBe(false);
  });

  it("windows evaluate EFFECTIVE: clamped 25→10 fits daily, requested would not", async () => {
    const l = createMemorySpendLedger();
    await l.insert({
      id: "sp_old",
      wallet: W,
      amountUsd: 92,
      kind: "eaas",
      refId: "old",
      state: "settled",
      at: Date.now(),
    });
    // requested 25 → effective 10; 92+10=102 > 100 daily → deny proves
    // windows summed the EFFECTIVE amount (deny cap is daily, not perTx).
    const v = await checkEnvelope(
      l,
      { perTxUsd: 10, dailyUsd: 100, clamp: true },
      W,
      25,
    );
    expect(v).toMatchObject({ allow: false, deny: { cap: "daily", used: 92 } });
  });

  it("windows evaluate EFFECTIVE — allow case: 90+10 ≤ 100 while 90+25 > 100", async () => {
    const l = createMemorySpendLedger();
    await l.insert({
      id: "sp_old",
      wallet: W,
      amountUsd: 90,
      kind: "eaas",
      refId: "old",
      state: "settled",
      at: Date.now(),
    });
    // Requested 25 clamps to 10 → 90+10=100 ≤ 100 → allow. Had windows
    // summed requested (90+25=115), this would deny — proves effective.
    const v = await checkEnvelope(
      l,
      { perTxUsd: 10, dailyUsd: 100, clamp: true },
      W,
      25,
    );
    expect(v).toEqual({
      allow: true,
      amount: 10,
      clamped: { requested: 25, cap: 10 },
    });
  });
});

/* ------------------------------ reserve + D6 ------------------------------ */

describe("reserve — D6/D7 amount identity", () => {
  it("reserves verdict.amount verbatim; entry carries clamp fields", async () => {
    const l = createMemorySpendLedger();
    const r = await reserve(l, { perTxUsd: 10, clamp: true }, W, 25, "eaas", "v1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    // D7: identity — no recompute/rounding between verdict and entry.
    expect(r.entry.amountUsd).toBe(10);
    expect(r.entry.clamped).toBe(true);
    expect(r.entry.requestedAmountUsd).toBe(25);
    expect(r.entry.effectiveCapUsd).toBe(10);
  });

  it("unclamped reserve → no clamp fields on entry (byte-identical)", async () => {
    const l = createMemorySpendLedger();
    const r = await reserve(l, { perTxUsd: 10, clamp: true }, W, 5, "eaas", "v1");
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.entry.amountUsd).toBe(5);
    expect(r.entry.clamped).toBeUndefined();
    expect(r.entry.requestedAmountUsd).toBeUndefined();
    expect(r.entry.effectiveCapUsd).toBeUndefined();
  });

  it("D9: clamped candidate + daily deny → no reserved entry (denied audit only)", async () => {
    const l = createMemorySpendLedger();
    await l.insert({
      id: "sp_old",
      wallet: W,
      amountUsd: 95,
      kind: "eaas",
      refId: "old",
      state: "settled",
      at: Date.now(),
    });
    // clamp resolves 25→10, then daily check 95+10=105 > 100 denies —
    // the clamp candidate must leave NO partial reservation behind.
    const r = await reserve(
      l,
      { perTxUsd: 10, dailyUsd: 100, clamp: true },
      W,
      25,
      "eaas",
      "v1",
    );
    expect(r.ok).toBe(false);
    const entries = await l.listByWallet(W);
    expect(entries.filter((e) => e.state === "reserved")).toHaveLength(0);
    expect(entries.filter((e) => e.id !== "sp_old")).toHaveLength(0);
  });
});
