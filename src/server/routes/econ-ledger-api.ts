/**
 * SLICE-207-5 (D-207-1, D-207-6): public read API over the economic
 * ledger + AgentTrustEdge projection.
 *
 *   GET /api/ledger/agents/:address/events?cursor&limit — agent history
 *   GET /api/ledger/agents/:address/edges               — counterparty edges
 *   GET /api/ledger/pairs/:a/:b                       — pairwise history
 *   GET /api/ledger/events/:id                        — single event
 *
 * Response shapes = open contract in @agentbadge/econ-events (`api.ts`)
 * — the SDK LedgerClient parses them without custom logic.
 *
 * Paging: `cursor` is the last row's ledgerSeq (opaque decimal string);
 * `beforeLedgerSeq` filters keep pages stable under concurrent appends
 * on the append-only log.
 *
 * Honest-by-contract: DATABASE_ENABLED=false → explicit `no_data`
 * envelope (never a fabricated list); thin data → empty list.
 * Free public reads; 60 req/min per IP (risk-api pattern).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import {
  fromMicros,
  toMicros,
  type AgentTrustEdgeRecord,
  type Database,
  type EconEventStored,
} from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import {
  ADDRESS_RE,
  emptyEdges,
  emptyPage,
  errJson,
  pageArgs,
} from "../lib/econ-ledger/api-utils";

const ledgerLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export interface EconLedgerApiDeps {
  /** Injectable for tests; prod default = getDatabase(). */
  getDb?: () => Database;
}

