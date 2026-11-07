/**
 * SLICE-207-7: supply-chain pack + shipment read — e2e dogfood.
 *
 * 3-hop shipment end-to-end (AC): offer → accept → hop0 handoff+pay →
 * hop1 handoff+pay → hop2 handoff+pay → final verify. All events in the
 * ledger, edges materialized, ordering enforced by the log (SoT), a
 * failed hop settle preserves every earlier event.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ShipmentReplayResponseSchema } from "../src/server/lib/econ-ledger/supply-chain/replay-types";
import { createDatabase, type Database } from "@agentbadge/database";
import { createEconLedgerShipmentsRoutes } from "../src/server/routes/econ-ledger-shipments-api";
import {
  acceptShipment,
  createShipment,
  handoffHop,
  settleHop,
  shipmentState,
  ShipmentOrderError,
  verifyHop,
} from "../src/server/lib/econ-ledger/supply-chain/shipment";
import { InMemoryHopExecutor } from "../src/server/lib/econ-ledger/supply-chain/executor";
import type { HopSpec } from "../src/server/lib/econ-ledger/supply-chain/types";
import { hashCanonical } from "../src/server/lib/eaas/verdict";

const CLIENT = "0x" + "aa".repeat(20) as `0x${string}`;
const CARRIER = "0x" + "bb".repeat(20) as `0x${string}`;
const WAREHOUSE = "0x" + "cc".repeat(20) as `0x${string}`;
const LAST_MILE = "0x" + "dd".repeat(20) as `0x${string}`;

const HOPS: HopSpec[] = [
  { receiver: CARRIER, amountUsdc: "10", what: "pallet-A1", where: "factory", why: "linehaul" },
  { receiver: WAREHOUSE, amountUsdc: "4", what: "pallet-A1", where: "hub-east", why: "crossdock" },
  { receiver: LAST_MILE, amountUsdc: "6", what: "pallet-A1", where: "city", why: "last_mile" },
];

/** Enabled-path db (in-memory but db !== null). */
async function makeDb() {
  const db = createDatabase({ enabled: false });
  return { ...db, db: {} as Database["db"] } as Database;
}

async function makeShipment() {
  const db = await makeDb();
  const executor = new InMemoryHopExecutor();
  const deps = { ledger: db.econLedger, executor };
  const { jobs } = await createShipment(
    { shipmentId: "shp-e2e-1", client: CLIENT, hops: HOPS },
    deps,
  );
  return { db, deps, executor, jobs };
}

