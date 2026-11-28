/**
 * SLICE-236-6: projection read API — lazy materialization, versioned
 * cache, AMBIGUOUS-as-200, stream history. Events go through the real
 * buildEconomicEvent (econ-events/1 untouched); resolution uses the
 * real 236-2 ActorResolver on stub ports.
 */
import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { buildEconomicEvent } from "@agentbadge/econ-events";
import { createDatabase, type Database } from "@agentbadge/database";
import { createProcessRoutes } from "../../src/server/routes/process/process-api";
import { createAdapterRegistry } from "../../src/server/lib/process/adapters";
import { createSupplyChainAdapter } from "../../src/server/lib/process/adapters/supply-chain";
import { createActorResolver } from "../../src/server/lib/process/resolver/actor-resolver";
import { InMemoryProjectionStore } from "../../src/server/lib/process/projections/store";

const CHAIN = 1874;
const ORG = `0x${"aa".repeat(20)}`;
const AGENT = `0x${"bb".repeat(20)}`;
const DEVICE = `0x${"cc".repeat(20)}`;
const SHIPMENT = "fish-114";

const KNOWN = new Map(
  [ORG, AGENT, DEVICE].map((w) => [w, { type: "EXTERNAL_AGENT" }]),
);

const registry = () =>
  createAdapterRegistry([
    createSupplyChainAdapter({
      resolver: createActorResolver({
        actors: { getById: async (w) => KNOWN.get(w) ?? null },
        defaultChainId: CHAIN,
      }),
      chainId: CHAIN,
    }),
  ]);

const handoff = (hopIndex: number, actor: string, counterparty: string) =>
  buildEconomicEvent({
    source: "supply_chain",
    sourceId: SHIPMENT,
    seq: 4 + hopIndex * 4,
    kind: "handoff",
    actor,
    counterparty,
    at: "2026-11-28T12:00:00.000Z",
    payload: { shipmentId: SHIPMENT, hopIndex },
  });

const offer = () =>
  buildEconomicEvent({
    source: "supply_chain",
    sourceId: SHIPMENT,
    seq: 1,
    kind: "work_offer",
    actor: ORG,
    at: "2026-11-28T11:00:00.000Z",
    payload: { taskRef: SHIPMENT },
  });

const verifyPass = () =>
  buildEconomicEvent({
    source: "supply_chain",
    sourceId: SHIPMENT,
    seq: 6,
    kind: "verify",
    actor: AGENT,
    counterparty: ORG,
    at: "2026-11-28T12:30:00.000Z",
    payload: {
      outcome: "pass",
      shipmentId: SHIPMENT,
      hopIndex: 0,
      policyRef: "agentbadge:policy:delivery-accept/1",
      criteriaDigest: `0x${"ef".repeat(32)}`,
    },
  });

async function makeDb(events: ReturnType<typeof buildEconomicEvent>[]) {
  const db = createDatabase({ enabled: false });
  if (events.length) await db.econLedger.append(events);
  return { ...db, db: {} as Database["db"] } as Database;
}

function appFor(db: Database, reg = registry(), store = new InMemoryProjectionStore()) {
  return new Hono().route(
    "/",
    createProcessRoutes({ getDb: () => db, getRegistry: () => reg, store }),
  );
}