export function createEconLedgerRoutes(deps: EconLedgerApiDeps = {}): Hono {
  const getDb = deps.getDb ?? getDatabase;
  const app = new Hono();

  const toPage = (rows: EconEventStored[], limit: number) => ({
    events: rows.map((s) => s.event),
    nextCursor: rows.length === limit ? String(rows[rows.length - 1]!.ledgerSeq) : null,
  });

  /** Directed edge rows → undirected contract TrustEdge rows, grouped by sorted pair. */
  const toUndirected = (rows: AgentTrustEdgeRecord[]) => {
    const byPair = new Map<string, {
      a: string; b: string;
      eventCount: number; usdMicros: bigint;
      firstAt: string; lastAt: string;
      lastKind: string; lastSeq: bigint;
    }>();
    for (const r of rows) {
      const [a, b] = r.fromAgent < r.toAgent ? [r.fromAgent, r.toAgent] : [r.toAgent, r.fromAgent];
      const k = `${a}|${b}`;
      const g = byPair.get(k) ?? {
        a, b, eventCount: 0, usdMicros: 0n,
        firstAt: "", lastAt: "", lastKind: "", lastSeq: 0n,
      };
      g.eventCount += r.eventCount;
      g.usdMicros += toMicros(r.totalUsd);
      const first = r.firstEventAt ?? r.lastEventAt;
      if (!g.firstAt || first < g.firstAt) g.firstAt = first;
      if (r.lastEventAt > g.lastAt) g.lastAt = r.lastEventAt;
      if (r.lastEventSeq > g.lastSeq) {
        g.lastSeq = r.lastEventSeq;
        g.lastKind = r.kind;
      }
      byPair.set(k, g);
    }
    return [...byPair.values()]
      .sort((x, y) => (x.lastSeq > y.lastSeq ? -1 : x.lastSeq < y.lastSeq ? 1 : 0))
      .map((g) => ({
        a: g.a,
        b: g.b,
        firstAt: g.firstAt,
        lastAt: g.lastAt,
        eventCount: g.eventCount,
        ...(g.usdMicros > 0n ? { totalUsdc: fromMicros(g.usdMicros) } : {}),
        ...(g.lastKind ? { lastKind: g.lastKind } : {}),
      }));
  };

  // GET /api/ledger/agents/:address/events?cursor&limit — agent history.
  app.get(
    "/api/ledger/agents/:address/events",
    describeRoute({
      tags: ["Ledger"],
      summary: "Economic event history for an agent (newest first)",
      description:
        "Append-only ledger history where the agent is actor or counterparty. " +
        "Cursor = last row's ledgerSeq from the previous page; stable under " +
        "concurrent appends. DATABASE_ENABLED=false → no_data envelope.",
      responses: {
        200: { description: "LedgerEventsPage { events, nextCursor }" },
        400: { description: "Invalid address or cursor" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => {});
      if (rl) return rl;
      const address = c.req.param("address");
      if (!ADDRESS_RE.test(address)) {
        return errJson(c, 400, "invalid_address", "expected 0x + 40 hex");
      }
      const p = pageArgs(c);
      if ("err" in p) return p.err;
      const db = getDb();
      if (db.db === null) {
        return emptyPage(c, "no_data", "ledger disabled (DATABASE_ENABLED=false)");
      }
      try {
        const rows = await db.econLedger.listByAgent(address.toLowerCase(), {
          beforeLedgerSeq: p.cursor,
          limit: p.limit,
        });
        return c.json(toPage(rows, p.limit));
      } catch (e) {
        return errJson(c, 500, "unavailable", `ledger read failed: ${String(e)}`);
      }
    },
  );

  // GET /api/ledger/agents/:address/edges — counterparty trust edges.
  app.get(
    "/api/ledger/agents/:address/edges",
    describeRoute({
      tags: ["Ledger"],
      summary: "Counterparty edges for an agent (undirected pairs)",
      description:
        "Materialized AgentTrustEdge projection folded to undirected pairs " +
        "{a,b,firstAt,lastAt,eventCount,totalUsdc?,lastKind?}. Rebuildable " +
        "from the log — derived state only, never authoritative.",
      responses: {
        200: { description: "LedgerEdgesPage { edges }" },
        400: { description: "Invalid address" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => {});
      if (rl) return rl;
      const address = c.req.param("address");
      if (!ADDRESS_RE.test(address)) {
        return errJson(c, 400, "invalid_address", "expected 0x + 40 hex");
      }
      const db = getDb();
      if (db.db === null) {
        return emptyEdges(c, "no_data", "ledger disabled (DATABASE_ENABLED=false)");
      }
      try {
        const addr = address.toLowerCase();
        const [from, to] = await Promise.all([
          db.trustEdges.listFrom(addr),
          db.trustEdges.listTo(addr),
        ]);
        const seen = new Set<string>();
        const rows = [...from, ...to].filter((r) => {
          const k = `${r.fromAgent}|${r.toAgent}|${r.kind}`;
          if (seen.has(k)) return false;
          seen.add(k);
          return true;
        });
        return c.json({ edges: toUndirected(rows) });
      } catch (e) {
        return errJson(c, 500, "unavailable", `edge read failed: ${String(e)}`);
      }
    },
  );

  // GET /api/ledger/pairs/:a/:b — pairwise history.
  app.get(
    "/api/ledger/pairs/:a/:b",
    describeRoute({
      tags: ["Ledger"],
      summary: "Economic event history between two agents",
      description:
        "Events in either direction of the (a,b) pair, newest first. " +
        "Same cursor paging as the agent history endpoint.",
      responses: {
        200: { description: "LedgerEventsPage { events, nextCursor }" },
        400: { description: "Invalid address or cursor" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => {});
      if (rl) return rl;
      const a = c.req.param("a");
      const b = c.req.param("b");
      if (!ADDRESS_RE.test(a) || !ADDRESS_RE.test(b)) {
        return errJson(c, 400, "invalid_address", "expected 0x + 40 hex for both parties");
      }
      const p = pageArgs(c);
      if ("err" in p) return p.err;
      const db = getDb();
      if (db.db === null) {
        return emptyPage(c, "no_data", "ledger disabled (DATABASE_ENABLED=false)");
      }
      try {
        const rows = await db.econLedger.listByPair(
          a.toLowerCase(),
          b.toLowerCase(),
          { beforeLedgerSeq: p.cursor, limit: p.limit },
        );
        return c.json(toPage(rows, p.limit));
      } catch (e) {
        return errJson(c, 500, "unavailable", `ledger read failed: ${String(e)}`);
      }
    },
  );

  // GET /api/ledger/events/:id — single event by id (or idempotency key).
  app.get(
    "/api/ledger/events/:id",
    describeRoute({
      tags: ["Ledger"],
      summary: "Single economic event by id",
      description:
        "Lookup by event id, falling back to idempotency key " +
        "(ev:{source}:{sourceId}:{seq}). 404 when absent.",
      responses: {
        200: { description: "EconomicEvent" },
        404: { description: "Not found / ledger disabled" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => {});
      if (rl) return rl;
      const id = c.req.param("id");
      const db = getDb();
      if (db.db === null) {
        return errJson(c, 404, "no_data", "ledger disabled (DATABASE_ENABLED=false)");
      }
      try {
        const hit =
          (await db.econLedger.getById(id)) ??
          (await db.econLedger.getByKey(id));
        if (!hit) return errJson(c, 404, "not_found", `event ${id} not found`);
        return c.json(hit.event);
      } catch (e) {
        return errJson(c, 500, "unavailable", `ledger read failed: ${String(e)}`);
      }
    },
  );

  return app;
}

/** Prod singleton — mounts in registerCoreRoutes. */
export const econLedgerRoutes = createEconLedgerRoutes();
