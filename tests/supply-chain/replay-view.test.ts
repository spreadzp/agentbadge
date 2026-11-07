/**
 * SLICE-215-2 (D-211-9): `GET /api/ledger/shipments/:id` returns the
 * canonical replay view per the 215-1 contract — timeline of every
 * ledger event in seq order, per-hop plan+state (roles, evidence,
 * provenance, advisory flags), chain aggregate, honest `limits`.
 *
 * Seeded via the shared makeChain() fixture (SLICE-214-1); response is
 * validated by ShipmentReplayResponseSchema — the contract IS the test.
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { buildEconomicEvent } from "@agentbadge/econ-events";
import {
  REPLAY_LIMITS_V1,
  ShipmentReplayResponseSchema,
} from "../../src/server/lib/econ-ledger/supply-chain/replay-types";
import {
  seqFor,
  SHIPMENT_SOURCE,
} from "../../src/server/lib/econ-ledger/supply-chain/state";
import { createEconLedgerShipmentsRoutes } from "../../src/server/routes/econ-ledger-shipments-api";
import {
  makeChain,
  type ChainHopCtx,
  type MadeChain,
} from "./helpers/chain-fixture";

function appFor(chain: MadeChain): Hono {
  const app = new Hono();
  app.route("/", createEconLedgerShipmentsRoutes({ getDb: () => chain.db }));
  return app;
}

describe("GET /api/ledger/shipments/:id — replay view (215-2)", () => {
  it("settled chain → response conforms to ShipmentReplayResponse", async () => {
    const chain = await makeChain({
      lifecycle: "settled",
      roles: (h: ChainHopCtx) => ({
        custodian: { address: h.receiver, type: "org" },
      }),
      evidencePerHop: 1,
    });
    const res = await appFor(chain).request(
      `/api/ledger/shipments/${chain.shipmentId}`,
    );
    expect(res.status).toBe(200);
    const body = ShipmentReplayResponseSchema.parse(await res.json());

    expect(body.shipmentId).toBe(chain.shipmentId);
    expect(body.client).toBe(chain.client);

    // Timeline: every ledger event, seq-ordered, hop-linked where the
    // payload names a hop (handoff/pay/verify carry hopIndex).
    const events = (await chain.state()).events;
    expect(body.timeline).toHaveLength(events.length);
    expect(body.timeline.map((t) => t.seq)).toEqual(
      events.map((e) => e.seq).sort((a, b) => a - b),
    );
    const hopLinked = body.timeline.filter((t) => t.hopIndex === 0);
    expect(hopLinked.map((t) => t.kind).sort()).toEqual(["handoff", "pay"]);

    // Hops: plan terms + derived state + roles/evidence provenance.
    expect(body.hops).toHaveLength(3);
    const hop0 = body.hops[0]!;
    expect(hop0.index).toBe(0);
    expect(hop0.receiver).toBe(chain.receivers[0]);
    expect(hop0.amountUsdc).toBe("10");
    expect(hop0.status).toBe("paid");
    expect(hop0.roles?.custodian?.address).toBe(chain.receivers[0]);
    expect(hop0.rolesAssertedBy).toBe(chain.client);
    expect(hop0.evidence).toHaveLength(1);
    expect(hop0.evidenceAssertedBy).toBe(chain.client);
    // InMemory executor returns no txHash — field stays absent.
    expect(hop0.txHash).toBeUndefined();

    // Aggregate + honest status: all paid, none verified → in_progress,
    // custody at the last receiver, nothing outstanding.
    expect(body.status).toBe("in_progress");
    expect(body.aggregate.completedPct).toBe(0);
    expect(body.aggregate.currentCustodian).toBe(chain.receivers[2]);
    expect(body.aggregate.outstandingUsdc).toBe("0");
    expect(body.limits.length).toBeGreaterThan(0);
    expect(body.limits).toEqual([...REPLAY_LIMITS_V1]);
  });

  it("verified chain → completed, completedPct 100", async () => {
    const chain = await makeChain({ lifecycle: "verified" });
    const res = await appFor(chain).request(
      `/api/ledger/shipments/${chain.shipmentId}`,
    );
    expect(res.status).toBe(200);
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    expect(body.status).toBe("completed");
    expect(body.aggregate.completedPct).toBe(100);
    expect(body.aggregate.outstandingUsdc).toBe("0");
  });

  it("partial chain → aggregate counts only unsettled hops", async () => {
    const chain = await makeChain({
      hops: [
        {
          receiver: ("0x" + "11".repeat(20)) as `0x${string}`,
          amountUsdc: "10",
        },
        {
          receiver: ("0x" + "22".repeat(20)) as `0x${string}`,
          amountUsdc: "4",
          skipSettle: true,
        },
        {
          receiver: ("0x" + "33".repeat(20)) as `0x${string}`,
          amountUsdc: "6",
          skipHandoff: true,
        },
      ],
      lifecycle: "settled",
    });
    const res = await appFor(chain).request(
      `/api/ledger/shipments/${chain.shipmentId}`,
    );
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    // hop0 paid, hop1 handed_off, hop2 offered.
    expect(body.hops.map((h) => h.status)).toEqual([
      "paid",
      "handed_off",
      "offered",
    ]);
    expect(body.status).toBe("in_progress");
    expect(body.aggregate.outstandingUsdc).toBe("10"); // 4 + 6 unsettled
    // Custody is at hop1's receiver (last handed-off hop).
    expect(body.aggregate.currentCustodian).toBe(chain.receivers[1]);
  });

  it("valid id with zero events → honest 404, no fabricated replay (215-3)", async () => {
    // Ledger holds a full chain for ANOTHER shipment — the empty
    // answer is about this id, not about an empty store.
    const chain = await makeChain({ lifecycle: "settled" });
    const res = await appFor(chain).request(
      "/api/ledger/shipments/shp-ghost-1",
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: "not_found" } });
    // Honest-empty: the body must NOT parse as a replay with fake
    // empty sections — an error envelope is the only valid answer.
    expect(ShipmentReplayResponseSchema.safeParse(body).success).toBe(false);
  });

  it("events without a canonical offer → 404, nothing to replay (215-3)", async () => {
    const chain = await makeChain({ lifecycle: "offered" });
    const ghost = "shp-no-offer";
    // A canonical-seq handoff for a shipment that has no work_offer:
    // the stream exists, but no client/plan can be derived — the
    // builder must refuse instead of fabricating a response.
    await chain.db.econLedger.append([
      buildEconomicEvent(
        {
          source: SHIPMENT_SOURCE,
          sourceId: ghost,
          seq: seqFor(0, "handoff"),
          kind: "handoff",
          actor: chain.receivers[0]!,
          counterparty: chain.client,
          at: new Date().toISOString(),
          payload: { shipmentId: ghost, hopIndex: 0 },
        },
        { mode: "replay" },
      ),
    ]);
    const res = await appFor(chain).request(
      `/api/ledger/shipments/${ghost}`,
    );
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(body).toMatchObject({ error: { code: "not_found" } });
  });

  it("chain with no roles/evidence → optional fields absent, still valid", async () => {
    const chain = await makeChain({ lifecycle: "settled" });
    const res = await appFor(chain).request(
      `/api/ledger/shipments/${chain.shipmentId}`,
    );
    const body = ShipmentReplayResponseSchema.parse(await res.json());
    expect(body.hops[0]?.roles).toBeUndefined();
    expect(body.hops[0]?.evidence).toBeUndefined();
    expect(body.hops[0]?.rolesAssertedBy).toBeUndefined();
  });
});
