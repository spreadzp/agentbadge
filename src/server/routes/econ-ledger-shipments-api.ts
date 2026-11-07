/**
 * SLICE-207-7 + SLICE-215-2 (D-211-9): shipment chain read —
 * `GET /api/ledger/shipments/:id`.
 *
 * Returns the canonical `ShipmentReplayResponse` (215-1 contract):
 * { shipmentId, client, status, timeline[], hops[], aggregate, limits[] }
 * — hops derived from the shipment's own event stream (sourceId =
 * shipmentId, log = SoT) and carry plan terms, roles/evidence +
 * provenance and advisory flags. `roles`/`evidence` are SELF-DECLARED
 * claims by the handoff actor (see *AssertedBy) — advisory only,
 * never verified identity (D-212-3, D-213-4).
 * Unknown shipment → 404 not_found; disabled → no_data.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Database } from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { shipmentReplay } from "../lib/econ-ledger/supply-chain/replay";
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
      summary: "Shipment replay view — timeline + per-hop + aggregate",
      description:
        "Supply-chain replay: a readable timeline of every ledger " +
        "event plus per-hop plan/state (offered → handed_off → paid → " +
        "verified) with roles/evidence provenance, advisory flags, a " +
        "chain aggregate and honest `limits`. roles/evidence are " +
        "SELF-DECLARED claims (see *AssertedBy) — advisory only, never " +
        "verified identity. Conforms to ShipmentReplayResponseSchema.",
      responses: {
        200: { description: "ShipmentReplayResponse" },
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
      const replay = await shipmentReplay(db.econLedger, id);
      // 404 both for unknown ids and for streams that cannot produce
      // a canonical replay (no offer → no client) — never fabricate.
      if (replay === null) {
        return errJson(c, 404, "not_found", `no replayable shipment ${id}`);
      }
      return c.json(replay);
    },
  );

  return app;
}

/** Prod singleton — mounts in registerCoreRoutes. */
export const econLedgerShipmentsRoutes = createEconLedgerShipmentsRoutes();
