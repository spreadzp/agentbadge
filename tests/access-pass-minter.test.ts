import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  packsToClassMask,
  durationSecondsForAmount,
  createMintOnSettleHook,
  configureAccessPassMinterForTesting,
  resetAccessPassMinterForTesting,
  CLASS_MEDIUM,
  CLASS_HEAVY,
  CLASS_FULL,
} from "../src/server/lib/access-pass-minter";

/**
 * SLICE-137-4: mint-on-payment — x402 settle → mintOrExtend(payer, cls, duration).
 * Minter is stubbed via test override; hook is exercised with fake settle contexts.
 */

const PAYER = "0x8C644ea1Fc47d9185F5eEfb84bE23F7394C6e0d8";

function settleCtx(opts: {
  payer?: string;
  amount?: string;
  packs?: unknown;
} = {}) {
  return {
    result: {
      success: true,
      payer: "payer" in opts ? opts.payer : PAYER,
      amount: opts.amount ?? "4500000", // 4.50 USDC base units
      transaction: "0xtx",
    },
    requirements: { amount: opts.amount ?? "4500000" },
    paymentPayload: {},
    declaredExtensions: {},
    phase: "afterHandler",
    transportContext: {
      request: {
        adapter: {
          getBody: async () => (opts.packs === undefined ? {} : { packs: opts.packs }),
        },
      },
    },
  } as never;
}

describe("SLICE-137-4: packsToClassMask", () => {
  it("medium bundle → CLASS_MEDIUM bit", () => {
    expect(packsToClassMask(["openapi-docs"])).toBe(CLASS_MEDIUM);
  });

  it("heavy bundle → CLASS_HEAVY bit", () => {
    expect(packsToClassMask(["live-verification"])).toBe(CLASS_HEAVY);
  });

  it("mixed packs → OR of bits", () => {
    expect(packsToClassMask(["openapi-docs", "live-verification"])).toBe(
      CLASS_MEDIUM | CLASS_HEAVY,
    );
  });

  it("empty packs (full scan) → CLASS_FULL", () => {
    expect(packsToClassMask([])).toBe(CLASS_FULL);
  });

  it("light-only packs → CLASS_MEDIUM (paid scan gets at least medium)", () => {
    expect(packsToClassMask(["page-meta-seo"])).toBe(CLASS_MEDIUM);
  });

  it("unknown ids ignored", () => {
    expect(packsToClassMask(["openapi-docs", "bogus"])).toBe(CLASS_MEDIUM);
  });
});

describe("SLICE-137-4: durationSecondsForAmount", () => {
  it("$4.50 at $1.50/day (full) → 3 days", () => {
    expect(durationSecondsForAmount("4500000", CLASS_FULL)).toBe(3 * 86400);
  });

  it("$0.80 at $0.80/day (medium) → 1 day", () => {
    expect(durationSecondsForAmount("800000", CLASS_MEDIUM)).toBe(86400);
  });

  it("below min floor → still 1 day minimum", () => {
    expect(durationSecondsForAmount("100000", CLASS_MEDIUM)).toBe(86400);
  });

  it("env rate override respected", () => {
    process.env.ACCESS_PASS_DAY_RATE_MEDIUM_USD = "0.40";
    try {
      expect(durationSecondsForAmount("800000", CLASS_MEDIUM)).toBe(2 * 86400);
    } finally {
      delete process.env.ACCESS_PASS_DAY_RATE_MEDIUM_USD;
    }
  });
});

describe("SLICE-137-4: createMintOnSettleHook", () => {
  let mintSpy: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mintSpy = vi.fn().mockResolvedValue("0xminttx");
    configureAccessPassMinterForTesting({ minter: mintSpy });
  });

  afterEach(() => resetAccessPassMinterForTesting());

  it("mints for payer with class from packs and duration from amount", async () => {
    const hook = createMintOnSettleHook();
    await hook(settleCtx({ packs: ["openapi-docs"], amount: "800000" }));
    expect(mintSpy).toHaveBeenCalledWith({
      to: PAYER,
      classMask: CLASS_MEDIUM,
      durationSec: 86400,
      agentId: 0n,
      paymentTx: "0xtx",
    });
  });

  it("full scan (no packs) → CLASS_FULL", async () => {
    const hook = createMintOnSettleHook();
    await hook(settleCtx({ amount: "4500000" }));
    expect(mintSpy).toHaveBeenCalledWith(
      expect.objectContaining({ classMask: CLASS_FULL }),
    );
  });

  it("skips mint when payer missing — no throw", async () => {
    const hook = createMintOnSettleHook();
    await expect(hook(settleCtx({ payer: undefined }))).resolves.toBeUndefined();
    expect(mintSpy).not.toHaveBeenCalled();
  });

  it("minter failure is logged, not rethrown (payment already settled)", async () => {
    mintSpy.mockRejectedValue(new Error("rpc down"));
    const hook = createMintOnSettleHook();
    await expect(hook(settleCtx())).resolves.toBeUndefined();
  });
});
