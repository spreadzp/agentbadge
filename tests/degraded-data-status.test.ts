/**
 * SLICE-181-3 (MYPROJ-2526): DEGRADED fields + honest-zero enforcement.
 *
 * - lib/data-status.ts: withDataStatus() stamps top-level degraded /
 *   data_status / stale_since (D-181-4); wrapBstockEngine() marks every
 *   served DeltaView so MCP tools inherit the markers.
 * - middleware/bstock-feed-health.ts: a fully dead feed is refused with
 *   503 data_unavailable BEFORE the payment gate — never charge for
 *   data the server cannot honestly serve (D-181-4, O2: paid → refuse).
 * - Honest-zero (D-181-5): empty collections answer
 *   `{ <key>: [], note: "no_data" }` — no synthetic placeholders.
 * - refusal-contract.json manifest carries the degraded section and a
 *   single-source data_unavailable refusal entry.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { Hono } from "hono";
import {
  withDataStatus,
  wrapBstockEngine,
} from "../src/server/lib/data-status";
import { bstockFeedHealth } from "../src/server/middleware/bstock-feed-health";
import { refuse } from "../src/server/lib/error-response";
import {
  getRefusalContract,
  refusalContractSchema,
} from "../src/server/lib/refusal-contract";
import { getErrorCatalog } from "../src/server/lib/error-catalog";

const deltaView = (stale: boolean, lastUpdateMs: number) => ({
  symbol: "AAPLB",
  underlying: "AAPL",
  multiplier: 1,
  bStockPrice: 101,
  underlyingPrice: 100,
  deltaPct: 1,
  phase: "O",
  stale,
  inAlert: false,
  lastUpdateMs,
});

const engineOf = (views: ReturnType<typeof deltaView>[]) => ({
  getDelta: (symbol: string) =>
    views.find((v) => v.symbol === symbol) ?? null,
  listDeltas: () => views,
  getEvents: () => [] as { type: string; symbol: string; atMs: number }[],
  getHistory: (_symbol: string) => [] as { t: number; deltaPct: number }[],
});

describe("withDataStatus", () => {
  it("marks stale bodies: degraded + data_status + ISO stale_since", () => {
    const body = withDataStatus(
      { data: [1] },
      { status: "stale", staleSince: "2026-10-06T16:00:00.000Z" },
    );
    expect(body.degraded).toBe(true);
    expect(body.data_status).toBe("stale");
    expect(body.stale_since).toBe("2026-10-06T16:00:00.000Z");
    expect(body.data).toEqual([1]);
  });

  it("fresh bodies carry data_status:fresh and no degradation", () => {
    const body = withDataStatus({ ok: true }, { status: "fresh" });
    expect(body.degraded).toBe(false);
    expect(body.data_status).toBe("fresh");
    expect("stale_since" in body).toBe(false);
  });

  it("unavailable marks degraded (body may still carry partial fields)", () => {
    const body = withDataStatus({ ok: true }, { status: "unavailable" });
    expect(body.degraded).toBe(true);
    expect(body.data_status).toBe("unavailable");
  });
});

describe("wrapBstockEngine", () => {
  it("stale views get data_status:stale + stale_since from lastUpdateMs", () => {
    const e = wrapBstockEngine(engineOf([deltaView(true, 1_000)]));
    const d = e.getDelta("AAPLB")!;
    expect(d.stale).toBe(true);
    expect(d.data_status).toBe("stale");
    expect(d.degraded).toBe(true);
    expect(d.stale_since).toBe(new Date(1_000).toISOString());
  });

  it("fresh views pass through with data_status:fresh", () => {
    const e = wrapBstockEngine(engineOf([deltaView(false, 5_000)]));
    expect(e.listDeltas()[0]).toMatchObject({
      stale: false,
      data_status: "fresh",
      degraded: false,
    });
  });

  it("list_deltas marks per-symbol (mixed freshness)", () => {
    const e = wrapBstockEngine(
      engineOf([deltaView(true, 1), deltaView(false, 2)]),
    );
    const list = e.listDeltas();
    expect(list[0].data_status).toBe("stale");
    expect(list[1].data_status).toBe("fresh");
  });

  it("events/history delegate untouched", () => {
    const inner = engineOf([]);
    const e = wrapBstockEngine(inner);
    expect(e.getEvents()).toEqual([]);
    expect(e.getHistory("AAPLB")).toEqual([]);
  });
});

describe("bstockFeedHealth middleware", () => {
  const appOf = (views: ReturnType<typeof deltaView>[]) => {
    const app = new Hono();
    app.use("/mcp/bstock/*", bstockFeedHealth(engineOf(views)));
    app.all("/mcp/bstock", (c) => c.json({ ok: true }));
    app.all("/mcp/bstock/tools/list_deltas", (c) => c.json({ ok: true }));
    return app;
  };

  it("feed down (all tracked stale) → 503 data_unavailable, charged:false", async () => {
    const res = await appOf([deltaView(true, 1), deltaView(true, 2)]).request(
      "/mcp/bstock",
      { method: "POST", body: "{}" },
    );
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("data_unavailable");
    expect(body.charged).toBe(false);
  });

  it("at least one fresh symbol → request proceeds", async () => {
    const res = await appOf([deltaView(true, 1), deltaView(false, 2)]).request(
      "/mcp/bstock",
      { method: "POST", body: "{}" },
    );
    expect(res.status).toBe(200);
  });

  it("reads (GET) are never blocked — listing tools stays reachable", async () => {
    const res = await appOf([deltaView(true, 1)]).request("/mcp/bstock");
    expect(res.status).toBe(200);
  });

  it("empty engine is honest-empty, not down (no symbols tracked)", async () => {
    const res = await appOf([]).request("/mcp/bstock", {
      method: "POST",
      body: "{}",
    });
    expect(res.status).toBe(200);
  });
});

describe("data_unavailable refusal (D-181-4)", () => {
  it("refuse() maps data_unavailable to 503 — not the 500 fallback", async () => {
    const app = new Hono();
    app.get("/x", (c) => refuse(c, "data_unavailable", "feed down"));
    const res = await app.request("/x");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.code).toBe("data_unavailable");
    expect(body.charged).toBe(false);
  });

  it("error catalog has exactly one data_unavailable entry (single source)", () => {
    const entries = getErrorCatalog().errors.filter(
      (e) => e.code === "data_unavailable",
    );
    expect(entries).toHaveLength(1);
    expect(entries[0]).toMatchObject({ http_status: 503, charge: "never" });
  });
});

describe("refusal-contract manifest degraded section", () => {
  const manifest = getRefusalContract();

  it("is zod-valid", () => {
    expect(() => refusalContractSchema.parse(manifest)).not.toThrow();
  });

  it("documents statuses, stale_since and the O2 charge decision", () => {
    const d = manifest.degraded as Record<string, unknown>;
    expect(d.field).toBe("degraded");
    expect(d.marker).toBe("data_status");
    expect(d.statuses).toEqual(["fresh", "stale", "unavailable"]);
    expect(d.stale_since).toBe("ISO-8601");
    // O2 resolved: paid requests on unavailable data are REFUSED
    // (charge: never) — only the free tier may serve degraded data.
    expect(d.charge_policy).toContain("never");
    expect(d.charge_policy).toContain("free");
  });

  it("refusals include data_unavailable at 503 charge:never", () => {
    const r = manifest.refusals.find((x) => x.code === "data_unavailable");
    expect(r).toMatchObject({ http: 503, charge: "never" });
  });
});

describe("honest-zero sweep (D-181-5)", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("GET /audit returns events:[] + note:no_data on empty trail", async () => {
    vi.doMock("@agentbadge/mcp", async (importOriginal) => {
      const mod = await importOriginal<typeof import("@agentbadge/mcp")>();
      return { ...mod, getAuditTrail: async () => [] };
    });
    const { auditRoutes } = await import("../src/server/routes/audit");
    const app = new Hono().route("/", auditRoutes);
    const res = await app.request("/audit");
    expect(res.status).toBe(200);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.events).toEqual([]);
    expect(body.note).toBe("no_data");
  });

  it("benchmark insufficient_data refusal carries note:no_data", async () => {
    vi.doMock("../src/agent-readiness/corpus/corpus-store", () => ({
      FileCorpusStore: class {
        async query() {
          return [];
        }
        async getStats() {
          return { total: 0 };
        }
      },
    }));
    const { benchmarkRoutes } = await import(
      "../src/server/routes/benchmark-api"
    );
    const app = new Hono().route("/", benchmarkRoutes);
    const res = await app.request("/api/benchmarks");
    expect(res.status).toBe(503);
    const body = (await res.json()) as Record<string, unknown>;
    expect(body.error).toBe("insufficient_data");
    expect(body.note).toBe("no_data");
  });
});
