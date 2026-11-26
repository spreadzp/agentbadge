/**
 * EPIC-232 (SLICE-232-8): mount the AI automation policies console —
 * GET/POST /admin/ai behind operatorBrowserAuth + capability gate.
 * The aiStore seam resolves the same way as the worker/intake
 * (pickAiStores → DB when DATABASE_ENABLED, memory otherwise);
 * `getConfig().ai === undefined` renders as master-kill engaged and
 * every effective mode shows `off`.
 */

import type { Hono } from "hono";

import { getConfig } from "../../config/env";
import { getDatabase } from "../lib/database";
import { pickAiStores } from "../lib/ai/db-stores";
import { pickOperatorStores } from "../lib/operators";
import { createAdminAiUi } from "../routes/admin-ai-ui";

export function wireAdminAi(app: Hono): void {
  const db = getDatabase();
  app.route(
    "/",
    createAdminAiUi({
      aiStore: pickAiStores(db),
      operatorStore: pickOperatorStores(db),
      config: getConfig().ai,
    }),
  );
}
