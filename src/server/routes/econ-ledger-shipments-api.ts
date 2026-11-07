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
 * Unknown shipment → 404 not_found; malformed id → 400 invalid_id;
 * disabled/failed ledger → 503 unavailable (215-5, audit M-7).
 * Public by design (215-5, audit M-5): ids are caller-chosen — use
 * unguessable shipmentIds for flows whose leg details are private.
 */

import { Hono } from "hono";
import { describeRoute } from "hono-openapi";
import type { Database } from "@agentbadge/database";
import { getDatabase } from "../lib/database";
import { createRateLimiter } from "../middleware/rate-limit";
import { shipmentReplay } from "../lib/econ-ledger/supply-chain/replay";
import { SHIPMENT_ID_RE } from "../lib/econ-ledger/supply-chain/state";
import { errJson } from "../lib/econ-ledger/api-utils";
import { logger } from "@agentbadge/passport/logger";

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
        400: { description: "Malformed shipmentId" },
        404: { description: "Unknown shipmentId" },
        429: { description: "Rate limited" },
        503: { description: "Ledger disabled or read failed" },
      },
    }),
    async (c) => {
      const rl = await ledgerLimiter(c, async () => { });
      if (rl) return rl;
      const id = c.req.param("id");
      // M-3: bound the param before it reaches the store layer.
      if (!SHIPMENT_ID_RE.test(id)) {
        return errJson(c, 400, "invalid_id", "invalid shipmentId");
      }
      const db = getDb();
      if (db.db === null) {
        // 215-5 (audit M-7): a disabled ledger is unavailable, not a
        // 200 with a non-contract shape.
        return errJson(c, 503, "unavailable", "ledger disabled");
      }
      let replay;
      try {
        replay = await shipmentReplay(db.econLedger, id);
      } catch (err) {
        logger.error("shipment replay failed", {
          shipmentId: id,
          error: err instanceof Error ? err.message : String(err),
        });
        return errJson(c, 503, "unavailable", "ledger read failed");
      }
      // 404 both for unknown ids and for streams that cannot produce
      // a canonical replay (no offer → no client) — never fabricate.
      if (replay === null) {
        return errJson(c, 404, "not_found", `no replayable shipment ${id}`);
      }
      // 215-5 nit: a completed shipment is immutable history — let
      // clients/cache it briefly; in-flight replays stay uncached.
      c.header(
        "Cache-Control",
        replay.status === "completed" ? "public, max-age=60" : "no-store",
      );
      return c.json(replay);
    },
  );

  return app;
}

/** Prod singleton — mounts in registerCoreRoutes. */
export const econLedgerShipmentsRoutes = createEconLedgerShipmentsRoutes();
