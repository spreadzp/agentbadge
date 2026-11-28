/**
 * SLICE-236-6 (D-235-26, D-236-Q4): process projection read API —
 * thin Hono layer over the adapter registry + rebuildable projection
 * store.
 *
 *   GET /api/process/projections/:eventId[?version] — one event's
 *       ProcessEventProjection (lazy materialization; AMBIGUOUS is a
 *       200-level answer with issues, never a 500)
 *   GET /api/process/projections?source&sourceId    — a whole stream's
 *       projections, seq order (all dogfood hops; unmapped kinds ride
 *       as valid UNSUPPORTED rows)
 *
 * Read-only — there is deliberately no write endpoint (Landmines).
 * Projections are derived data: store failure degrades to a computed
 * answer, never a fabricated one (R3-2).
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Database } from "@agentbadge/database";
import { getDatabase } from "../../lib/database";
import { getAgentRegistrationStore } from "../../lib/agent-registration/store";
import { resolveVenueNetwork } from "../../lib/venue/chain";
import { getIdentityService } from "../../wiring/identity-service";
import { createRateLimiter } from "../../middleware/rate-limit";
import { logger } from "@agentbadge/passport/logger";
import { createAdapterRegistry } from "../../lib/process/adapters";
import { createSupplyChainAdapter } from "../../lib/process/adapters/supply-chain";
import type { AdapterRegistry } from "../../lib/process/adapters";
import { createActorResolver } from "../../lib/process/resolver/actor-resolver";
import {
  materializeEvent,
  materializeStream,
} from "../../lib/process/projections/materialize";
import {
  InMemoryProjectionStore,
  type ProcessProjectionStore,
} from "../../lib/process/projections/store";
import {
  EVENT_ID_RE,
  errJson,
} from "../../lib/econ-ledger/api-utils";

const processLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

/** Module-level rebuildable cache — loss = recompute from the log. */
const defaultStore = new InMemoryProjectionStore();

export interface ProcessApiDeps {
  /** Injectable for tests; prod default = getDatabase(). */
  getDb?: () => Database;
  /** Injectable for tests; prod default wires real resolver ports. */
  getRegistry?: () => AdapterRegistry;
  /** Injectable for tests; prod default = module singleton. */
  store?: ProcessProjectionStore;
}

/** Prod wiring — ports resolve lazily at call time (registration
 *  store publishes post-boot; identity-service pattern). */
function defaultRegistry(chainId?: number): AdapterRegistry {
  const cid = chainId ?? resolveVenueNetwork().chain.chainId;
  const resolver = createActorResolver({
    actors: {
      getById: (w) => getIdentityService().actors.get(w),
    },
    erc8004: {
      get: async (agentId) => getAgentRegistrationStore()?.get(agentId),
      list: async () => (await getAgentRegistrationStore()?.list()) ?? [],
    },
    principals: {
      byId: async (id) =>
        (await getDatabase().adminOperators?.operators.byId(id)) ?? null,
    },
    defaultChainId: cid,
    onWarn: (message, meta) => logger.warn(`actor-resolver: ${message}`, meta),
  });
  return createAdapterRegistry([
    createSupplyChainAdapter({ resolver, chainId: cid }),
  ]);
}

