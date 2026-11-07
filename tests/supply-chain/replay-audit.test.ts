/**
 * SLICE-215-5: audit-fix regression tests — one failing claim per
 * finding of reviews/shipment-replay-REVIEW.md (215-4, Arc Studio).
 *
 * H-1 crafted terms → honest 404, never a THROW (500)
 * H-2 limiter: spoofable proxy headers ignored unless trusted;
 *    live-entry eviction bounds the store
 * H-3 oversized stream → honest null, never an unbounded response
 * H-5 timeline lifts hopIndex only from canonical-slot bound events
 * M-2 plan bound is membership, not count (no phantom hops)
 * M-3 mismatched offer terms → no client, honest 404
 * M-6 non-allowlisted evidence uri schemes dropped on read
 * M-7 failure modes → 503 unavailable, not 200/500
 */

import { describe, expect, it } from "vitest";
import { Hono, type Context } from "hono";
import { buildEconomicEvent } from "@agentbadge/econ-events";
import { createDatabase, type Database } from "@agentbadge/database";
import { createEconLedgerShipmentsRoutes } from "../../src/server/routes/econ-ledger-shipments-api";
import {
  REPLAY_MAX_EVENTS,
  shipmentReplay,
} from "../../src/server/lib/econ-ledger/supply-chain/replay";
import {
  seqFor,
  SHIPMENT_SOURCE,
  shipmentState,
} from "../../src/server/lib/econ-ledger/supply-chain/state";
import { ShipmentReplayResponseSchema } from "../../src/server/lib/econ-ledger/supply-chain/replay-types";
import {
  MemoryStore,
  resolveClientIp,
} from "../../src/server/middleware/rate-limit";
import type { EconEventStored, EconLedgerStore } from "@agentbadge/database";
import type { EconomicEvent } from "@agentbadge/econ-events";
import { makeChain } from "./helpers/chain-fixture";

const ADDR = (b: string) => `0x${b.repeat(20)}` as const;
const CLIENT = ADDR("aa");
const RCV = ADDR("bb");
const HASH: `0x${string}` = `0x${"cd".repeat(32)}`;
const at = () => new Date().toISOString();

async function makeDb() {
  const base = createDatabase({ enabled: false });
  return { ...base, db: {} as Database["db"] } as Database;
}

function appFor(db: Database): Hono {
  const app = new Hono();
  app.route("/", createEconLedgerShipmentsRoutes({ getDb: () => db }));
  return app;
}

/** Lenient importer-mode event — mirrors a pre-213 stored record. */
function ev(input: Parameters<typeof buildEconomicEvent>[0]): EconomicEvent {
  return buildEconomicEvent(input, { mode: "replay" });
}

function offerEv(sid: string, terms: unknown, seq = 1): EconomicEvent {
  return ev({
    source: SHIPMENT_SOURCE,
    sourceId: sid,
    seq,
    kind: "work_offer",
    actor: CLIENT,
    at: at(),
    payload: { taskRef: sid, terms },
  });
}

