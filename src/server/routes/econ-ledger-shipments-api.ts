/**
 * SLICE-207-7: shipment chain read —
 * `GET /api/ledger/shipments/:id`.
 *
 * Returns { shipmentId, hops[{hopIndex,status,jobId?,receiver?,
 * roles?,rolesAssertedBy?}], events[] } conforming to
 * LedgerShipmentSchema — hops derived from the shipment's own event
 * stream (sourceId = shipmentId, log = SoT). `roles` are SELF-DECLARED
 * participant claims by the handoff actor (see rolesAssertedBy) —
 * advisory only, never verified identity (D-212-3, audit H-1).
 * Unknown shipment → 404 not_found; disabled → no_data.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Database } from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { shipmentState } from "../lib/econ-ledger/supply-chain/shipment";
import { SHIPMENT_ID_RE } from "../lib/econ-ledger/supply-chain/state";
import { emptyEdges, errJson } from "../lib/econ-ledger/api-utils";

const ledgerLimiter = createRateLimiter({ windowMs: 60_000, max: 60 });

export interface EconLedgerShipmentsDeps {
  /** Injectable for tests; prod default = getDatabase(). */
  getDb?: () => Database;
}

export function createEconLedgerShipmentsRoutes(
  deps: EconLedgerShipmentsDeps = {},
): Hono {
  const getDb = deps.getDb ?? getDatabase;
  const app = new Hono();

  app.get(
    "/api/ledger/shipments/:id",
    describeRoute({
      tags: ["Ledger"],
      summary: "Shipment hop chain with per-hop status",
      description:
        "Full supply-chain view: hops derived from the event log " +
        "(offered → handed_off → paid → verified) plus the raw events. " +
        "Conforms to LedgerShipmentSchema.",
      responses: {
        200: { description: "LedgerShipment" },
        404: { description: "Unknown shipmentId" },
        429: { description: "Rate limited" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => { });
      if (rl) return rl;
      const id = c.req.param("id");
      // M-3: bound the param before it reaches the store layer.
      if (!SHIPMENT_ID_RE.test(id)) {
        return errJson(c, 400, "not_found", "invalid shipmentId");
      }
      const db = getDb();
      if (db.db === null) {
        return emptyEdges(c, "no_data", "ledger disabled");
      }
      const state = await shipmentState(db.econLedger, id);
      if (state.events.length === 0) {
        return errJson(c, 404, "not_found", `no events for shipment ${id}`);
      }
      return c.json({
        shipmentId: id,
        hops: state.hops,
        events: state.events,
      });
    },
  );

  return app;
}

/** Prod singleton — mounts in registerCoreRoutes. */
export const econLedgerShipmentsRoutes = createEconLedgerShipmentsRoutes();
