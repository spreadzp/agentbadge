/**
 * EPIC-228: mount all three interaction surfaces on the app —
 * public API (228-3), admin JSON API (228-4), admin SSR console
 * (228-5). Extracted so routes/index.ts stays under the staged-size
 * guard; the shared store set is the caller's (D-228-10).
 */

import type { Hono } from "hono";

import type { RequestInboxStores } from "../../lib/request-inbox/store";
import type { RequestInboxEnvConfig } from "../../../config/env/types";
import type { OperatorStore } from "../../lib/operators";
import { createAgentInteractionRoutes } from "./agent-interaction-api";
import { createAgentInteractionAdminRoutes } from "./agent-interaction-admin-api";
import { createAgentInteractionAdminUi } from "./agent-interaction-admin-ui";

export function mountAgentInteractionRoutes(
  app: Hono,
  stores: RequestInboxStores,
  env: RequestInboxEnvConfig,
  operatorStore?: OperatorStore,
): void {
  // 228-3: public — POST /api/v1/agent/interaction + GET requests/:id.
  app.route("/", createAgentInteractionRoutes({ stores, env }));
  // 228-4: operator JSON — /api/admin/interactions* behind operatorAuth.
  app.route(
    "/",
    createAgentInteractionAdminRoutes({ stores, operatorStore }),
  );
  // 228-5: operator SSR — /admin/interactions* behind operatorBrowserAuth.
  app.route(
    "/",
    createAgentInteractionAdminUi({ stores, operatorStore }),
  );
}