describe("GET /api/process/projections/:eventId (236-6)", () => {
  it("SUPPORTED handoff → 200 with full projection (AC1)", async () => {
    const e = handoff(0, ORG, AGENT);
    const app = appFor(await makeDb([e]));
    const res = await app.request(
      `/api/process/projections/${e.idempotencyKey}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projection.projectionVersion).toBe("process-event-projection/1");
    expect(body.projection.mapping.status).toBe("SUPPORTED");
    expect(body.projection.mapping.adapter).toBe("supply-chain");
    expect(body.adapterVersion).toBe("0.3.0");
    expect(body.versions).toEqual(["0.3.0"]);
    expect(body.projection.interpretation.subjectRefs[0]?.externalReferences[0]?.value).toBe(SHIPMENT);
  });

  it("PARTIAL example: unknown actor → 200, status PARTIAL + issues", async () => {
    const ghost = `0x${"ff".repeat(20)}`;
    const e = handoff(1, ghost, DEVICE);
    const res = await appFor(await makeDb([e])).request(
      `/api/process/projections/${e.idempotencyKey}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projection.mapping.status).toBe("PARTIAL");
    expect(body.projection.mapping.issues[0]?.code).toBe("ACTOR_UNRESOLVED");
  });

  it("AMBIGUOUS → 200 with issues, never 500 (AC4)", async () => {
    // wallet with ≥2 owned registrations → resolver AMBIGUOUS
    const twoRegs = [
      { agentId: `eip155:1874:0x${"22".repeat(20)}:1`, owner: AGENT, status: "active" },
      { agentId: `eip155:1874:0x${"22".repeat(20)}:2`, owner: AGENT, status: "active" },
    ];
    const reg = createAdapterRegistry([
      createSupplyChainAdapter({
        resolver: createActorResolver({
          actors: {
            getById: async (w) => (w === AGENT ? null : KNOWN.get(w) ?? null),
          },
          erc8004: { get: async () => undefined, list: async () => twoRegs },
          defaultChainId: CHAIN,
        }),
        chainId: CHAIN,
      }),
    ]);
    const e = handoff(1, AGENT, DEVICE);
    const res = await appFor(await makeDb([e]), reg).request(
      `/api/process/projections/${e.idempotencyKey}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.projection.mapping.status).toBe("AMBIGUOUS");
    expect(body.projection.mapping.issues[0]?.code).toBe("AMBIGUOUS_SOURCE");
  });

  it("unknown eventId → 404; malformed → 400; disabled db → 503", async () => {
    const db = await makeDb([]);
    const app = appFor(db);
    expect(
      (await app.request("/api/process/projections/ev:supply_chain:nope:9"))
        .status,
    ).toBe(404);
    expect(
      (await app.request("/api/process/projections/bad%20id")).status,
    ).toBe(400);
    const off = { ...db, db: null } as Database;
    expect(
      (
        await appFor(off).request(
          "/api/process/projections/ev:supply_chain:x:1",
        )
      ).status,
    ).toBe(503);
  });

  it("re-materialization is idempotent; adapter bump → old version stays readable (AC3)", async () => {
    const e = handoff(0, ORG, AGENT);
    const store = new InMemoryProjectionStore();
    const reg = registry();
    const app = appFor(await makeDb([e]), reg, store);
    const url = `/api/process/projections/${e.idempotencyKey}`;
    const b1 = await (await app.request(url)).json();
    const b2 = await (await app.request(url)).json();
    expect(b2.materializedAt).toBe(b1.materializedAt); // same row, not duplicated
    // Adapter "update": a registry whose adapter stamps version 9.9.9
    const bumped = createAdapterRegistry([
      {
        id: "supply-chain",
        version: "9.9.9",
        handles: (ev: { source: string }) => ev.source === "supply_chain",
        project: async (ev: never) => {
          const p = await registry().project(ev);
          return { ...p, mapping: { ...p.mapping, version: "9.9.9" } };
        },
      },
    ]);
    const app2 = appFor(await makeDb([e]), bumped, store);
    const b3 = await (await app2.request(url)).json();
    expect(b3.adapterVersion).toBe("9.9.9");
    expect(b3.versions.sort()).toEqual(["0.3.0", "9.9.9"]);
    // the old row is still readable
    const old = await (
      await app2.request(`${url}?version=0.3.0`)
    ).json();
    expect(old.adapterVersion).toBe("0.3.0");
    expect(old.projection.mapping.version).toBe("0.3.0");
    const missing = await app2.request(`${url}?version=0.0.0`);
    expect(missing.status).toBe(404);
  });
});

describe("GET /api/process/projections?source&sourceId (236-6)", () => {
  it("dogfood stream: every event → projection, seq order (AC2)", async () => {
    const events = [
      offer(),
      handoff(0, ORG, AGENT),
      handoff(1, AGENT, DEVICE),
      handoff(2, DEVICE, ORG),
      verifyPass(),
    ];
    const app = appFor(await makeDb(events));
    const res = await app.request(
      `/api/process/projections?source=supply_chain&sourceId=${SHIPMENT}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.source).toBe("supply_chain");
    expect(body.events).toHaveLength(5);
    // seq order preserved
    expect(body.events.map((e: { seq: number }) => e.seq)).toEqual([
      1, 4, 8, 12, 6,
    ]);
    const statuses = body.events.map(
      (e: { status: string; kind: string }) => `${e.kind}:${e.status}`,
    );
    expect(statuses).toEqual([
      "work_offer:UNSUPPORTED", // claimed source, unmapped kind — valid row
      "handoff:SUPPORTED",
      "handoff:SUPPORTED",
      "handoff:SUPPORTED",
      "verify:SUPPORTED",
    ]);
    const verifyRow = body.events[4];
    expect(
      verifyRow.projection.interpretation.domainData.commitmentPotential,
    ).toBeDefined();
  });

  it("missing params → 400", async () => {
    const app = appFor(await makeDb([]));
    expect((await app.request("/api/process/projections")).status).toBe(400);
    expect(
      (await app.request("/api/process/projections?source=supply_chain"))
        .status,
    ).toBe(400);
  });
});
