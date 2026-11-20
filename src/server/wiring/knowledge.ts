/**
 * EPIC-229: domain wiring — mounts knowledge surfaces on the app.
 *   229-3: admin JSON API — /admin/api/knowledge/* (adminAuth).
 * Later slices add the public agent surface (229-5 search,
 * 229-7 ask) and the operator SSR console (229-9) here.
 */

import type { Hono } from "hono";

import { getDatabase } from "../lib/database";
import { pickKnowledgeStores } from "../lib/knowledge";
import { createAdminKnowledgeRoutes } from "../routes/admin-knowledge-api";

export function wireKnowledge(app: Hono): void {
  const store = pickKnowledgeStores(getDatabase());
  app.route("/", createAdminKnowledgeRoutes({ store }));
}
