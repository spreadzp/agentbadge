import { describe, it, expect } from "vitest";

import { getPrice, TIER_PRICES_TINYBARS } from "@agentgate-hedera/passport";
import { TIER_PRICES_HBAR } from "@agentgate-hedera/hedera-core";

describe("getPrice", () => {
  it("returns correct tinybars for bronze (10 HBAR)", () => {
    expect(getPrice("bronze")).toBe(10 * 100_000_000);
  });

  it("returns correct tinybars for silver (50 HBAR)", () => {
    expect(getPrice("silver")).toBe(50 * 100_000_000);
  });

  it("returns correct tinybars for gold (200 HBAR)", () => {
    expect(getPrice("gold")).toBe(200 * 100_000_000);
  });

  it("returns correct tinybars for platinum (500 HBAR)", () => {
    expect(getPrice("platinum")).toBe(500 * 100_000_000);
  });

  it("defaults to bronze price for unknown tier", () => {
    expect(getPrice("unknown" as never)).toBe(TIER_PRICES_HBAR.bronze * 100_000_000);
  });
});

describe("TIER_PRICES_TINYBARS", () => {
  it("matches TIER_PRICES_HBAR * 100_000_000", () => {
    for (const tier of ["bronze", "silver", "gold", "platinum"] as const) {
      expect(TIER_PRICES_TINYBARS[tier]).toBe(TIER_PRICES_HBAR[tier] * 100_000_000);
    }
  });
});
