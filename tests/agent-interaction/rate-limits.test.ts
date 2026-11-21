import { describe, expect, it } from "vitest";

import { createTieredLimiter } from "../../src/server/routes/agent-interaction/rate-limits";

/**
 * Arc-audit R1-H1 regression: the global bucket was charged BEFORE the
 * per-key bucket and never refunded — one flooding IP could exhaust the
 * shared window and lock out every tier. Fixed order: per-key →
 * tier-group → global, so rejected traffic only burns its own lane.
 */

const mk = (now = () => 1_000) =>
  createTieredLimiter({
    limits: { ANON: 1, API_KEY: 5, DID: 5 },
    globalKey: "g",
    globalMax: 4,
    tierGroups: { ANON: { key: "g:anon", max: 2 } },
    now,
  });

describe("createTieredLimiter — arc H1/H-group", () => {
  it("rejected per-key requests do not consume the global bucket", () => {
    const l = mk();
    expect(l.allow("ANON", "ip:a")).toBe(true); // admit 1/1
    // 10 rejects from the same IP — old code burned global on each.
    for (let i = 0; i < 10; i++) {
      expect(l.allow("ANON", "ip:a")).toBe(false);
    }
    // Keyed callers are untouched by the anon flood.
    expect(l.allow("API_KEY", "key:k1")).toBe(true);
    expect(l.allow("DID", "did:d1")).toBe(true);
  });

  it("tier-group bucket caps ANON without starving keyed tiers", () => {
    const l = mk();
    expect(l.allow("ANON", "ip:a")).toBe(true); // anon group 1/2
    expect(l.allow("ANON", "ip:b")).toBe(true); // anon group 2/2
    expect(l.allow("ANON", "ip:c")).toBe(false); // group exhausted
    // Keyed lanes keep working while ANON is group-capped.
    expect(l.allow("API_KEY", "key:k1")).toBe(true);
    expect(l.allow("DID", "did:d1")).toBe(true);
  });

  it("global bucket still bounds combined traffic", () => {
    const l = mk();
    // globalMax=4: 2 anon-admits + 2 keyed admits fill it.
    expect(l.allow("ANON", "ip:a")).toBe(true);
    expect(l.allow("ANON", "ip:b")).toBe(true);
    expect(l.allow("API_KEY", "key:k1")).toBe(true);
    expect(l.allow("API_KEY", "key:k2")).toBe(true);
    expect(l.allow("DID", "did:d1")).toBe(false); // global exhausted
  });

  it("backward compatible without tierGroups", () => {
    const l = createTieredLimiter({
      limits: { ANON: 1, API_KEY: 2, DID: 2 },
      globalKey: "g",
      globalMax: 3,
    });
    expect(l.allow("ANON", "ip:a")).toBe(true);
    expect(l.allow("API_KEY", "key:k1")).toBe(true);
    expect(l.allow("API_KEY", "key:k2")).toBe(true);
    expect(l.allow("DID", "did:d1")).toBe(false);
  });
});
