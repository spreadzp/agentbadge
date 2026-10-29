/**
 * SLICE-212-3: roles propagate to the replay read model.
 *
 * shipmentState() lifts payload.roles into ShipmentHop.roles so
 * GET /api/ledger/shipments/:id shows typed participants per hop —
 * even on mixed chains (some hops with, some without roles, D-211-2).
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
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
const DEVICE = "0x" + "cc".repeat(20) as `0x${string}`;
const WAREHOUSE = "0x" + "dd".repeat(20) as `0x${string}`;

const HOPS: HopSpec[] = [
  { receiver: CARRIER, amountUsdc: "10" },
  { receiver: WAREHOUSE, amountUsdc: "4" },
];

async function makeDb() {
  const base = createDatabase({ enabled: false });
  return { ...base, db: {} as Database["db"] } as Database;
}

describe("replay roles (SLICE-212-3)", () => {
  it("mixed chain: hop0 roles visible in state + API, hop1 without roles replays clean", async () => {
    const db = await makeDb();
    const executor = new InMemoryHopExecutor();
    const deps = { ledger: db.econLedger, executor };
    const sid = "shp-roles-mixed";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);

    // hop0 carries roles; hop1 deliberately does not (mixed chain)
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps, undefined, {
      custodian: { address: CLIENT, type: "org", label: "FishCo" },
      device: { address: DEVICE, type: "device" },
    });
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps, { rail: "escrow" });
    await acceptShipment(sid, 1, sid, WAREHOUSE, deps);
    await handoffHop(sid, 1, {}, CARRIER, WAREHOUSE, deps);

    const state = await shipmentState(deps.ledger, sid);
    const hop0 = state.hops.find((h) => h.hopIndex === 0);
    const hop1 = state.hops.find((h) => h.hopIndex === 1);
    expect(hop0?.status).toBe("paid");
    expect(hop0?.roles?.custodian).toEqual({ address: CLIENT, type: "org", label: "FishCo" });
    expect(hop0?.roles?.device).toEqual({ address: DEVICE, type: "device" });
    expect(hop1?.status).toBe("handed_off");
    expect(hop1?.roles).toBeUndefined();

    // API read path — same shape as prod GET /api/ledger/shipments/:id
    const app = new Hono();
    app.route("/", createEconLedgerShipmentsRoutes({ getDb: () => db }));
    const res = await app.request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      hops: Array<{ hopIndex: number; roles?: Record<string, { type: string }> }>;
    };
    expect(body.hops[0]?.roles?.custodian?.type).toBe("org");
    expect(body.hops[0]?.roles?.device?.type).toBe("device");
    expect(body.hops[1]?.roles).toBeUndefined();
  });

  it("chain with no roles at all replays with no roles fields", async () => {
    const db = await makeDb();
    const executor = new InMemoryHopExecutor();
    const deps = { ledger: db.econLedger, executor };
    const sid = "shp-roles-none";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps);

    const state = await shipmentState(deps.ledger, sid);
    expect(state.hops.every((h) => h.roles === undefined)).toBe(true);
  });
});
