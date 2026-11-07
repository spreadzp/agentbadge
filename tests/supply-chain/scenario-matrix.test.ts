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
import {
  acceptShipment,
  disputeHop,
  handoffHop,
  settleHop,
} from "../../src/server/lib/econ-ledger/supply-chain/shipment";
import { InMemoryHopExecutor } from "../../src/server/lib/econ-ledger/supply-chain/executor";
import { makeChain } from "./helpers/chain-fixture";

const CLIENT = "0x" + "aa".repeat(20) as `0x${string}`;
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

  it("S5 GPS anomaly: gps claim from non-party issuer → gpsAnomaly advisory", async () => {
    // §25: route impossible → CONFLICT; v1 (D-214-1) = advisory — a gps
    // ref asserted outside the hop's parties can't be trusted to place
    // the custody move; the geo-policy engine judges the route (v2).
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [
        {
          receiver: r1,
          amountUsdc: "10",
          evidenceRefs: [
            { type: "gps", hash: GPS_HASH, issuer: { address: ROGUE, type: "device" } },
          ],
        },
      ],
    });
    const { hops } = await chain.state();
    expect(hops[0]?.gpsAnomaly).toBe(true);
    expect(hops[0]?.status).toBe("paid"); // advisory — not a block
    expect(hops[0]?.evidence?.[0]?.issuerMatchesParty).toBe(false);
    // no device declared → fakeSensor stays off (independent flags)
    expect(hops[0]?.fakeSensor).toBeUndefined();
  });

  it("S5: gps ref asserted by a hop party → no anomaly (S1 stays clean)", async () => {
    const chain = await makeChain({ hops: 1, evidencePerHop: 1 });
    const { hops } = await chain.state();
    expect(hops[0]?.gpsAnomaly).toBeUndefined();
  });

  it("S6 receiver dispute: receiver rejects → disputed flag, settle blocked, chain halts", async () => {
    // §25: sender=delivered, receiver=not received → DISPUTE. v1
    // (D-214-4): a verify outcome:"fail" verdict is the honest carrier;
    // disputed blocks settle until a dispute engine exists (block 10).
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const r2 = "0x" + "b2".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }, { receiver: r2, amountUsdc: "10" }],
      lifecycle: "offered",
    });
    const { deps, shipmentId } = chain;
    await acceptShipment(shipmentId, 0, shipmentId, r1, deps);
    await handoffHop(
      shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, r1, deps,
      undefined, undefined,
      [{ type: "signature", hash: DOC_HASH, issuer: { address: r1, type: "org" } }],
    );

    // the hop's receiver disputes the handoff — "not received"
    await disputeHop(shipmentId, 0, r1, deps, { reasonCodes: ["receiver_not_received"] });

    const { hops } = await chain.state();
    expect(hops[0]?.disputed).toBe(true);
    expect(hops[0]?.status).toBe("handed_off"); // NOT verified — fail ≠ pass
    // settle is refused while disputed
    await expect(
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
    ).rejects.toThrow(/disputed/);
    // and the chain honestly halts — hop1 cannot handoff while hop0
    // is unpaid (existing guard, asserted for completeness)
    await expect(
      handoffHop(shipmentId, 1, {}, r1, r2, deps),
    ).rejects.toThrow(/must be paid first/);
  });

  it("S6: dispute guards — only the hop's receiver may dispute, only a handed-off hop", async () => {
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
    });
    const { deps, shipmentId } = chain;
    // nothing handed off yet → nothing to dispute
    await expect(disputeHop(shipmentId, 0, r1, deps)).rejects.toThrow(/not handed off/);
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);
    // a third party cannot dispute on the receiver's behalf
    await expect(disputeHop(shipmentId, 0, ROGUE, deps)).rejects.toThrow(/≠ hop receiver/);
    // the receiver's own dispute lands
    await disputeHop(shipmentId, 0, r1, deps);
    const { hops } = await chain.state();
    expect(hops[0]?.disputed).toBe(true);
  });

  it("S7 double settle: concurrent settle → exactly-once (1 executor call, 1 pay event)", async () => {
    // D-214-3: withHopLock serializes guard→settle→append per hop —
    // two parallel settles can't both reach the executor.
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
    });
    const { deps, shipmentId } = chain;
    await acceptShipment(shipmentId, 0, shipmentId, r1, deps);
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);

    await Promise.all([
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
    ]);

    const exec = chain.executor as InMemoryHopExecutor;
    expect(exec.settled).toHaveLength(1); // exactly-once at the executor seam
    const { hops, events } = await chain.state();
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(1);
    expect(hops[0]?.status).toBe("paid");
  });

  it("S7: injected settle failure → no pay event, log intact, hop stays handed_off", async () => {
    // failOnSettleJobId injection (D-214-2 seam): a failed hop preserves
    // the event log — the ledger never claims money it didn't move.
    const executor = new InMemoryHopExecutor();
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      shipmentId: "shp-s7",
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
      executor,
    });
    const { deps, shipmentId } = chain;
    executor.failOnSettleJobId = chain.jobId(0);
    await acceptShipment(shipmentId, 0, shipmentId, r1, deps);
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);

    await expect(
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
    ).rejects.toThrow(/rejected/);

    const { hops, events } = await chain.state();
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(0);
    expect(executor.settled).toHaveLength(0);
    expect(hops[0]?.status).toBe("handed_off"); // log intact — retryable
  });
});
