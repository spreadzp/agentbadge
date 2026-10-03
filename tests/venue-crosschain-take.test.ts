/**
 * SLICE-156-4: venue take on cross-chain settles.
 *
 * Gateway settles land on Arc at the same payTo as vanilla (shared
 * router + railPayTo fallback), so the subscription ledger and the
 * 152-4 fee path (hook/sweep on Arc) are rail-agnostic by construction.
 *
 * Covered:
 *  - extendVenueSubscription persists sourceChain/scheme (156-3 seam)
 *  - venuePaymentsByChain aggregates cross-chain revenue (AC3)
 *  - legacy payments without chain data bucket under "unknown"
 */
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { resetConfigCache } from "../src/config/env";
import { resetDatabaseForTests } from "../src/server/lib/database";
import { resetVenueEventsForTests } from "../src/server/services/venue-events";
import {
  resetStoreForTesting,
  useMemoryStoreForTesting,
} from "../src/server/lib/venue/store";
import { createVenue } from "../src/server/lib/venue/venues";
import {
  extendVenueSubscription,
  listVenuePayments,
  venuePaymentsByChain,
} from "../src/server/lib/venue/billing";

const OWNER = "0x00000000000000000000000000000000000000aa";
const PAYER = "0x0000000000000000000000000000000000000cc1";

const ENV_KEYS = [
  "DATABASE_ENABLED",
  "ARC_BV_MONTHLY_USD",
  "ARC_BV_GRACE_DAYS",
] as const;
const saved: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>> =
  {};

beforeEach(() => {
  for (const k of ENV_KEYS) saved[k] = process.env[k];
  process.env.DATABASE_ENABLED = "false";
  process.env.ARC_BV_MONTHLY_USD = "1000000"; // $1/mo
  resetConfigCache();
  resetDatabaseForTests();
  useMemoryStoreForTesting();
  resetVenueEventsForTests();
});
afterEach(() => {
  resetStoreForTesting();
  resetVenueEventsForTests();
  resetDatabaseForTests();
  for (const k of ENV_KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  resetConfigCache();
});

const mkVenue = () =>
  createVenue({
    name: "Biz",
    slug: `biz-${Math.random().toString(36).slice(2, 8)}`,
    kind: "business",
    ownerWallet: OWNER as `0x${string}`,
  });

describe("cross-chain settle → venue payments (SLICE-156-4)", () => {
  it("gateway-batch settle persists sourceChain/scheme + byChain aggregate", () => {
    const v = mkVenue();
    const res = extendVenueSubscription({
      venueId: v.id,
      venue: v,
      payer: PAYER as `0x${string}`,
      amountAtomic: "1000000",
      tx: "0x" + "ab".repeat(32),
      sourceChain: "eip155:84532",
      scheme: "gateway-batch",
    });
    expect(res).toBeDefined();
    const payments = listVenuePayments(v.id);
    expect(payments).toHaveLength(1);
    expect(payments[0].sourceChain).toBe("eip155:84532");
    expect(payments[0].scheme).toBe("gateway-batch");
    expect(venuePaymentsByChain(v.id)["eip155:84532"]).toEqual({
      count: 1,
      amountAtomic: "1000000",
    });
  });

  it("mixed rails: gateway + legacy settle → unknown bucket; revenue totals", () => {
    const v = mkVenue();
    extendVenueSubscription({
      venueId: v.id,
      venue: v,
      payer: PAYER as `0x${string}`,
      amountAtomic: "1000000",
      tx: "0x" + "cd".repeat(32),
      sourceChain: "eip155:5042002",
      scheme: "eip3009-client-broadcast",
    });
    extendVenueSubscription({
      venueId: v.id,
      venue: v,
      payer: PAYER as `0x${string}`,
      amountAtomic: "2000000",
      tx: "0x" + "ef".repeat(32),
      // no sourceChain/scheme — pre-156 legacy shape
    });
    const byChain = venuePaymentsByChain(v.id);
    expect(byChain["eip155:5042002"]).toEqual({
      count: 1,
      amountAtomic: "1000000",
    });
    expect(byChain["unknown"]).toEqual({
      count: 1,
      amountAtomic: "2000000",
    });
    // Cross-chain revenue is counted in the venue payment ledger —
    // rail-agnostic aggregation (venue.stats.revenue path).
    const total = listVenuePayments(v.id).reduce(
      (acc, p) => acc + BigInt(p.amountAtomic),
      0n,
    );
    expect(total).toBe(3000000n);
  });
});
