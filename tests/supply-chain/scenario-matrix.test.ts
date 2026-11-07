/**
 * SLICE-214-2/214-3 (D-211-13, D-214-1): scenario matrix S1–S7 — the
 * regression contract for the supply-chain pack (§25).
 *
 * Every scenario runs through the shared makeChain() fixture
 * (D-214-2) and asserts BOTH the write-side payload and the replay
 * projection. Violations surface as ADVISORY FLAGS in replay, never
 * automatic blocks (D-214-1): tempViolation, fakeSensor,
 * missingEvidence, gpsAnomaly, disputed (set fixed by O-214-1,
 * formalized in 215 replay-types).
 *
 * 214-5 (arc-audit fixes): hardened projection (canonical seq +
 * plan-bound + shipmentId-bound lifts), evaluator-gated verify,
 * pre-settle-only disputes, declared-device trusted telemetry —
 * regression tests live in the "audit hardening" describe below.
 */

import { describe, expect, it } from "vitest";
import { createDatabase } from "@agentbadge/database";
import { buildEconomicEvent } from "@agentbadge/econ-events";
import {
  acceptShipment,
  createShipment,
  disputeHop,
  handoffHop,
  settleHop,
  shipmentState,
  SHIPMENT_SOURCE,
  verifyHop,
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
    // 214-5 (audit H-6/M-1): every flag path must be ABLE to fire —
    // a declared device + sensor-issued telemetry exercises all five.
    const chain = await makeChain({
      hops: 3,
      lifecycle: "verified",
      roles: (hop) => ({
        custodian: { address: hop.receiver, type: "org" },
        device: { address: SENSOR, type: "device" },
      }),
      evidencePerHop: () => [
        { type: "gps", hash: GPS_HASH, issuer: { address: SENSOR, type: "device" } },
        { type: "temperature", hash: TEMP_HASH, issuer: { address: SENSOR, type: "device" } },
      ],
    });

    const { hops, events } = await chain.state();
    expect(hops).toHaveLength(3);
    // every hop reached verified; full lifecycle events per hop
    for (const hop of hops) {
      expect(hop.status).toBe("verified");
      expect(hop.evidence).toHaveLength(2);
      // sensor telemetry is honestly marked non-party (issuer ∉ custody)
      expect(hop.evidence?.[0]?.issuerMatchesParty).toBe(false);
      // but the DECLARED device is a trusted source → all flags off
      expect(hop.tempViolation).toBeUndefined();
      expect(hop.fakeSensor).toBeUndefined();
      expect(hop.missingEvidence).toBeUndefined();
      expect(hop.gpsAnomaly).toBeUndefined();
      expect(hop.disputed).toBeUndefined();
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

  it("S2 temperature violation: undeclared temp source → tempViolation advisory, hop still paid", async () => {
    // §25: sensor violation → payment HELD; v1 (D-214-1) = advisory
    // flag — a temperature claim from a source the hop never declared
    // needs policy review (the ledger can't verify the value, D-213-4).
    // 214-5 (M-1): the declared device is a trusted telemetry channel —
    // an UNDECLARED sensor's claim is the v1 violation signal.
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const r2 = "0x" + "b2".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [
        { receiver: r1, amountUsdc: "10" },
        {
          receiver: r2,
          amountUsdc: "10",
          roles: { custodian: { address: r2, type: "org" } },
          // no roles.device declared — an unknown sensor's temp claim
          // is outside custody AND outside declared sources
          evidenceRefs: [
            { type: "temperature", hash: TEMP_HASH, issuer: { address: ROGUE, type: "device" } },
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
    // the rogue gps ref is a non-party, non-declared source →
    // gpsAnomaly fires too (independent flags, audit M-1)
    expect(hop.gpsAnomaly).toBe(true);
    // the rogue ref is honestly marked as non-party too (213-5 H-1)
    expect(hop.evidence?.[0]?.issuerMatchesParty).toBe(false);
    expect(hop.evidence?.[1]?.issuerMatchesParty).toBe(true);
  });

  it("S3: no declared device → cannot judge fake — flag stays off", async () => {
    // honest edge: without roles.device the projection has nothing to
    // compare the issuer against — fakeSensor stays off rather than
    // guessing; gpsAnomaly still fires (rogue is a non-party source).
    const chain = await makeChain({
      hops: 1,
      evidencePerHop: [
        { type: "gps", hash: GPS_HASH, issuer: { address: ROGUE, type: "device" } },
      ],
    });
    const { hops } = await chain.state();
    expect(hops[0]?.fakeSensor).toBeUndefined();
    expect(hops[0]?.gpsAnomaly).toBe(true);
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
    // 214-5 (audit H-6): the negative case must CONTAIN a gps ref —
    // numeric evidencePerHop generates "document" refs and could never
    // fail. Party-issued gps → issuerMatchesParty, no flag.
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{
        receiver: r1,
        amountUsdc: "10",
        evidenceRefs: [
          { type: "gps", hash: GPS_HASH, issuer: { address: r1, type: "org" } },
        ],
      }],
    });
    const { hops } = await chain.state();
    expect(hops[0]?.evidence?.[0]?.type).toBe("gps");
    expect(hops[0]?.evidence?.[0]?.issuerMatchesParty).toBe(true);
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
    // settle is refused while disputed — and the refusal is clean:
    // nothing reached the executor or the log (audit M-3)
    await expect(
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
    ).rejects.toThrow(/disputed/);
    const exec = chain.executor as InMemoryHopExecutor;
    expect(exec.settled).toHaveLength(0);
    const post = await chain.state();
    expect(post.events.filter((e) => e.kind === "pay")).toHaveLength(0);
    expect(post.hops[0]?.status).toBe("handed_off");
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
    // and it cannot be re-disputed (one verdict slot per hop)
    await expect(disputeHop(shipmentId, 0, r1, deps)).rejects.toThrow(/already disputed/);
  });

  it("S6/verify guards: dispute ends at settle; verify is evaluator-only; inconclusive never lifts", async () => {
    // 214-5 (audit M-3/H-3): the dispute stub covers "not received"
    // BEFORE settlement; post-settle verdicts go through verifyHop —
    // and verify is restricted to the hop's evaluator (audit H-3).
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({ hops: [{ receiver: r1, amountUsdc: "10" }] });
    const { deps, shipmentId } = chain; // lifecycle "settled" → hop0 paid
    // dispute on a paid hop → refused
    await expect(disputeHop(shipmentId, 0, r1, deps)).rejects.toThrow(/already paid/);
    // only the evaluator may verify — the last hop's evaluator is the client
    await expect(
      verifyHop(shipmentId, 0, "pass", ROGUE, r1, deps),
    ).rejects.toThrow(/≠ hop evaluator/);
    // an inconclusive verdict lands but does NOT lift the hop (H-2)
    await verifyHop(shipmentId, 0, "inconclusive", CLIENT, r1, deps);
    const { hops } = await chain.state();
    expect(hops[0]?.status).toBe("paid");
    expect(hops[0]?.disputed).toBeUndefined();
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

describe("audit hardening (SLICE-214-5)", () => {
  it("H-1: forged events can't rewrite the plan or mint phantom hops", async () => {
    // projection hardening: only the canonical seq slot, an in-plan
    // index and a payload bound to THIS shipmentId may lift anything.
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({ hops: [{ receiver: r1, amountUsdc: "10" }] });
    const { deps, shipmentId } = chain;
    const at = () => new Date().toISOString();
    // a second offer at a non-canonical seq — the plan binds to seq 1
    await deps.ledger.append([buildEconomicEvent({
      source: SHIPMENT_SOURCE, sourceId: shipmentId, seq: 7, kind: "work_offer",
      actor: ROGUE, counterparty: ROGUE, at: at(),
      payload: {
        taskRef: shipmentId,
        terms: { shipmentId, hopCount: 1, hops: [{ hopIndex: 0, receiver: ROGUE, amountUsdc: "10" }] },
      },
    })]);
    // a forged pay on a non-plan index — must not mint a phantom hop
    await deps.ledger.append([buildEconomicEvent({
      source: SHIPMENT_SOURCE, sourceId: shipmentId, seq: 41, kind: "pay",
      actor: ROGUE, counterparty: ROGUE, amountUsdc: "10", at: at(),
      payload: { rail: "escrow", shipmentId, hopIndex: 5 },
    })]);
    // a forged fail-verdict at a non-canonical seq — no dispute
    await deps.ledger.append([buildEconomicEvent({
      source: SHIPMENT_SOURCE, sourceId: shipmentId, seq: 42, kind: "verify",
      actor: ROGUE, counterparty: r1, at: at(),
      payload: { outcome: "fail", shipmentId, hopIndex: 0 },
    })]);
    // a pay bound to a DIFFERENT shipmentId — payload binding refuses it
    await deps.ledger.append([buildEconomicEvent({
      source: SHIPMENT_SOURCE, sourceId: shipmentId, seq: 43, kind: "pay",
      actor: ROGUE, counterparty: ROGUE, amountUsdc: "10", at: at(),
      payload: { rail: "escrow", shipmentId: "shp-OTHER", hopIndex: 0 },
    })]);

    const { hops } = await chain.state();
    expect(hops).toHaveLength(1);              // no phantom hop 5
    expect(hops[0]?.receiver).toBe(r1);        // plan not rewritten
    expect(hops[0]?.disputed).toBeUndefined(); // forged fail ignored
    expect(hops[0]?.status).toBe("paid");      // real lifecycle intact
  });

  it("H-4: concurrent createShipment — one offer, one set of jobs", async () => {
    // without the shipment lock both calls pass the existence check
    // and each creates+funds N executor jobs → orphan escrows.
    const db = createDatabase({ enabled: false });
    const executor = new InMemoryHopExecutor();
    const deps = { ledger: db.econLedger, executor };
    const spec = {
      shipmentId: "shp-race",
      client: CLIENT,
      hops: [
        { receiver: "0x" + "b1".repeat(20) as `0x${string}`, amountUsdc: "10" },
        { receiver: "0x" + "b2".repeat(20) as `0x${string}`, amountUsdc: "10" },
      ],
    };
    const results = await Promise.allSettled([
      createShipment(spec, deps),
      createShipment(spec, deps),
    ]);
    const ok = results.filter((r) => r.status === "fulfilled");
    const bad = results.filter((r) => r.status === "rejected");
    expect(ok).toHaveLength(1);
    expect(bad).toHaveLength(1);
    expect((bad[0] as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/already exists/),
    });
    // one job set only — no orphan funded escrows
    expect(executor.created).toHaveLength(2);
    const st = await shipmentState(deps.ledger, spec.shipmentId);
    expect(st.events.filter((e) => e.kind === "work_offer")).toHaveLength(1);
  });

  it("M-3: dispute vs settle race — the lock serializes, exactly one lands", async () => {
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
    });
    const { deps, shipmentId } = chain;
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);
    // argument order = lock acquisition order: dispute lands first,
    // the settle then hits the disputed guard inside the same lock.
    const [disputeRes, settleRes] = await Promise.allSettled([
      disputeHop(shipmentId, 0, r1, deps),
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
    ]);
    expect(disputeRes.status).toBe("fulfilled");
    expect(settleRes.status).toBe("rejected");
    const exec = chain.executor as InMemoryHopExecutor;
    expect(exec.settled).toHaveLength(0);
    const { hops, events } = await chain.state();
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(0);
    expect(hops[0]?.disputed).toBe(true);
    expect(hops[0]?.status).toBe("handed_off");
  });

  it("M-3b: settle vs dispute race — a settled hop refuses the dispute", async () => {
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
    });
    const { deps, shipmentId } = chain;
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);
    const [settleRes, disputeRes] = await Promise.allSettled([
      settleHop(shipmentId, 0, "10", CLIENT, r1, deps),
      disputeHop(shipmentId, 0, r1, deps),
    ]);
    expect(settleRes.status).toBe("fulfilled");
    expect(disputeRes.status).toBe("rejected");
    expect((disputeRes as PromiseRejectedResult).reason).toMatchObject({
      message: expect.stringMatching(/already paid/),
    });
    const exec = chain.executor as InMemoryHopExecutor;
    expect(exec.settled).toHaveLength(1);
    const { hops, events } = await chain.state();
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(1);
    expect(hops[0]?.disputed).toBeUndefined();
    expect(hops[0]?.status).toBe("paid");
  });

  it("M-4: the double-settle loser really queues on the hop lock", async () => {
    // deferred executor settle: the first caller parks inside the lock;
    // the second must WAIT — not reach the executor in parallel.
    const executor = new InMemoryHopExecutor();
    let release!: () => void;
    const gate = new Promise<void>((r) => { release = r; });
    const origSettle = executor.settle.bind(executor);
    executor.settle = async (jobId: string, amountUsdc: string) => {
      await gate;
      return origSettle(jobId, amountUsdc);
    };
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
      executor,
    });
    const { deps, shipmentId } = chain;
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);

    let bDone = false;
    const a = settleHop(shipmentId, 0, "10", CLIENT, r1, deps);
    const b = settleHop(shipmentId, 0, "10", CLIENT, r1, deps).then(() => { bDone = true; });
    await new Promise((r) => setImmediate(r));
    // A holds the lock parked in the executor — B is queued, not ahead
    expect(bDone).toBe(false);
    expect(executor.settled).toHaveLength(0);
    release();
    await Promise.all([a, b]);
    expect(executor.settled).toHaveLength(1); // exactly-once under real contention
    const { events } = await chain.state();
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(1);
  });

  it("H-5: onchain settle ok + ledger append fails → loud error, visible divergence", async () => {
    // the dangerous half of settle-failure (audit H-5): money moved
    // but the log doesn't say so. The contract: LOUD error carrying
    // jobId — never silent — plus observable divergence for ops.
    const executor = new InMemoryHopExecutor();
    const r1 = "0x" + "b1".repeat(20) as `0x${string}`;
    const chain = await makeChain({
      hops: [{ receiver: r1, amountUsdc: "10" }],
      lifecycle: "offered",
      executor,
    });
    const { deps, shipmentId } = chain;
    await handoffHop(shipmentId, 0, {}, CLIENT, r1, deps);
    const realAppend = deps.ledger.append.bind(deps.ledger);
    const failingLedger = new Proxy(deps.ledger, {
      get: (target, prop) => {
        if (prop === "append") {
          return async (evs: Array<{ kind?: string }>) => {
            if (evs[0]?.kind === "pay") throw new Error("injected append failure");
            return realAppend(evs as Parameters<typeof realAppend>[0]);
          };
        }
        const v = Reflect.get(target, prop);
        return typeof v === "function" ? v.bind(target) : v;
      },
    });
    const failDeps = { ...deps, ledger: failingLedger };
    await expect(
      settleHop(shipmentId, 0, "10", CLIENT, r1, failDeps),
    ).rejects.toThrow(/settled onchain.*job-/);
    // executor moved the "money"; the log honestly does NOT claim it
    expect(executor.settled).toHaveLength(1);
    const { hops, events } = await chain.state();
    expect(events.filter((e) => e.kind === "pay")).toHaveLength(0);
    expect(hops[0]?.status).toBe("handed_off");
  });
});
