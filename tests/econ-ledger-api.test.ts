/**
 * SLICE-207-5: ledger read API — contract conformance + honest no_data.
 *
 * Responses MUST parse with @agentbadge/econ-events open schemas — the
 * SDK LedgerClient relies on it (AC: conformance SDK↔API).
 */

import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import {
  buildEconomicEvent,
  EconomicEventSchema,
  LedgerEdgesPageSchema,
  LedgerEventsPageSchema,
} from "@agentbadge/econ-events";
import { createDatabase, type Database } from "@agentbadge/database";
import { createEconLedgerRoutes } from "../src/server/routes/econ-ledger-api";

const A = "0x" + "aa".repeat(20);
const B = "0x" + "bb".repeat(20);
const C = "0x" + "cc".repeat(20);

let n = 0;
function evt(o: { kind: string; actor: string; counterparty?: string; amountUsdc?: string; at?: string; payload?: Record<string, unknown> }) {
  n += 1;
  return buildEconomicEvent({
    source: "test",
    sourceId: `s-${n}`,
    seq: 1,
    at: o.at ?? "2026-10-25T00:00:00Z",
    payload: o.payload ?? {},
    ...(o.counterparty ? { counterparty: o.counterparty } : {}),
    ...(o.amountUsdc ? { amountUsdc: o.amountUsdc } : {}),
    kind: o.kind as never,
    actor: o.actor,
  });
}

/** In-memory Database but `db !== null` → the "enabled" read path. */
async function makeDb(events: ReturnType<typeof evt>[] = []) {
  const db = createDatabase({ enabled: false });
  if (events.length) await db.econLedger.append(events);
  return { ...db, db: {} as Database["db"] } as Database;
}

function appFor(db: Database) {
  return new Hono().route("/", createEconLedgerRoutes({ getDb: () => db }));
}

describe("GET /api/ledger/agents/:address/events", () => {
  it("returns events conforming to LedgerEventsPageSchema", async () => {
    const db = await makeDb([
      evt({ kind: "pay", actor: A, counterparty: B, amountUsdc: "1.5", payload: { rail: "x402" } }),
      evt({ kind: "pay", actor: B, counterparty: A, amountUsdc: "0.5", payload: { rail: "x402" } }),
      evt({ kind: "pay", actor: B, counterparty: C, amountUsdc: "9", payload: { rail: "x402" } }),
    ]);
    const res = await appFor(db).request(`/api/ledger/agents/${A}/events`);
    expect(res.status).toBe(200);
    const page = LedgerEventsPageSchema.parse(await res.json());
    expect(page.events).toHaveLength(2); // A↔B both directions
    expect(page.nextCursor).toBeNull();
    // newest first
    expect(page.events[0]!.amountUsdc).toBe("0.5");
  });

  it("cursor paging walks the log stably", async () => {
    const db = await makeDb(
      Array.from({ length: 5 }, () =>
        evt({ kind: "pay", actor: A, counterparty: B, amountUsdc: "1", payload: { rail: "x402" } }),
      ),
    );
    const app = appFor(db);
    const p1 = LedgerEventsPageSchema.parse(
      await (await app.request(`/api/ledger/agents/${A}/events?limit=2`)).json(),
    );
    expect(p1.events).toHaveLength(2);
    expect(p1.nextCursor).not.toBeNull();
    const p2 = LedgerEventsPageSchema.parse(
      await (await app.request(`/api/ledger/agents/${A}/events?limit=2&cursor=${p1.nextCursor}`)).json(),
    );
    expect(p2.events).toHaveLength(2);
    // no overlap between pages
    const ids1 = new Set(p1.events.map((e) => e.id));
    expect(p2.events.every((e) => !ids1.has(e.id))).toBe(true);
  });

  it("invalid address → 400 invalid_address", async () => {
    const db = await makeDb();
    const res = await appFor(db).request("/api/ledger/agents/not-an-address/events");
    expect(res.status).toBe(400);
    const body = await res.json() as { error: { code: string } };
    expect(body.error.code).toBe("invalid_address");
  });

  it("disabled → empty page + no_data flag (never 500)", async () => {
    const db = createDatabase({ enabled: false }); // db === null
    const res = await appFor(db).request(`/api/ledger/agents/${A}/events`);
    expect(res.status).toBe(200);
    const raw = await res.json() as { events: unknown[]; error?: { code: string } };
    LedgerEventsPageSchema.parse(raw); // still contract-valid
    expect(raw.events).toHaveLength(0);
    expect(raw.error?.code).toBe("no_data");
  });
});

describe("GET /api/ledger/agents/:address/edges", () => {
  it("returns undirected pairs conforming to LedgerEdgesPageSchema", async () => {
    const db = await makeDb([
      evt({ kind: "pay", actor: A, counterparty: B, amountUsdc: "1", at: "2026-10-01T00:00:00Z", payload: { rail: "x402" } }),
      evt({ kind: "pay", actor: A, counterparty: B, amountUsdc: "2", at: "2026-10-20T00:00:00Z", payload: { rail: "x402" } }),
      evt({ kind: "verify", actor: B, counterparty: A, at: "2026-10-21T00:00:00Z", payload: { taskRef: "t", outcome: "pass" } }),
    ]);
    const res = await appFor(db).request(`/api/ledger/agents/${A}/edges`);
    expect(res.status).toBe(200);
    const { edges } = LedgerEdgesPageSchema.parse(await res.json());
    expect(edges).toHaveLength(1); // one undirected pair
    const e = edges[0]!;
    expect([e.a, e.b]).toEqual([A < B ? A : B, A < B ? B : A]);
    expect(e.eventCount).toBe(3);
    expect(e.totalUsdc).toBe("3");
    expect(e.firstAt).toBe("2026-10-01T00:00:00Z");
    expect(e.lastAt).toBe("2026-10-21T00:00:00Z");
    expect(e.lastKind).toBe("verify");
  });
});

describe("GET /api/ledger/pairs/:a/:b + /events/:id", () => {
  it("pair history covers both directions", async () => {
    const db = await makeDb([
      evt({ kind: "work_accept", actor: A, counterparty: B, payload: { offerRef: "t" } }),
      evt({ kind: "verify", actor: B, counterparty: A, payload: { taskRef: "t", outcome: "pass" } }),
      evt({ kind: "pay", actor: B, counterparty: C, amountUsdc: "1", payload: { rail: "x402" } }),
    ]);
    const res = await appFor(db).request(`/api/ledger/pairs/${A}/${B}`);
    const page = LedgerEventsPageSchema.parse(await res.json());
    expect(page.events).toHaveLength(2);
  });

  it("single event by id → EconomicEvent; unknown → 404 not_found", async () => {
    const e = evt({ kind: "pay", actor: A, counterparty: B, amountUsdc: "1", payload: { rail: "x402" } });
    const db = await makeDb([e]);
    const app = appFor(db);
    const res = await app.request(`/api/ledger/events/${e.id}`);
    expect(res.status).toBe(200);
    EconomicEventSchema.parse(await res.json());
    const missing = await app.request("/api/ledger/events/evt_missing_00000000");
    expect(missing.status).toBe(404);
    const body = await missing.json() as { error: { code: string } };
    expect(body.error.code).toBe("not_found");
  });
});
