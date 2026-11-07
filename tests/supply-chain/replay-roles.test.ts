/**
 * SLICE-212-3 + 212-5 (audit fixes): roles propagate to the replay
 * read model with provenance.
 *
 * shipmentState() lifts payload.roles into ShipmentHop.roles and
 * records rolesAssertedBy (the handoff actor — roles are
 * self-declared, never verified identity, H-1). Mixed chains replay
 * clean (D-211-2). Response parses against ShipmentReplayResponseSchema (215-1 contract).
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { ShipmentReplayResponseSchema } from "../../src/server/lib/econ-ledger/supply-chain/replay-types";
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
  it("mixed chain: hop0 roles + provenance in state and API, hop1 clean", async () => {
    const db = await makeDb();
    const executor = new InMemoryHopExecutor();
    const deps = { ledger: db.econLedger, executor };
    const sid = "shp-roles-mixed";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);

    // hop0 carries roles (custodian == counterparty per H-2);
    // hop1 deliberately does not (mixed chain)
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps, undefined, {
      custodian: { address: CARRIER, type: "org", label: "TransMar" },
      device: { address: DEVICE, type: "device" },
    });
    await settleHop(sid, 0, "10", CLIENT, CARRIER, deps, { rail: "escrow" });
    await acceptShipment(sid, 1, sid, WAREHOUSE, deps);
    await handoffHop(sid, 1, {}, CARRIER, WAREHOUSE, deps);

    const state = await shipmentState(deps.ledger, sid);
    const hop0 = state.hops.find((h) => h.hopIndex === 0);
    const hop1 = state.hops.find((h) => h.hopIndex === 1);
    expect(hop0?.status).toBe("paid");
    expect(hop0?.roles?.custodian).toEqual({ address: CARRIER, type: "org", label: "TransMar" });
    expect(hop0?.roles?.device).toEqual({ address: DEVICE, type: "device" });
    // H-1: provenance — roles are self-declared by the handoff actor
    expect(hop0?.rolesAssertedBy).toBe(CLIENT);
    expect(hop1?.status).toBe("handed_off");
    expect(hop1?.roles).toBeUndefined();
    expect(hop1?.rolesAssertedBy).toBeUndefined();

    // M-5: derived roles deep-equal the source event payload roles
    const handoffEv = state.events.find((e) => e.kind === "handoff");
    const evRoles = (handoffEv?.payload as Record<string, unknown>).roles;
    expect(hop0?.roles).toEqual(evRoles);
    // and they are not the same object reference
    expect(hop0?.roles).not.toBe(evRoles);

    // API read path — response conforms to ShipmentReplayResponseSchema
    const app = new Hono();
    app.route("/", createEconLedgerShipmentsRoutes({ getDb: () => db }));
    const res = await app.request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(200);
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    expect(body.hops[0]?.roles?.custodian?.type).toBe("org");
    expect(body.hops[0]?.rolesAssertedBy).toBe(CLIENT);
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
    expect(state.hops.every((h) => h.rolesAssertedBy === undefined)).toBe(true);
  });
});
