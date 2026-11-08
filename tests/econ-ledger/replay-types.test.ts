/**
 * SLICE-215-1 (D-215-1): replay-view contract — `ShipmentReplayResponse`
 * schema/types are the FIXED contract; endpoint (215-2) and honest-empty
 * (215-3) build against them.
 *
 * Contract: {shipmentId, client, status, timeline[], hops[], aggregate, limits}.
 * timeline[] — {seq, kind, ts, hopIndex?}; hops[] — {index, receiver,
 * amountUsdc, status, roles?, evidence?, jobId?, txHash?} + advisory flags;
 * aggregate — {completedPct, currentCustodian?, outstandingUsdc};
 * limits[] — honest-limitation strings, always present (D-215-3).
 */

import { describe, expect, it } from "vitest";
import {
  REPLAY_LIMITS_V1,
  ReplayAggregateSchema,
  ReplayHopSchema,
  ReplayTimelineEntrySchema,
  ShipmentReplayResponseSchema,
  SHIPMENT_REPLAY_STATUSES,
  type ShipmentReplayResponse,
} from "../../src/server/lib/econ-ledger/supply-chain/replay-types";

const ADDR = (b: string) => `0x${b.repeat(20)}` as const;
const CLIENT = ADDR("aa");
const CARRIER = ADDR("bb");
const WAREHOUSE = ADDR("dd");
const SENSOR = ADDR("ee");
const HASH: `0x${string}` = `0x${"cd".repeat(32)}`;
const TX: `0x${string}` = `0x${"ef".repeat(32)}`;

/** A complete response exercising every optional field. */
const FULL_RESPONSE: ShipmentReplayResponse = {
  shipmentId: "shp-demo-1",
  client: CLIENT,
  status: "in_progress",
  timeline: [
    { seq: 1, kind: "work_offer", ts: "2026-11-07T12:00:00Z" },
    { seq: 4, kind: "handoff", ts: "2026-11-07T12:05:00Z", hopIndex: 0 },
    { seq: 5, kind: "pay", ts: "2026-11-07T12:06:00Z", hopIndex: 0 },
  ],
  hops: [
    {
      index: 0,
      receiver: CARRIER,
      amountUsdc: "10.5",
      status: "paid",
      jobId: "42",
      txHash: TX,
      roles: {
        custodian: { address: CARRIER, type: "org", label: "Carrier Co" },
        device: { address: SENSOR, type: "device", label: "temp-01" },
      },
      rolesAssertedBy: CLIENT,
      evidence: [
        {
          type: "temperature",
          hash: HASH,
          issuer: { address: SENSOR, type: "device" },
          uri: "https://example.com/sensor/1",
          issuerIsHopParty: false,
        },
      ],
      evidenceAssertedBy: CLIENT,
      tempViolation: true,
      missingEvidence: false,
    },
    {
      index: 1,
      receiver: WAREHOUSE,
      amountUsdc: "4",
      status: "offered",
    },
  ],
  aggregate: {
    completedPct: 50,
    currentCustodian: CARRIER,
    outstandingUsdc: "4",
  },
  limits: [...REPLAY_LIMITS_V1],
};

