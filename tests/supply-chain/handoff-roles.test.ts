/**
 * SLICE-212-2 + 212-5 (audit fixes): handoffHop() accepts typed
 * participant roles, validated against the write-side strict schema.
 *
 * roles travel in the handoff event payload (D-211-7); all fields
 * optional so pre-212 events replay unchanged (D-211-2). label is
 * display-only (D-212-3) — and after the EPIC-212 audit, custodian
 * must equal the hop's counterparty (H-2), repeat handoffs are
 * rejected (H-3), and epcis cannot override guarded fields (H-4).
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
const SENSOR = "0x" + "dd".repeat(20) as `0x${string}`;

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
  it("handoff with roles → payload carries typed participants (normalized)", async () => {
    const { deps, shipmentId } = await makeDeps();
    await handoffHop(shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, undefined, {
      custodian: { address: CARRIER, type: "org", label: "TransMar" },
      device: { address: DEVICE.toUpperCase().replace("0X", "0x") as `0x${string}`, type: "device" },
    });
    const payload = await handoffPayload(deps, shipmentId);
    const roles = payload?.roles as Record<string, { address: string; type: string; label?: string }>;
    expect(roles.custodian).toEqual({ address: CARRIER, type: "org", label: "TransMar" });
    expect(roles.device).toEqual({ address: DEVICE, type: "device" }); // write-side lowercases
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
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("unknown role type → reject", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        custodian: { address: CARRIER, type: "wizard" as never },
      }),
    ).rejects.toThrow(ShipmentOrderError);
  });
});

describe("handoffHop roles — audit fixes (SLICE-212-5)", () => {
  it("H-2: custodian.address must equal the hop counterparty", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        custodian: { address: CLIENT, type: "org", label: "not-the-receiver" },
      }),
    ).rejects.toThrow(/custodian.*counterparty/i);
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("H-2: same address in two slots must keep one type", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        device: { address: DEVICE, type: "device" },
        sensor: { address: DEVICE, type: "service" }, // conflict: same addr, different type
      }),
    ).rejects.toThrow(ShipmentOrderError);
    // same address, same type — allowed
    await handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
      device: { address: DEVICE, type: "device" },
      sensor: { address: DEVICE, type: "device" },
    });
    expect(await handoffPayload(deps, shipmentId)).toBeDefined();
  });

  it("M-3: unknown role slots and unknown role keys fail loudly", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        driver: { address: DEVICE, type: "human" },
      } as never),
    ).rejects.toThrow(ShipmentOrderError);
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
        device: { address: DEVICE, type: "device", signature: "0xforged" } as never,
      }),
    ).rejects.toThrow(ShipmentOrderError);
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("empty roles object {} → reject (roles present means at least one participant)", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {})).rejects.toThrow(
      ShipmentOrderError,
    );
  });

  it("M-1: label rejects control/format chars and blank labels", async () => {
    const { deps, shipmentId } = await makeDeps();
    for (const label of ["\u202Eevil", "Operator\u200B", "line\nbreak", "   ", ""]) {
      await expect(
        handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, {
          device: { address: DEVICE, type: "device", label },
        }),
      ).rejects.toThrow(ShipmentOrderError);
    }
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("H-3: repeat handoff of the same hop is rejected", async () => {
    const { deps, shipmentId } = await makeDeps();
    await handoffHop(shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, undefined, {
      device: { address: DEVICE, type: "device" },
    });
    await expect(
      handoffHop(shipmentId, 0, { proofOfDelivery: "pod-0b" }, CLIENT, CARRIER, deps, undefined, {
        sensor: { address: SENSOR, type: "device" },
      }),
    ).rejects.toThrow(/already handed off/i);
    // first roles preserved
    const payload = await handoffPayload(deps, shipmentId);
    const roles = payload?.roles as Record<string, unknown>;
    expect(roles.device).toBeDefined();
    expect(roles.sensor).toBeUndefined();
  });

  it("M-2: phantom hopIndex outside the plan is rejected", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 7, {}, CLIENT, SENSOR, deps, undefined, {
        device: { address: DEVICE, type: "device" },
      }),
    ).rejects.toThrow(ShipmentOrderError);
  });

  it("H-4: epcis object cannot override guarded payload fields", async () => {
    const { deps, shipmentId } = await makeDeps();
    const epcis = { what: "pallet-A1", hopIndex: 9, roles: { custodian: { address: "0x123", type: "org" } } } as never;
    await handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, epcis);
    const payload = await handoffPayload(deps, shipmentId);
    expect(payload?.hopIndex).toBe(0); // not the injected 9
    expect(payload?.roles).toBeUndefined(); // injected roles never reached the payload
    expect(payload?.what).toBe("pallet-A1");
  });
});
