/**
 * SLICE-213-3: evidence refs propagate to the replay read model.
 *
 * shipmentState() lifts payload.evidence into ShipmentHop.evidence.
 * Mixed chains replay clean (D-211-2); pre-213 handoffs carry no
 * evidence — hops stay undefined. Response parses against
 * LedgerShipmentSchema.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { LedgerShipmentSchema } from "@agentbadge/econ-events";
import { createDatabase, type Database } from "@agentbadge/database";
import {
  acceptShipment,
  createShipment,
  handoffHop,
  settleHop,
  shipmentState,
} from "../../src/server/lib/econ-ledger/supply-chain/shipment";
import { InMemoryHopExecutor } from "../../src/server/lib/econ-ledger/supply-chain/executor";
import { createEconLedgerShipmentsRoutes } from "../../src/server/routes/econ-ledger-shipments-api";
import type { HopSpec } from "../../src/server/lib/econ-ledger/supply-chain/types";

const CLIENT = "0x" + "aa".repeat(20) as `0x${string}`;
const CARRIER = "0x" + "bb".repeat(20) as `0x${string}`;
const WAREHOUSE = "0x" + "dd".repeat(20) as `0x${string}`;
const HASH = "0x" + "cd".repeat(32) as `0x${string}`;

const HOPS: HopSpec[] = [
  { receiver: CARRIER, amountUsdc: "10" },
  { receiver: WAREHOUSE, amountUsdc: "4" },
];

async function makeDb() {
  const base = createDatabase({ enabled: false });
  return { ...base, db: {} as Database["db"] } as Database;
}

describe("replay evidence (SLICE-213-3)", () => {
  it("mixed chain: hop0 evidence in state and API, hop1 clean", async () => {
    const db = await makeDb();
    const executor = new InMemoryHopExecutor();
    const deps = { ledger: db.econLedger, executor };
    const sid = "shp-ev-mixed";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);

    // hop0 carries an evidence ref (issuer == counterparty → no advisory)
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
      { type: "gps", hash: HASH, issuer: { address: CARRIER, type: "org" }, uri: "ipfs://QmGps" },
    ]);
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps, { rail: "escrow" });
    await acceptShipment(sid, 1, sid, WAREHOUSE, deps);
    // hop1 handoff deliberately without evidence (mixed chain)
    await handoffHop(sid, 1, {}, CARRIER, WAREHOUSE, deps);

    const state = await shipmentState(deps.ledger, sid);
    const hop0 = state.hops.find((h) => h.hopIndex === 0);
    const hop1 = state.hops.find((h) => h.hopIndex === 1);
    expect(hop0?.status).toBe("paid");
    expect(hop0?.evidence).toEqual([
      { type: "gps", hash: HASH, issuer: { address: CARRIER, type: "org" }, uri: "ipfs://QmGps" },
    ]);
    expect(hop1?.status).toBe("handed_off");
    expect(hop1?.evidence).toBeUndefined();

    // derived evidence deep-equals the source event payload
    const handoffEv = state.events.find((e) => e.kind === "handoff");
    const evEvidence = (handoffEv?.payload as Record<string, unknown>).evidence;
    expect(hop0?.evidence).toEqual(evEvidence);
    // and is not the same object reference (no aliasing)
    expect(hop0?.evidence).not.toBe(evEvidence);

    // API read path — response conforms to LedgerShipmentSchema
    const app = new Hono();
    app.route("/", createEconLedgerShipmentsRoutes({ getDb: () => db }));
    const res = await app.request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(200);
    const body = LedgerShipmentSchema.parse(await res.json());
    expect(body.hops[0]?.evidence?.[0]?.type).toBe("gps");
    expect(body.hops[0]?.evidence?.[0]?.uri).toBe("ipfs://QmGps");
    expect(body.hops[1]?.evidence).toBeUndefined();
  });

  it("chain with no evidence at all replays with no evidence fields", async () => {
    const db = await makeDb();
    const executor = new InMemoryHopExecutor();
    const deps = { ledger: db.econLedger, executor };
    const sid = "shp-ev-none";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps);

    const state = await shipmentState(deps.ledger, sid);
    expect(state.hops.every((h) => h.evidence === undefined)).toBe(true);
  });
});
