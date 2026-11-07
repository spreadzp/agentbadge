/**
 * SLICE-214-2 (D-211-13, D-214-1): scenario matrix S1–S4 — the
 * regression contract for the supply-chain pack (§25).
 *
 * Every scenario runs through the shared makeChain() fixture
 * (D-214-2) and asserts BOTH the write-side payload and the replay
 * projection. Violations surface as ADVISORY FLAGS in replay, never
 * automatic blocks (D-214-1): tempViolation, fakeSensor,
 * missingEvidence (set fixed by O-214-1, formalized in 215
 * replay-types). S5–S7 land in 214-3.
 */

import { describe, expect, it } from "vitest";
import { makeChain } from "./helpers/chain-fixture";

const SENSOR = "0x" + "dd".repeat(20) as `0x${string}`;
const ROGUE = "0x" + "ee".repeat(20) as `0x${string}`;
const GPS_HASH = `0x${"ef".repeat(32)}`;
const TEMP_HASH = `0x${"ab".repeat(32)}`;
const DOC_HASH = `0x${"12".repeat(32)}`;

describe("scenario matrix (SLICE-214-2, §25)", () => {
  it("S1 happy path: 3-hop chain, all settled + verified, zero advisory flags", async () => {
    const chain = await makeChain({
      hops: 3,
      lifecycle: "verified",
      roles: (hop) => ({ custodian: { address: hop.receiver, type: "org" } }),
      evidencePerHop: (hop) => [
        {
          type: "gps",
          hash: GPS_HASH,
          issuer: { address: hop.receiver, type: "device" },
        },
      ],
    });

    const { hops, events } = await chain.state();
    expect(hops).toHaveLength(3);
    // every hop reached verified; full lifecycle events per hop
    for (const hop of hops) {
      expect(hop.status).toBe("verified");
      expect(hop.evidence).toHaveLength(1);
      expect(hop.evidence?.[0]?.issuerMatchesParty).toBe(true);
      // S1 must be flag-free — no advisories on a clean chain
      expect(hop.tempViolation).toBeUndefined();
      expect(hop.fakeSensor).toBeUndefined();
      expect(hop.missingEvidence).toBeUndefined();
    }
    // write side: offer + per-hop accept/handoff/pay/verify
    expect(events.filter((e) => e.kind === "work_offer")).toHaveLength(1);
    expect(events.filter((e) => e.kind === "handoff")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(3);
    expect(events.filter((e) => e.kind === "verify")).toHaveLength(3);
    // every hop job settled through the executor
    const settled = (chain.executor as { settled: Array<{ jobId: string }> }).settled;
    expect(settled.map((s) => s.jobId).sort()).toEqual([0, 1, 2].map((i) => chain.jobId(i)).sort());
  });

  it("S2 temperature violation: non-party temp claim → tempViolation advisory, hop still paid", async () => {
    // §25: sensor violation → payment HELD; v1 (D-214-1) = advisory
    // flag, the settle still executes — the verifier sees the flag.
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const r2 = "0x" + "b2".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [
        { receiver: r1, amountUsdc: "10" },
        {
          receiver: r2,
          amountUsdc: "10",
          roles: {
            custodian: { address: r2, type: "org" },
            device: { address: SENSOR, type: "device" },
          },
          // the declared sensor asserts a temperature reading —
          // as a non-party its claim needs policy review (D-213-4:
          // the ref is a link, the ledger cannot verify the value)
          evidenceRefs: [
            { type: "temperature", hash: TEMP_HASH, issuer: { address: SENSOR, type: "device" } },
          ],
        },
        { receiver: "0x" + "b3".repeat(20) as `0x${string}`, amountUsdc: "10" },
      ],
    });

    const { hops } = await chain.state();
    const flagged = hops[1]!;
    expect(flagged.tempViolation).toBe(true);
    // the flag is advisory — the hop still handed off and settled
    expect(flagged.status).toBe("paid");
    expect(flagged.evidence?.[0]?.type).toBe("temperature");
    // issuer matches the declared sensor → NOT a fake sensor
    expect(flagged.fakeSensor).toBeUndefined();
    expect(flagged.missingEvidence).toBeUndefined();
    // clean hops stay flag-free
    expect(hops[0]?.tempViolation).toBeUndefined();
    expect(hops[2]?.tempViolation).toBeUndefined();
  });

  it("S3 fake sensor: device-issuer ≠ declared roles.device → fakeSensor advisory", async () => {
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [
        {
          receiver: r1,
          amountUsdc: "10",
          roles: {
            custodian: { address: r1, type: "org" },
            device: { address: SENSOR, type: "device" }, // declared sensor
          },
          evidenceRefs: [
            // a rogue device claims telemetry under a different address
            { type: "gps", hash: GPS_HASH, issuer: { address: ROGUE, type: "device" } },
            { type: "document", hash: DOC_HASH, issuer: { address: r1, type: "org" } },
          ],
        },
      ],
    });

    const { hops } = await chain.state();
    const hop = hops[0]!;
    expect(hop.fakeSensor).toBe(true);
    expect(hop.status).toBe("paid"); // advisory — not a block
    // the rogue ref is honestly marked as non-party too (213-5 H-1)
    expect(hop.evidence?.[0]?.issuerMatchesParty).toBe(false);
    expect(hop.evidence?.[1]?.issuerMatchesParty).toBe(true);
  });

  it("S3: no declared device → cannot judge fake — flag stays off", async () => {
    // honest edge: without roles.device the projection has nothing to
    // compare the issuer against — no false positive.
    const chain = await makeChain({
      hops: 1,
      evidencePerHop: [
        { type: "gps", hash: GPS_HASH, issuer: { address: ROGUE, type: "device" } },
      ],
    });
    const { hops } = await chain.state();
    expect(hops[0]?.fakeSensor).toBeUndefined();
    expect(hops[0]?.evidence?.[0]?.issuerMatchesParty).toBe(false);
  });

  it("S4 missing telemetry: hop without evidence → missingEvidence flag, chain still valid", async () => {
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const r2 = "0x" + "b2".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [
        { receiver: r1, amountUsdc: "10" },
        { receiver: r2, amountUsdc: "10" }, // no evidence — telemetry gap
      ],
      evidencePerHop: (hop) =>
        hop.hopIndex === 0
          ? [{ type: "gps", hash: GPS_HASH, issuer: { address: r1, type: "org" } }]
          : undefined,
    });

    const { hops, events } = await chain.state();
    expect(hops[0]?.missingEvidence).toBeUndefined();
    expect(hops[0]?.evidence).toHaveLength(1);
    // §25: handoff UNRESOLVED — v1: the handoff IS recorded (backward
    // compat D-211-2) and the gap is flagged, not blocked
    expect(hops[1]?.missingEvidence).toBe(true);
    expect(hops[1]?.evidence).toBeUndefined();
    expect(hops[1]?.status).toBe("paid"); // chain remained valid
    // write side: hop1 handoff exists with no evidence key
    const handoff1 = events.find((e) => e.kind === "handoff" &&
      (e.payload as { hopIndex?: number }).hopIndex === 1);
    expect(handoff1).toBeDefined();
    expect((handoff1!.payload as Record<string, unknown>).evidence).toBeUndefined();
  });
});