describe("ShipmentReplayResponseSchema (215-1 contract)", () => {
  it("validates a full response with all optional fields", () => {
    const res = ShipmentReplayResponseSchema.safeParse(FULL_RESPONSE);
    expect(res.success).toBe(true);
    if (res.success) {
      expect(res.data.hops[0]?.evidence?.[0]?.issuerIsHopParty).toBe(false);
      expect(res.data.aggregate.completedPct).toBe(50);
    }
  });

  it("validates a minimal response — roles/evidence/jobId/txHash absent", () => {
    const minimal: ShipmentReplayResponse = {
      shipmentId: "shp-min",
      client: CLIENT,
      status: "offered",
      timeline: [{ seq: 1, kind: "work_offer", ts: "2026-11-07T12:00:00Z" }],
      hops: [{ index: 0, receiver: CARRIER, amountUsdc: "10", status: "offered" }],
      aggregate: { completedPct: 0, outstandingUsdc: "10" },
      limits: [...REPLAY_LIMITS_V1],
    };
    expect(ShipmentReplayResponseSchema.safeParse(minimal).success).toBe(true);
  });

  it("carries all advisory flags on a hop when present", () => {
    const hop = ReplayHopSchema.safeParse({
      index: 2,
      receiver: CARRIER,
      amountUsdc: "1",
      status: "handed_off",
      tempViolation: true,
      fakeSensor: true,
      missingEvidence: true,
      gpsAnomaly: true,
      disputed: true,
    });
    expect(hop.success).toBe(true);
  });

  it("rejects when a required field is missing", () => {
    for (const key of ["shipmentId", "client", "status", "timeline", "hops", "aggregate", "limits"] as const) {
      const broken = { ...FULL_RESPONSE };
      delete (broken as Record<string, unknown>)[key];
      expect(ShipmentReplayResponseSchema.safeParse(broken).success, `missing ${key}`).toBe(false);
    }
  });

  it("rejects a hop missing receiver/amountUsdc/status", () => {
    const base = FULL_RESPONSE.hops[0]!;
    for (const key of ["receiver", "amountUsdc", "status"] as const) {
      const broken = { ...base };
      delete (broken as Record<string, unknown>)[key];
      expect(ReplayHopSchema.safeParse(broken).success, `missing ${key}`).toBe(false);
    }
  });

  it("requires limits to be a non-empty array of strings (D-215-3)", () => {
    expect(
      ShipmentReplayResponseSchema.safeParse({ ...FULL_RESPONSE, limits: [] }).success,
    ).toBe(false);
    expect(
      ShipmentReplayResponseSchema.safeParse({ ...FULL_RESPONSE, limits: ["linear hops only"] }).success,
    ).toBe(true);
  });

  it("requires timeline entries to carry seq/kind/ts; hopIndex optional", () => {
    expect(
      ReplayTimelineEntrySchema.safeParse({ seq: 3, kind: "handoff", ts: "2026-11-07T12:05:00Z" }).success,
    ).toBe(true);
    expect(
      ReplayTimelineEntrySchema.safeParse({ seq: 3, ts: "2026-11-07T12:05:00Z" }).success,
    ).toBe(false);
    expect(
      ReplayTimelineEntrySchema.safeParse({ seq: 3, kind: "handoff", ts: "not-a-date" }).success,
    ).toBe(false);
  });

  it("accepts every declared shipment status", () => {
    for (const status of SHIPMENT_REPLAY_STATUSES) {
      expect(
        ShipmentReplayResponseSchema.safeParse({ ...FULL_RESPONSE, status }).success,
        `status=${status}`,
      ).toBe(true);
    }
  });

  it("rejects an undeclared shipment status", () => {
    expect(
      ShipmentReplayResponseSchema.safeParse({ ...FULL_RESPONSE, status: "lost" }).success,
    ).toBe(false);
  });

  it("aggregate: completedPct bounded 0..100, outstandingUsdc decimal", () => {
    expect(
      ReplayAggregateSchema.safeParse({ completedPct: 100, outstandingUsdc: "0" }).success,
    ).toBe(true);
    expect(
      ReplayAggregateSchema.safeParse({ completedPct: 101, outstandingUsdc: "0" }).success,
    ).toBe(false);
    expect(
      ReplayAggregateSchema.safeParse({ completedPct: -1, outstandingUsdc: "0" }).success,
    ).toBe(false);
    expect(
      ReplayAggregateSchema.safeParse({ completedPct: 50, outstandingUsdc: "abc" }).success,
    ).toBe(false);
  });

  it("hop txHash must be a 32-byte hex when present", () => {
    const base = FULL_RESPONSE.hops[0]!;
    expect(ReplayHopSchema.safeParse({ ...base, txHash: "0x1234" }).success).toBe(false);
    expect(ReplayHopSchema.safeParse({ ...base, txHash: TX }).success).toBe(true);
  });
});
