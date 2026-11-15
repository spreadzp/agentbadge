/**
 * SLICE-224-3 (EPIC-224): commerce route factory — mounts the
 * task/offer/flow sub-routers (17 endpoints, task-centric D-224-10).
 *
 * Wire: `createCommerceRoutes(createCommerceService(getDatabase().commerce))`.
 */

import { Hono } from "hono";
import type { CommerceService } from "../../lib/commerce";
import { createFlowRoutes } from "./flows";
import { createOfferRoutes } from "./offers";
import { createTaskRoutes } from "./tasks";

export function createCommerceRoutes(service: CommerceService): Hono {
  const app = new Hono();
  app.route("/", createTaskRoutes(service));
  app.route("/", createOfferRoutes(service));
  app.route("/", createFlowRoutes(service));
  return app;
}
