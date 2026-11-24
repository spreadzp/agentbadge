/**
 * EPIC-229: domain wiring — mounts knowledge surfaces on the app.
 *   229-3: admin JSON API — /admin/api/knowledge/* (adminAuth).
 * Later slices add the public agent surface (229-5 search,
 * 229-7 ask) and the operator SSR console (229-9) here.
 */

import type { Hono } from "hono";

import { getDatabase } from "../lib/database";
import {
  knowledgeGapRecorder,
  pickKnowledgeStores,
} from "../lib/knowledge";
import { pickOperatorStores } from "../lib/operators";
import { createAdminKnowledgeRoutes } from "../routes/admin-knowledge-api";
import { createAdminKnowledgeUi } from "../routes/admin-knowledge-ui";
import { createAgentKnowledgeRoutes } from "../routes/agent-knowledge-api";

export function wireKnowledge(app: Hono): void {
  const store = pickKnowledgeStores(getDatabase());
  // 264-6: knowledge is the first domain on the new identity model —
  // credential → principal attribution, the shared key rides only
  // through the dual-auth window as break_glass.
  const operatorStore = pickOperatorStores(getDatabase());
  // 229-3: operator JSON — /admin/api/knowledge/* (operatorAuth).
  app.route("/", createAdminKnowledgeRoutes({ store, operatorStore }));
  // 229-9: operator SSR — /admin/knowledge* (operatorBrowserAuth + Origin).
  app.route("/", createAdminKnowledgeUi(store, operatorStore));
  // 229-5/7/8: public — search + ask (PUBLISHED only), refusals
  // record gaps through the real seam now.
  app.route(
    "/",
    createAgentKnowledgeRoutes({
      store,
      gapRecorder: knowledgeGapRecorder(store),
    }),
  );
}