describe("supply-chain pack — 3-hop dogfood", () => {
  it("one job per hop; evaluator = next hop's receiver (D-207-7)", async () => {
    const { executor, jobs } = await makeShipment();
    expect(jobs).toHaveLength(3);
    expect(executor.created.map((c) => c.evaluator)).toEqual([
      WAREHOUSE, // hop0 evaluated by hop1 receiver
      LAST_MILE, // hop1 evaluated by hop2 receiver
      CLIENT, // last hop evaluated by the client
    ]);
    expect(executor.created.map((c) => c.provider)).toEqual([
      CARRIER, WAREHOUSE, LAST_MILE,
    ]);
    for (const spec of executor.created) {
      expect(spec.shipmentId).toBe("shp-e2e-1");
    }
  });

  it("full lifecycle: handoff→pay per hop, then verify — chain complete", async () => {
    const { db, deps } = await makeShipment();
    const sid = "shp-e2e-1";
    const offerRef = sid; // offer event taskRef

    await acceptShipment(sid, 0, offerRef, CARRIER, deps);
    await handoffHop(sid, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, HOPS[0]);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, { ...deps }, { rail: "escrow" });
    await acceptShipment(sid, 1, offerRef, WAREHOUSE, deps);
    await handoffHop(sid, 1, { proofOfDelivery: "pod-1" }, CARRIER, WAREHOUSE, deps, HOPS[1]);
    await settleHop(sid, 1, "4", CLIENT, WAREHOUSE, deps);
    await acceptShipment(sid, 2, offerRef, LAST_MILE, deps);
    await handoffHop(sid, 2, { proofOfDelivery: "pod-2" }, WAREHOUSE, LAST_MILE, deps, HOPS[2]);
    await settleHop(sid, 2, "6", CLIENT, LAST_MILE, deps);
    await verifyHop(sid, 2, "pass", CLIENT, LAST_MILE, deps);

    const st = await shipmentState(db.econLedger, sid);
    expect(st.hops.map((h) => h.status)).toEqual(["paid", "paid", "verified"]);
    expect(st.events.length).toBeGreaterThanOrEqual(11); // offer + 3×(accept+handoff+pay) + verify

    // edges materialized — pay legs folded into AgentTrustEdge (207-4)
    const pairEdges = await db.trustEdges.listPair(CLIENT, CARRIER);
    expect(pairEdges.some((e) => e.kind === "pay" && e.eventCount >= 1)).toBe(true);
  });

  it("verify carries criteriaDigest bound to offer terms (207-9)", async () => {
    const { db, deps } = await makeShipment();
    const sid = "shp-e2e-1";
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    await handoffHop(sid, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, HOPS[0]);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps);
    await verifyHop(sid, 0, "pass", WAREHOUSE, CARRIER, deps, {
      policyRef: "agentbadge:policy:shipment-terms",
      verifierVersion: "shipment-verifier@1",
    });
    const st = await shipmentState(db.econLedger, sid);
    const verify = st.events.find((e) => e.kind === "verify")!;
    const offer = st.events.find((e) => e.kind === "work_offer")!;
    const terms = (offer.payload as { terms?: unknown }).terms;
    const p = verify.payload as Record<string, unknown>;
    expect(p.criteriaDigest).toBe(hashCanonical(terms));
    expect(p.policyRef).toBe("agentbadge:policy:shipment-terms");
    expect(p.verifierVersion).toBe("shipment-verifier@1");
  });

  it("criteriaDigest still binds terms when extras omitted (auto)", async () => {
    const { db, deps } = await makeShipment();
    const sid = "shp-e2e-1";
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    await handoffHop(sid, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, HOPS[0]);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps);
    await verifyHop(sid, 0, "pass", WAREHOUSE, CARRIER, deps);
    const st = await shipmentState(db.econLedger, sid);
    const verify = st.events.find((e) => e.kind === "verify")!;
    const offer = st.events.find((e) => e.kind === "work_offer")!;
    const terms = (offer.payload as { terms?: unknown }).terms;
    const p = verify.payload as Record<string, unknown>;
    expect(p.criteriaDigest).toBe(hashCanonical(terms));
  });

  it("hop i+1 cannot handoff while hop i is unpaid (ordering AC)", async () => {
    const { deps } = await makeShipment();
    const sid = "shp-e2e-1";
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps);
    // hop1 without hop0 settle → refused
    await expect(
      handoffHop(sid, 1, {}, CARRIER, WAREHOUSE, deps),
    ).rejects.toThrow(ShipmentOrderError);
    // settle hop0 → hop1 unlocks
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps);
    await expect(
      handoffHop(sid, 1, {}, CARRIER, WAREHOUSE, deps),
    ).resolves.toBeUndefined();
  });

  it("settle without handoff → refused; settle idempotent", async () => {
    const { deps, executor } = await makeShipment();
    const sid = "shp-e2e-1";
    await expect(
      settleHop(sid, 0, "10", CLIENT, CARRIER, deps),
    ).rejects.toThrow(/not handed off/);
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps); // no-op second call
    expect(executor.settled).toHaveLength(1);
  });

  it("failed hop settle loses nothing — earlier events intact (AC)", async () => {
    const { db, deps, executor } = await makeShipment();
    const sid = "shp-e2e-1";
    executor.failOnSettleJobId = "job-shp-e2e-1-0";
    await handoffHop(sid, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps);
    await expect(
      settleHop(sid, 0, "10", CLIENT, CARRIER, deps),
    ).rejects.toThrow(/rejected/);
    const { hops, events } = await shipmentState(db.econLedger, sid);
    // the handoff survives; hop0 is handed_off not paid; log complete
    expect(hops[0]!.status).toBe("handed_off");
    expect(events.length).toBeGreaterThanOrEqual(2); // offer + handoff
    // recovery: clear the fault and retry — goes through
    executor.failOnSettleJobId = undefined;
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps);
    expect((await shipmentState(db.econLedger, sid)).hops[0]!.status).toBe("paid");
  });
});

describe("GET /api/ledger/shipments/:id", () => {
  function appFor(db: Database) {
    return new Hono().route(
      "/",
      createEconLedgerShipmentsRoutes({ getDb: () => db }),
    );
  }

  it("returns full hop chain conforming to ShipmentReplayResponseSchema", async () => {
    const { db, deps } = await makeShipment();
    const sid = "shp-e2e-1";
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps);
    await handoffHop(sid, 1, {}, CARRIER, WAREHOUSE, deps);

    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(200);
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    expect(body.shipmentId).toBe(sid);
    expect(body.hops[0]!.status).toBe("paid");
    expect(body.hops[0]!.jobId).toBe("job-shp-e2e-1-0");
    expect(body.hops[0]!.receiver).toBe(CARRIER);
    expect(body.hops[1]!.status).toBe("handed_off");
    expect(body.hops[2]!.status).toBe("offered");
  });

  it("unknown shipment → 404 not_found", async () => {
    const db = await makeDb();
    const res = await appFor(db).request("/api/ledger/shipments/shp-nope");
    expect(res.status).toBe(404);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });

  it("disabled → no_data envelope (never 500)", async () => {
    const db = createDatabase({ enabled: false });
    const res = await appFor(db).request("/api/ledger/shipments/shp-x");
    expect(res.status).toBe(200);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("no_data");
  });
});
