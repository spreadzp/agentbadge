/**
 * EPIC-231: domain wiring — mounts demand surfaces on the app.
 *   231-3: public adapter — POST /api/demand/request (mounted in
 *          routes/index.ts with the rest of the public routes).
 *   231-5: operator JSON API — /api/admin/demand/* (operatorAuth).
 *   231-6 adds the operator SSR console here.
 */

import type { Hono } from "hono";

import { getDatabase } from "../lib/database";
import { pickDemandStore } from "../lib/demand/db-stores";
import { pickOperatorStores } from "../lib/operators";
import { createAdminDemandRoutes } from "../routes/admin-demand-api";

export function wireDemand(app: Hono): void {
  app.route(
    "/",
    createAdminDemandRoutes({
      store: pickDemandStore(getDatabase()),
      operatorStore: pickOperatorStores(getDatabase()),
    }),
  );
}