describe("215-5 audit fixes", () => {
  it("H-1: non-iterable terms.hops → honest answer, never 500", async () => {
    const db = await makeDb();
    const sid = "shp-h1-noniter";
    await db.econLedger.append([
      offerEv(sid, { shipmentId: sid, hops: 42 }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).not.toBe(500);
  });

  it("H-1: null plan hop → honest answer, never 500", async () => {
    const db = await makeDb();
    const sid = "shp-h1-nullhop";
    await db.econLedger.append([
      offerEv(sid, { shipmentId: sid, hops: [null] }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).not.toBe(500);
  });

  it("H-1: crafted amountUsdc 'abc' → 404, no BigInt throw", async () => {
    const db = await makeDb();
    const sid = "shp-h1-badamount";
    await db.econLedger.append([
      offerEv(sid, {
        shipmentId: sid,
        hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: "abc" }],
      }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(404);
  });

  it("H-1: amountUsdc '1.2.3' → 404, not silent float corruption", async () => {
    const db = await makeDb();
    const sid = "shp-h1-dots";
    await db.econLedger.append([
      offerEv(sid, {
        shipmentId: sid,
        hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: "1.2.3" }],
      }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(404);
  });

  it("H-1: numeric amountUsdc → 404, no .split crash", async () => {
    const db = await makeDb();
    const sid = "shp-h1-num";
    await db.econLedger.append([
      offerEv(sid, {
        shipmentId: sid,
        hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: 10 }],
      }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(404);
  });

  it("H-3: oversized event stream → honest null (replay cap)", async () => {
    const sid = "shp-h3-big";
    const offer = offerEv(sid, {
      shipmentId: sid,
      hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: "10" }],
    });
    const rows = [
      { event: offer },
      ...Array.from({ length: REPLAY_MAX_EVENTS }, (_, i) => ({
        event: ev({
          source: SHIPMENT_SOURCE,
          sourceId: sid,
          seq: 1000 + i,
          kind: "pay",
          actor: CLIENT,
          amountUsdc: "1",
          at: at(),
          payload: { rail: "direct" },
        }),
      })),
    ] as unknown as EconEventStored[];
    const stub = {
      listBySourceId: async () => rows,
    } as unknown as EconLedgerStore;
    expect(await shipmentReplay(stub, sid)).toBeNull();
  });

  it("H-5: non-canonical event does not lift hopIndex into timeline", async () => {
    const chain = await makeChain({ lifecycle: "settled" });
    const forged = ev({
      source: SHIPMENT_SOURCE,
      sourceId: chain.shipmentId,
      seq: 99, // not seqFor(0, "verify") = 6
      kind: "verify",
      actor: RCV,
      at: at(),
      payload: {
        shipmentId: chain.shipmentId,
        hopIndex: 0,
        outcome: "pass",
      },
    });
    await chain.db.econLedger.append([forged]);
    const res = await appFor(chain.db).request(
      `/api/ledger/shipments/${chain.shipmentId}`,
    );
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    const entry = body.timeline.find((e) => e.seq === 99);
    expect(entry).toBeDefined();
    expect(entry?.hopIndex).toBeUndefined();
  });

  it("M-2: sparse plan bound is membership — out-of-plan event lifts nothing", async () => {
    const db = await makeDb();
    const sid = "shp-m2-sparse";
    await db.econLedger.append([
      offerEv(sid, {
        shipmentId: sid,
        hopCount: 1,
        hops: [{ hopIndex: 5, receiver: RCV, amountUsdc: "10" }],
      }),
      ev({
        source: SHIPMENT_SOURCE,
        sourceId: sid,
        seq: seqFor(0, "handoff"),
        kind: "handoff",
        actor: CLIENT,
        counterparty: RCV,
        at: at(),
        payload: { shipmentId: sid, hopIndex: 0 },
      }),
    ]);
    const state = await shipmentState(db.econLedger, sid);
    // Plan declares ONLY hop 5 — a canonical handoff for hop 0 must
    // not mint a phantom hop (count-bound `hopIndex >= size` fails open).
    expect(state.hops.map((h) => h.hopIndex)).toEqual([5]);
  });

  it("M-3: offer terms.shipmentId mismatch → honest 404", async () => {
    const db = await makeDb();
    const sid = "shp-m3-mismatch";
    await db.econLedger.append([
      offerEv(sid, {
        shipmentId: "shp-OTHER",
        hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: "10" }],
      }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    expect(res.status).toBe(404);
  });

  it("M-6: non-allowlisted evidence uri scheme is dropped on read", async () => {
    const db = await makeDb();
    const sid = "shp-m6-jsuri";
    await db.econLedger.append([
      offerEv(sid, {
        shipmentId: sid,
        hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: "10" }],
      }),
      ev({
        source: SHIPMENT_SOURCE,
        sourceId: sid,
        seq: seqFor(0, "handoff"),
        kind: "handoff",
        actor: CLIENT,
        counterparty: RCV,
        at: at(),
        payload: {
          shipmentId: sid,
          hopIndex: 0,
          evidence: [
            {
              type: "gps",
              hash: HASH,
              issuer: { address: RCV, type: "device" },
              uri: "javascript:alert(1)",
            },
          ],
        },
      }),
    ]);
    const res = await appFor(db).request(`/api/ledger/shipments/${sid}`);
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    const ref = body.hops[0]?.evidence?.[0];
    expect(ref).toBeDefined();
    expect(ref?.type).toBe("gps");
    // Ref stays, but a javascript:/data:/file: URI never reaches JSON.
    expect(ref?.uri).toBeUndefined();
  });

  it("M-7: disabled ledger → 503 unavailable (not 200 non-conforming)", async () => {
    const db = createDatabase({ enabled: false });
    const res = await appFor(db).request("/api/ledger/shipments/shp-x");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unavailable");
  });

  it("M-7: store error → 503 unavailable (not bare 500)", async () => {
    const db = await makeDb();
    const badDb = {
      ...db,
      econLedger: {
        ...db.econLedger,
        listBySourceId: async () => {
          throw new Error("connection lost");
        },
      },
    } as Database;
    const res = await appFor(badDb).request("/api/ledger/shipments/shp-x");
    expect(res.status).toBe(503);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("unavailable");
  });

  it("nit: invalid shipmentId → 400 invalid_id (not not_found)", async () => {
    const db = await makeDb();
    const res = await appFor(db).request("/api/ledger/shipments/bad%20id");
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code).toBe("invalid_id");
  });

  it("nit: timeline is seq-sorted regardless of store order", async () => {
    const sid = "shp-nit-order";
    const offer = offerEv(sid, {
      shipmentId: sid,
      hops: [{ hopIndex: 0, receiver: RCV, amountUsdc: "10" }],
    });
    const pay = ev({
      source: SHIPMENT_SOURCE,
      sourceId: sid,
      seq: seqFor(0, "pay"),
      kind: "pay",
      actor: CLIENT,
      amountUsdc: "10",
      at: at(),
      payload: { rail: "direct", shipmentId: sid, hopIndex: 0 },
    });
    // Store returns newest-first — replay must still emit seq order.
    const rows = [{ event: pay }, { event: offer }] as EconEventStored[];
    const stub = {
      listBySourceId: async () => rows,
    } as unknown as EconLedgerStore;
    const replay = await shipmentReplay(stub, sid);
    expect(replay).not.toBeNull();
    const seqs = replay!.timeline.map((e) => e.seq);
    expect(seqs).toEqual([...seqs].sort((a, b) => a - b));
  });

  it("H-2: client-controlled proxy headers ignored unless TRUST_PROXY_HEADERS", () => {
    const saved = { ...process.env };
    try {
      delete process.env.FLY_APP_NAME;
      delete process.env.FLY_MACHINE_ID;
      delete process.env.TRUST_PROXY_HEADERS;
      const ctx = {
        req: { header: (n: string) => ({ "x-real-ip": "1.2.3.4", "x-forwarded-for": "5.6.7.8" })[n] },
      } as unknown as Context;
      expect(resolveClientIp(ctx)).toBe("unknown");
      process.env.TRUST_PROXY_HEADERS = "true";
      expect(resolveClientIp(ctx)).toBe("5.6.7.8");
    } finally {
      process.env = saved;
    }
  });

  it("H-2: store evicts oldest live entries when over maxEntries", () => {
    const store = new MemoryStore();
    const now = Date.now();
    for (let i = 0; i < 5; i++) {
      store.set(`ip${i}`, { count: 1, resetAt: now + 60_000 });
    }
    store.evictOldest?.(2);
    expect(store.size()).toBe(3);
  });
});
