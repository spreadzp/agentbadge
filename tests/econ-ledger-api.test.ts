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
import { createEconLedgerExposureRoutes } from "../src/server/routes/econ-ledger-exposure-api";
import {
  computeExposure,
  type ExposureWeights,
} from "../src/server/lib/econ-ledger/exposure";
import type { RiskVerdict } from "../src/server/lib/forensics/risk-service";

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

// ---------- SLICE-207-6: /exposure ------------------------------------

const W: ExposureWeights = {
  baseUsd: 10,
  perEventUsd: 5,
  historyFactor: 0.25,
  maxUsd: 500,
  minEvents: 3,
  minVolumeUsd: 1,
  halfLifeDays: 30,
  confFullEvents: 10,
  verdictMul: { pass: 1, caution: 0.5, block: 0, no_data: 0.5 },
};

const NOW = new Date("2026-10-25T00:00:00Z");

describe("computeExposure — pure scorer", () => {
  it("thin data → insufficient + null recommendation (AC)", () => {
    const a = computeExposure(
      { eventCount: 1, totalUsd: "0.4", lastEventAt: "2026-10-24T00:00:00Z", kinds: ["pay"] },
      "pass",
      NOW,
      W,
    );
    expect(a.dataQuality).toBe("insufficient");
    expect(a.recommended_exposure_usd).toBeNull();
    expect(a.reasons.length).toBeGreaterThan(0); // reasons non-empty AC
    expect(a.confidence).toBeLessThan(0.3);
  });

  it("fresh rich history + pass → confident recommendation", () => {
    const a = computeExposure(
      { eventCount: 12, totalUsd: "100", lastEventAt: "2026-10-24T00:00:00Z", kinds: ["pay"] },
      "pass",
      NOW,
      W,
    );
    // raw = 10 + 12*5 + 100*0.25 = 95; recency ≈ 0.977
    expect(a.dataQuality).toBe("sufficient");
    expect(a.recommended_exposure_usd).toBeGreaterThan(80);
    expect(a.confidence).toBeGreaterThan(0.9);
  });

  it("block verdict scales recommendation to ~0 but reasons explain", () => {
    const a = computeExposure(
      { eventCount: 8, totalUsd: "40", lastEventAt: "2026-10-24T00:00:00Z", kinds: ["pay"] },
      "block",
      NOW,
      W,
    );
    expect(a.dataQuality).toBe("sufficient");
    expect(a.recommended_exposure_usd).toBe(0);
    expect(a.reasons.some((r) => r.includes("block"))).toBe(true);
  });

  it("stale history decays the recommendation (half-life)", () => {
    const fresh = computeExposure(
      { eventCount: 10, totalUsd: "40", lastEventAt: "2026-10-24T00:00:00Z", kinds: ["pay"] },
      "pass",
      NOW,
      W,
    );
    const stale = computeExposure(
      { eventCount: 10, totalUsd: "40", lastEventAt: "2026-09-25T00:00:00Z", kinds: ["pay"] },
      "pass",
      NOW,
      W,
    );
    // 30d = one half-life → roughly half of fresh
    expect(stale.recommended_exposure_usd!).toBeLessThan(
      fresh.recommended_exposure_usd! * 0.6,
    );
  });

  it("max cap clamps extreme history", () => {
    const a = computeExposure(
      { eventCount: 500, totalUsd: "100000", lastEventAt: "2026-10-25T00:00:00Z", kinds: ["pay"] },
      "pass",
      NOW,
      W,
    );
    expect(a.recommended_exposure_usd).toBe(500);
  });
});

describe("GET /api/ledger/agents/:address/exposure", () => {
  const assess = (verdict: RiskVerdict["verdict"]) => async (): Promise<RiskVerdict> => ({
    verdict,
    organicShare: verdict === "pass" ? 0.9 : 0.1,
    grossVolume: "0",
    organicVolume: "0",
    effectivePayers: 1,
    coveredPct: 1,
    reasons: [],
    indexedToBlock: "0",
    lagBlocks: "0",
  });

  function exposureApp(db: Database, verdict: RiskVerdict["verdict"] = "pass") {
    return new Hono().route(
      "/",
      createEconLedgerExposureRoutes({
        getDb: () => db,
        assessCounterparty: assess(verdict),
      }),
    );
  }

  it("sufficient pair history → recommendation with reasons", async () => {
    const db = await makeDb(
      Array.from({ length: 5 }, () =>
        evt({ kind: "pay", actor: A, counterparty: B, amountUsdc: "10", payload: { rail: "x402" } }),
      ),
    );
    const res = await exposureApp(db).request(
      `/api/ledger/agents/${A}/exposure?counterparty=${B}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as {
      recommended_exposure_usd: number | null;
      confidence: number;
      reasons: string[];
      dataQuality: string;
    };
    expect(body.dataQuality).toBe("sufficient");
    expect(body.recommended_exposure_usd).toBeGreaterThan(0);
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it("no history → insufficient + null, never a silent default", async () => {
    const db = await makeDb();
    const res = await exposureApp(db).request(
      `/api/ledger/agents/${A}/exposure?counterparty=${B}`,
    );
    const body = await res.json() as {
      recommended_exposure_usd: number | null;
      dataQuality: string;
      reasons: string[];
    };
    expect(body.dataQuality).toBe("insufficient");
    expect(body.recommended_exposure_usd).toBeNull();
    expect(body.reasons.length).toBeGreaterThan(0);
  });

  it("missing/invalid counterparty → 400 invalid_address", async () => {
    const db = await makeDb();
    const app = exposureApp(db);
    expect((await app.request(`/api/ledger/agents/${A}/exposure`)).status).toBe(400);
    expect(
      (await app.request(`/api/ledger/agents/${A}/exposure?counterparty=nope`)).status,
    ).toBe(400);
  });

  it("disabled → insufficient + null (never 500)", async () => {
    const db = createDatabase({ enabled: false });
    const res = await exposureApp(db).request(
      `/api/ledger/agents/${A}/exposure?counterparty=${B}`,
    );
    expect(res.status).toBe(200);
    const body = await res.json() as { dataQuality: string; recommended_exposure_usd: unknown };
    expect(body.dataQuality).toBe("insufficient");
    expect(body.recommended_exposure_usd).toBeNull();
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
