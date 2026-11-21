/**
 * SLICE-257-15 (N-8): boundTermsMatch — seller-controlled strings in
 * termsMatch.reason / diff.offered are stripped of control characters
 * and capped at 200 chars before they reach check logs and the
 * owner-facing approval meta.
 */

import { describe, it, expect } from "vitest";

import { boundTermsMatch } from "../../src/server/lib/buy/counterparty-outcomes";

describe("boundTermsMatch (N-8)", () => {
  it("reason + diff.offered stripped of control chars, ≤200", () => {
    const long = "x".repeat(400);
    const t = boundTermsMatch({
      result: "uncomparable",
      reason: `offered terms: payTo ${long}\u0007boom`,
      diff: {
        payTo: { verified: "0xabc", offered: long },
      },
    });
    expect(t.reason!.length).toBeLessThanOrEqual(200);
    expect(t.reason).not.toContain("\u0007");
    expect(t.reason!.startsWith("offered terms: payTo x")).toBe(true);
    expect(t.diff!.payTo!.offered).toHaveLength(200);
    // clean values pass through unchanged
    const clean = boundTermsMatch({
      result: "mismatch",
      diff: { network: { verified: "eip155:1", offered: "eip155:2" } },
    });
    expect(clean.diff!.network).toEqual({
      verified: "eip155:1",
      offered: "eip155:2",
    });
  });
});
