/**
 * SLICE-213-2: handoffHop() accepts typed evidence refs.
 *
 * evidence[] travels in the handoff event payload (D-211-8) — a LINK,
 * not a fact (D-213-4). All fields optional so pre-213 events replay
 * unchanged (D-211-2). Strict write-side parse (EvidenceWriteListSchema):
 * bad hash/type, unknown keys, disallowed uri schemes and >32 refs all
 * reject. issuer.address outside {actor, counterparty} → advisory-warn
 * only, the event stays valid (D-213-3).
 */

import { describe, expect, it, vi } from "vitest";
import { logger } from "@agentbadge/passport/logger";
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
const HASH = `0x${"ef".repeat(32)}`;
const OTHER_HASH = `0x${"12".repeat(32)}`;

const HOPS: HopSpec[] = [{ receiver: CARRIER, amountUsdc: "10", what: "pallet-A1" }];

const ref = (over: Record<string, unknown> = {}) => ({
  type: "gps",
  hash: HASH,
  issuer: { address: DEVICE, type: "device" as const },
  ...over,
});

async function makeDeps(shipmentId = "shp-ev-1") {
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

describe("handoffHop evidence[] (SLICE-213-2)", () => {
  it("handoff with evidence[] → payload carries typed refs (normalized)", async () => {
    const { deps, shipmentId } = await makeDeps();
    await handoffHop(
      shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps, undefined, undefined,
      [
        ref({ hash: `0x${"EF".repeat(32)}` }),
        { type: "signature", hash: OTHER_HASH, issuer: { address: CARRIER, type: "org" } },
      ],
    );
    const payload = await handoffPayload(deps, shipmentId);
    const evidence = payload?.evidence as Array<Record<string, unknown>>;
    expect(evidence).toHaveLength(2);
    expect(evidence[0]!.hash).toBe(HASH); // write-side lowercases
    expect(evidence[0]!.type).toBe("gps");
    expect(evidence[1]!.type).toBe("signature");
  });

  it("handoff without evidence → valid, payload has no evidence (backward compat D-211-2)", async () => {
    const { deps, shipmentId } = await makeDeps();
    await handoffHop(shipmentId, 0, { proofOfDelivery: "pod-0" }, CLIENT, CARRIER, deps);
    const payload = await handoffPayload(deps, shipmentId);
    expect(payload).toBeDefined();
    expect(payload?.evidence).toBeUndefined();
  });

  it("bad hash inside evidence → reject, no event appended", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
        ref({ hash: "not-a-hash" }),
      ]),
    ).rejects.toThrow(ShipmentOrderError);
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("unknown evidence type → reject", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
        ref({ type: "video" }),
      ]),
    ).rejects.toThrow(ShipmentOrderError);
  });

  it("array > 32 refs → reject (payload DoS guard, D-213-2)", async () => {
    const { deps, shipmentId } = await makeDeps();
    const many = Array.from({ length: 33 }, (_, i) =>
      ref({ hash: `0x${String(i).padStart(64, "0")}` }),
    );
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, many),
    ).rejects.toThrow(ShipmentOrderError);
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("issuer with invalid role type/address → reject", async () => {
    const { deps, shipmentId } = await makeDeps();
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
        ref({ issuer: { address: DEVICE, type: "wizard" } }),
      ]),
    ).rejects.toThrow(ShipmentOrderError);
    await expect(
      handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
        ref({ issuer: { address: "0x123", type: "device" } }),
      ]),
    ).rejects.toThrow(ShipmentOrderError);
  });

  it("uri outside the scheme allowlist → reject (write side)", async () => {
    const { deps, shipmentId } = await makeDeps();
    for (const uri of ["javascript:alert(1)", "data:text/plain;base64,AA==", "file:///etc/passwd"]) {
      await expect(
        handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
          ref({ uri }),
        ]),
      ).rejects.toThrow(ShipmentOrderError);
    }
    expect(await handoffPayload(deps, shipmentId)).toBeUndefined();
  });

  it("non-array evidence input → reject", async () => {
    const { deps, shipmentId } = await makeDeps();
    for (const bad of [ref(), "gps-evidence", 42]) {
      await expect(
        handoffHop(
          shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined,
          bad as never,
        ),
      ).rejects.toThrow(ShipmentOrderError);
    }
  });

  it("D-213-3: issuer.address outside {actor, counterparty} → advisory-warn, event still valid", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const { deps, shipmentId } = await makeDeps();
      await handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
        ref({ issuer: { address: SENSOR, type: "device" } }), // SENSOR is neither actor nor receiver
      ]);
      const payload = await handoffPayload(deps, shipmentId);
      expect(payload?.evidence).toHaveLength(1); // appended, not rejected
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining("evidence issuer"),
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
  });

  it("issuer = actor or counterparty → no advisory-warn", async () => {
    const warn = vi.spyOn(logger, "warn").mockImplementation(() => logger);
    try {
      const { deps, shipmentId } = await makeDeps();
      await handoffHop(shipmentId, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
        ref({ issuer: { address: CLIENT, type: "org" } }),
        ref({ hash: OTHER_HASH, issuer: { address: CARRIER, type: "org" } }),
      ]);
      expect(warn).not.toHaveBeenCalledWith(
        expect.stringContaining("evidence issuer"),
        expect.anything(),
      );
    } finally {
      warn.mockRestore();
    }
  });
});
