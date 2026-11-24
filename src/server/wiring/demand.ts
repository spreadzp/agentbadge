/**
 * EPIC-231: domain wiring — mounts demand surfaces on the app.
 *   231-3: public adapter — POST /api/demand/request (mounted in
 *          routes/index.ts with the rest of the public routes).
 *   231-5: operator JSON API — /api/admin/demand/* (operatorAuth).
 *   231-6: operator SSR console — /admin/demand* (operatorBrowserAuth).
 */

import type { Hono } from "hono";

import { getDatabase } from "../lib/database";
import { pickDemandStore } from "../lib/demand/db-stores";
import { defaultBacklogWriter } from "../lib/demand/backlog-export";
import { pickOperatorStores } from "../lib/operators";
import { createAdminDemandRoutes } from "../routes/admin-demand-api";
import { createAdminDemandUi } from "../routes/admin-demand-ui";

export function wireDemand(app: Hono): void {
  const store = pickDemandStore(getDatabase());
  const operatorStore = pickOperatorStores(getDatabase());
  app.route(
    "/",
    createAdminDemandRoutes({
      store,
      operatorStore,
      backlogWriter: defaultBacklogWriter,
    }),
  );
  app.route(
    "/",
    createAdminDemandUi(store, operatorStore, {
      backlogWriter: defaultBacklogWriter,
    }),
  );
}
