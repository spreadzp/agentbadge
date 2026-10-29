/**
 * SLICE-212-2: handoffHop() accepts typed participant roles.
 *
 * roles travel in the handoff event payload (D-211-7); all fields
 * optional so pre-212 events replay unchanged (D-211-2). Addresses
 * are validated on input; label is display-only (D-212-3).
 */

import { describe, expect, it } from "vitest";
import { createDatabase, type Database } from "@agentbadge/database";
import {
  acceptShipment,
  createShipment,
  handoffHop,
  shipmentState,
  ShipmentOrderError,
} from "../../src/server/lib/econ-ledger/supply-chain/shipment";
import type { HopSpec } from "../../src/server/lib/econ-ledger/supply-chain/types";

const CLIENT = "0x" + "aa".repeat(20) as `0x${string}`;
const CARRIER = "0x" + "bb".repeat(20) as `0x${string}`;
const DEVICE = "0x" + "cc".repeat(20) as `0x${string}`;

const HOPS: HopSpec[] = [{ receiver: CARRIER, amountUsdc: "10", what: "pallet-A1" }];

async function makeDeps(shipmentId = "shp-roles-1") {
  const base = createDatabase({ enabled: false });
  const db = { ...base, db: {} as Database["db"] } as Database;
  const deps = { ledger: db.econLedger };
  await createShipment({ shipmentId, client: CLIENT, hops: HOPS }, deps);
  await acceptShipment(shipmentId, 0, shipmentId, CARRIER, deps);
  return { deps, shipmentId };
}

async function handoffPayload(deps: { ledger: Database["econLedger"] }, sid: string) {
  const state = await shipmentState(deps.ledger, sid);
  const ev = state.events.find((e) => e.kind === "handoff");
  return ev?.payload as Record<string, unknown> | undefined;
}

describe("handoffHop roles (SLICE-212-2)", () => {
  it("handoff with roles → payload carries typed participants", async () => {
    const { deps, shipmentId } = await makeDeps();
    await handoffHop(shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, undefined, {
      custodian: { address: CLIENT, type: "org", label: "FishCo" },
      device: { address: DEVICE, type: "device" },
    });
    const payload = await handoffPayload(deps, shipmentId);
    const roles = payload?.roles as Record<string, { address: string; type: string; label?: string }>;
    expect(roles.custodian).toEqual({ address: CLIENT, type: "org", label: "FishCo" });
    expect(roles.device).toEqual({ address: DEVICE, type: "device" });
    expect(roles.operator).toBeUndefined();
  });

  it("handoff without roles → valid, payload has no roles (backward compat D-211-2)", async () => {
    const { deps, shipmentId } = await makeDeps();
    await handoffHop(shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps);
    const payload = await handoffPayload(deps, shipmentId);
    expect(payload).toBeDefined();
    expect(payload?.roles).toBeUndefined();
  });

  it("bad address inside roles → reject, no event appended", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        custodian: { address: "0x123", type: "org" },
      }),
    ).rejects.toThrow(ShipmentOrderError);
    const payload = await handoffPayload(deps, shipmentId);
    expect(payload).toBeUndefined();
  });

  it("unknown role type → reject", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        custodian: { address: CLIENT, type: "wizard" as never },
      }),
    ).rejects.toThrow(ShipmentOrderError);
  });
});
