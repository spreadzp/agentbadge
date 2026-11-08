/**
 * SLICE-213-3: evidence refs propagate to the replay read model.
 *
 * shipmentState() lifts payload.evidence into ShipmentHop.evidence.
 * Mixed chains replay clean (D-211-2); pre-213 handoffs carry no
 * evidence — hops stay undefined. Response parses against
 * ShipmentReplayResponseSchema (215-1 contract).
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
    // 213-5 (H-1): projection refs carry issuerIsHopParty, and the hop
    // records who asserted the evidence (provenance).
    expect(hop0?.evidence).toEqual([
      {
        type: "gps",
        hash: HASH,
        issuer: { address: CARRIER, type: "org" },
        uri: "ipfs://QmGps",
        issuerIsHopParty: true, // CARRIER is the handoff counterparty
        issuerIsCounterparty: true, // 216-3 (H-1): self-serving channel marker
      },
    ]);
    expect(hop0?.evidenceAssertedBy).toBe(CLIENT);
    // 216-3 (H-1): counterparty-issued evidence also lifts the
    // counterpartyIssued advisory — a gps ref asserted BY the receiver
    // about their own handoff is an unverified claim.
    expect(hop0?.counterpartyIssued).toBe(true);
    expect(hop1?.status).toBe("handed_off");
    expect(hop1?.evidence).toBeUndefined();
    expect(hop1?.evidenceAssertedBy).toBeUndefined();

    // derived evidence carries the payload fields plus projection
    // annotations (213-5 issuerIsHopParty, 216-3 issuerIsCounterparty)
    // — compare ref-by-ref
    const handoffEv = state.events.find((e) => e.kind === "handoff");
    const evEvidence = (handoffEv?.payload as Record<string, unknown>).evidence as
      Array<Record<string, unknown>>;
    expect(hop0?.evidence).toEqual(
      evEvidence.map((r) => ({
        ...r,
        issuerIsHopParty: true,
        issuerIsCounterparty: true,
      })),
    );
    // and is not the same object reference (no aliasing)
    expect(hop0?.evidence).not.toBe(evEvidence);

    // API read path — response conforms to ShipmentReplayResponseSchema
    const app = new Hono();
    app.route("/", createEconLedgerShipmentsRoutes({ getDb: () => db }));
    const res = await app.request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(200);
    const body = ShipmentReplayResponseSchema.parse(await res.json());
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

describe("213-5 audit fixes — replay hardening", () => {
  it("issuer outside hop parties → issuerIsHopParty false (H-1)", async () => {
    const db = await makeDb();
    const deps = { ledger: db.econLedger, executor: new InMemoryHopExecutor() };
    const sid = "shp-ev-thirdparty";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    const SENSOR = "0x" + "cc".repeat(20) as `0x${string}`;
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
      { type: "gps", hash: HASH, issuer: { address: SENSOR, type: "device" } },
    ]);

    const state = await shipmentState(deps.ledger, sid);
    const hop0 = state.hops.find((h) => h.hopIndex === 0);
    expect(hop0?.evidence?.[0]?.issuerIsHopParty).toBe(false);
    expect(hop0?.evidenceAssertedBy).toBe(CLIENT);
  });

  it("evidence in a non-canonical-seq handoff event does NOT lift (M-4)", async () => {
    // A foreign/forge event with a valid payload but seq ≠ seqFor(hop,handoff)
    // must not pin claims into the public read model.
    const db = await makeDb();
    const deps = { ledger: db.econLedger, executor: new InMemoryHopExecutor() };
    const sid = "shp-ev-forged";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    const { buildEconomicEvent } = await import("@agentbadge/econ-events");
    const forged = buildEconomicEvent(
      {
        source: "supply_chain",
        sourceId: sid,
        seq: 99, // not seqFor(0, "handoff") = 4
        kind: "handoff",
        actor: "0x" + "99".repeat(20),
        at: new Date().toISOString(),
        payload: {
          shipmentId: sid,
          hopIndex: 0,
          evidence: [{ type: "gps", hash: HASH, issuer: { address: "0x" + "99".repeat(20), type: "device" } }],
        },
      },
      { mode: "replay" }, // importer path — lenient, mirrors a pre-213 event
    );
    await db.econLedger.append([forged]);

    const state = await shipmentState(deps.ledger, sid);
    const hop0 = state.hops.find((h) => h.hopIndex === 0);
    // 214-5 (H-1): a non-canonical-seq handoff lifts NOTHING — not even
    // status. A forged event can't fake a delivery claim in replay.
    expect(hop0?.status).toBe("offered");
    expect(hop0?.evidence).toBeUndefined();
    expect(hop0?.evidenceAssertedBy).toBeUndefined();
  });

  it("corrupt handoff payload skips projection instead of poisoning it (H-2 read belt)", async () => {
    const db = await makeDb();
    const deps = { ledger: db.econLedger, executor: new InMemoryHopExecutor() };
    const sid = "shp-ev-corrupt";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    // a corrupt payload can't come through append (the store re-verifies
    // events) — it arrives via foreign implementations or backfill, so we
    // bypass the store and hand the corrupt row straight to the read belt
    const corruptRow = {
      ledgerSeq: 999n,
      event: {
        id: "evt_corrupt_1",
        spec: "econ-events/1",
        source: "supply_chain",
        sourceId: sid,
        seq: 4,
        kind: "handoff",
        actor: "0x" + "99".repeat(20),
        at: new Date().toISOString(),
        payload: { totally: "garbage" }, // no shipmentId/hopIndex — must not replay
        idempotencyKey: `ev:supply_chain:${sid}:4`,
      },
    };
    const realList = deps.ledger.listBySourceId.bind(deps.ledger);
    deps.ledger.listBySourceId = (async (...args: unknown[]) => {
      const rows = await (realList as (...a: unknown[]) => Promise<unknown[]>)(...args);
      return [...rows, corruptRow];
    }) as never;

    const state = await shipmentState(deps.ledger, sid); // must not throw
    expect(state.hops.find((h) => h.hopIndex === 0)?.status).toBe("offered");
    expect(state.hops.every((h) => h.evidence === undefined)).toBe(true);
  });

  it("light mode skips claim lifts for guard paths (M-2)", async () => {
    const db = await makeDb();
    const deps = { ledger: db.econLedger, executor: new InMemoryHopExecutor() };
    const sid = "shp-ev-light";
    await createShipment({ shipmentId: sid, client: CLIENT, hops: HOPS }, deps);
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    await handoffHop(sid, 0, {}, CLIENT, CARRIER, deps, undefined, undefined, [
      { type: "gps", hash: HASH, issuer: { address: CARRIER, type: "org" } },
    ]);

    const light = await shipmentState(deps.ledger, sid, { light: true });
    const full = await shipmentState(deps.ledger, sid);
    expect(light.hops.find((h) => h.hopIndex === 0)?.evidence).toBeUndefined();
    expect(light.hops.find((h) => h.hopIndex === 0)?.evidenceAssertedBy).toBeUndefined();
    // guard-relevant fields still derive in light mode
    expect(light.hops.find((h) => h.hopIndex === 0)?.status).toBe("handed_off");
    expect(full.hops.find((h) => h.hopIndex === 0)?.evidence).toHaveLength(1);
  });

  it("handoff counterparty compares case-insensitively vs plan (audit rider)", async () => {
    const db = await makeDb();
    const deps = { ledger: db.econLedger, executor: new InMemoryHopExecutor() };
    const sid = "shp-ev-case";
    // plan receiver stored checksummed; caller passes lowercase — must not
    // be rejected as a plan mismatch (liveness bug, not a bypass)
    const checksummed = ("0x" + "Bb".repeat(20)) as `0x${string}`;
    await createShipment(
      { shipmentId: sid, client: CLIENT, hops: [{ receiver: checksummed, amountUsdc: "10" }] },
      deps,
    );
    await acceptShipment(sid, 0, sid, CARRIER, deps);
    await expect(
      handoffHop(sid, 0, {}, CLIENT, CARRIER, deps),
    ).resolves.toBeUndefined();
  });

  it("shipment plan >64 hops rejected (M-2)", async () => {
    const db = await makeDb();
    const deps = { ledger: db.econLedger, executor: new InMemoryHopExecutor() };
    const tooMany = Array.from({ length: 65 }, (_, i) => ({
      receiver: `0x${String(i % 16)}${"0".repeat(39)}` as `0x${string}`,
      amountUsdc: "1",
    }));
    await expect(
      createShipment({ shipmentId: "shp-ev-many", client: CLIENT, hops: tooMany }, deps),
    ).rejects.toThrow(/max 64/);
  });
});
