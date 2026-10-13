import type { Hono } from "hono";
import { getVerdictStore } from "../lib/eaas/store";
import { createVerifyRoutes } from "../routes/verify-api";
import { createVerifyPageRoutes } from "../routes/verify-page";

/**
 * SLICE-180-5: public read-only verify facade — mounted even when EaaS
 * issuing is off. Honest empties: verdict_not_found / anchor "none" /
 * chain "disabled". No paid rails are exposed by this mount.
 */
export function mountVerifySurface(app: Hono): void {
  const deps = { store: getVerdictStore(), rateRpm: 60 };
  app.route("/", createVerifyRoutes(deps));
  app.route("/", createVerifyPageRoutes(deps));
}