export function createProcessRoutes(deps: ProcessApiDeps = {}): Hono {
  const getDb = deps.getDb ?? getDatabase;
  const getRegistry = deps.getRegistry ?? (() => defaultRegistry());
  const store = deps.store ?? defaultStore;
  const app = new Hono();

  app.get(
    "/api/process/projections/:eventId",
    describeRoute({
      tags: ["Process"],
      summary: "Process projection for one ledger event",
      description:
        "Interprets one economic event into a ProcessEventProjection " +
        "via the adapter registry (lazy materialization — the first " +
        "request computes + caches; ?version= reads an older " +
        "materialized adapter version). Every status — SUPPORTED, " +
        "PARTIAL, AMBIGUOUS, UNSUPPORTED — is a valid 200 answer " +
        "carrying mapping.status + issues.",
      responses: {
        200: { description: "{projection, adapterVersion, versions[], materializedAt}" },
        400: { description: "Malformed eventId" },
        404: { description: "Unknown event (or version not materialized)" },
        429: { description: "Rate limited" },
        503: { description: "Ledger disabled or read failed" },
      },
    }),
    async (c) => {
      const rl = await processLimiter(c, async () => {});
      if (rl) return rl;
      const eventId = c.req.param("eventId");
      if (!EVENT_ID_RE.test(eventId)) {
        return errJson(c, 400, "invalid_id", "invalid eventId");
      }
      const db = getDb();
      if (db.db === null) {
        return errJson(c, 503, "unavailable", "ledger disabled");
      }
      const version = c.req.query("version");
      const stored = version !== undefined
        ? await store.get(eventId, version)
        : null;
      if (stored) {
        return c.json({
          projection: stored.projection,
          adapterVersion: stored.adapterVersion,
          versions: (await store.list(eventId)).map((r) => r.adapterVersion),
          materializedAt: stored.materializedAt,
        });
      }
      let row;
      try {
        row =
          (await db.econLedger.getByKey(eventId)) ??
          (await db.econLedger.getById(eventId));
      } catch (err) {
        logger.error("process: ledger read failed", {
          eventId,
          error: err instanceof Error ? err.message : String(err),
        });
        return errJson(c, 503, "unavailable", "ledger read failed");
      }
      if (row === null) {
        return errJson(c, 404, "not_found", `no event ${eventId}`);
      }
      if (version !== undefined) {
        return errJson(
          c,
          404,
          "not_found",
          `no materialized projection for ${eventId} at adapter version ${version}`,
        );
      }
      try {
        const m = await materializeEvent(row, getRegistry(), store);
        return c.json({
          projection: m.projection,
          adapterVersion: m.adapterVersion,
          versions: (await store.list(eventId)).map((r) => r.adapterVersion),
          materializedAt: m.materializedAt,
        });
      } catch (err) {
        logger.error("process: projection failed", {
          eventId,
          error: err instanceof Error ? err.message : String(err),
        });
        return errJson(c, 503, "unavailable", "projection failed");
      }
    },
  );

  app.get(
    "/api/process/projections",
    describeRoute({
      tags: ["Process"],
      summary: "Projections for a whole event stream",
      description:
        "?source&sourceId — every event of the stream interpreted " +
        "into ProcessEventProjections, seq order (lazily " +
        "materialized). Dogfood: supply_chain/<shipmentId> yields all " +
        "hops; unmapped kinds carry valid UNSUPPORTED rows with " +
        "TYPE_UNKNOWN issues.",
      responses: {
        200: { description: "{source, sourceId, events[]}" },
        400: { description: "Missing/invalid source or sourceId" },
        429: { description: "Rate limited" },
        503: { description: "Ledger disabled or read failed" },
      },
    }),
    async (c) => {
      const rl = await processLimiter(c, async () => {});
      if (rl) return rl;
      const source = c.req.query("source");
      const sourceId = c.req.query("sourceId");
      if (
        typeof source !== "string" ||
        source.length === 0 ||
        typeof sourceId !== "string" ||
        sourceId.length === 0 ||
        sourceId.length > 256
      ) {
        return errJson(
          c,
          400,
          "invalid_id",
          "source and sourceId query params are required",
        );
      }
      const db = getDb();
      if (db.db === null) {
        return errJson(c, 503, "unavailable", "ledger disabled");
      }
      try {
        const events = await db.econLedger.listBySourceId(source, sourceId, {
          limit: 500,
        });
        const rows = await materializeStream(events, getRegistry(), store);
        return c.json({
          source,
          sourceId,
          events: rows.map((r) => {
            const e = events.find(
              (ev) => ev.event.idempotencyKey === r.eventId,
            );
            return {
              eventId: r.eventId,
              kind: e?.event.kind,
              seq: e?.event.seq,
              status: r.projection.mapping.status,
              adapter: r.adapter,
              adapterVersion: r.adapterVersion,
              issues: r.projection.mapping.issues,
              materializedAt: r.materializedAt,
              projection: r.projection,
            };
          }),
        });
      } catch (err) {
        logger.error("process: stream projections failed", {
          source,
          sourceId,
          error: err instanceof Error ? err.message : String(err),
        });
        return errJson(c, 503, "unavailable", "projection failed");
      }
    },
  );

  return app;
}

export const processRoutes = createProcessRoutes();
